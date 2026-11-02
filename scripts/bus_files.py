"""GBIS 전체 파일을 한 번 내려받아 정적 버스 도로 좌표를 준비한다."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

SPEC = importlib.util.spec_from_file_location('bus_shape_tools', Path(__file__).with_name('prepare-bus-shapes.py'))
SHAPES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SHAPES)
DataError, ApiError = SHAPES.DataError, SHAPES.ApiError
SOURCE = 'https://www.data.go.kr/data/15080658/openapi.do'
FILE_HOSTS = {'openapi.gbis.go.kr', 'gbis.go.kr', 'www.gbis.go.kr'}
FILES = {'routeline': 'routeLine', 'routestation': 'routeStation'}


def check_url(url, hosts):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or parsed.hostname not in hosts or parsed.username or parsed.password:
            raise ValueError()
        if parsed.port not in (None, 80, 443) or re.search(r'(servicekey|apikey|authorization)', unquote(parsed.query), re.I):
            raise ValueError()
    except ValueError:
        raise DataError('공식 제공처의 공개 파일 주소만 다운로드할 수 있습니다.') from None


class SafeRedirect(HTTPRedirectHandler):
    def __init__(self, hosts):
        self.hosts = hosts

    def redirect_request(self, request, response, code, message, headers, newurl):
        check_url(newurl, self.hosts)
        return super().redirect_request(request, response, code, message, headers, newurl)


def open_resource(url, hosts):
    # 인증키가 있는 최초 API 주소는 고정된 코드에서만 만든다. 리다이렉트에는 키를 넘기지 않는다.
    opener = build_opener(SafeRedirect(hosts))
    try:
        return opener.open(Request(url, headers={'User-Agent': 'Galmanzip-bus-files/1.0', 'Accept-Encoding': 'identity'}), timeout=60)
    except HTTPError as error:
        try:
            code = SHAPES.safe_api_error_code(error.read(65536))
        except OSError:
            code = '미제공'
        finally:
            error.close()
        raise ApiError(f'전체 파일 서비스 응답 오류: HTTP {error.code}, 제공기관 코드 {code}.') from None
    except (URLError, TimeoutError, OSError):
        raise ApiError('전체 파일 서비스에 연결하지 못했습니다. 주소와 인증키는 출력하지 않습니다.') from None


def parse_catalog(payload):
    try:
        root = ET.fromstring(payload)
        for node in root.iter():
            node.tag = node.tag.rsplit('}', 1)[-1]
        if root.findtext('.//resultCode', '').strip() != '0':
            code = SHAPES.safe_api_error_code(payload)
            raise ApiError(f'경기도 기반정보 관리의 활용 승인·한도를 확인해 주세요. 제공기관 코드 {code}.')
        catalog = {}
        for name, field in FILES.items():
            url = root.findtext('.//' + field + 'DownloadUrl', '').strip()
            version = root.findtext('.//' + field + 'Version', '').strip()
            check_url(url, FILE_HOSTS)
            if not re.fullmatch(r'[A-Za-z0-9_.-]{1,40}', version):
                raise DataError('전체 파일의 버전을 확인하지 못했습니다.')
            catalog[name] = {'url': url, 'version': version}
        return catalog
    except ET.ParseError:
        raise DataError('기반정보 파일 목록 형식이 올바르지 않습니다.') from None


def download_files(output, key):
    if not key.strip():
        raise DataError('Actions의 DATA_GO_KR_SERVICE_KEY 비밀 값이 필요합니다.')
    url = 'https://apis.data.go.kr/6410000/baseinfoservice/v2/getBaseInfoItemv2?'
    url += urlencode({'serviceKey': unquote(key.strip()), 'format': 'xml'})
    with open_resource(url, {'apis.data.go.kr'}) as response:
        payload = response.read(1024 * 1024 + 1)
    if len(payload) > 1024 * 1024:
        raise DataError('기반정보 파일 목록의 크기를 초과했습니다.')
    catalog = parse_catalog(payload)
    output.mkdir(parents=True, exist_ok=True)
    report = {'version': 1, 'sourceUrl': SOURCE, 'apiRequests': 1,
              'downloadedOn': datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat(), 'files': {}}
    for name, item in catalog.items():
        check_url(item['url'], FILE_HOSTS)
        target = output / (name + '.txt.gz')
        digest, size, rows, sample = hashlib.sha256(), 0, 0, b''
        try:
            with open_resource(item['url'], FILE_HOSTS) as response, gzip.GzipFile(filename=target, mode='wb', mtime=0) as result:
                while chunk := response.read(65536):
                    size += len(chunk)
                    if size > 512 * 1024 * 1024:
                        raise DataError('전체 파일의 크기 제한을 초과했습니다.')
                    digest.update(chunk)
                    rows += chunk.count(b'\n')
                    if len(sample) < 8192:
                        sample += chunk[:8192 - len(sample)]
                    result.write(chunk)
        except (OSError, ValueError) as error:
            target.unlink(missing_ok=True)
            if isinstance(error, DataError):
                raise
            raise DataError('전체 파일을 저장하지 못했습니다.') from None
        if size == 0:
            raise DataError('빈 전체 파일은 사용할 수 없습니다.')
        report['files'][name] = {'file': target.name, 'version': item['version'], 'bytes': size,
                                 'sha256': digest.hexdigest(), 'rows': rows}
        samples = output / 'samples'
        samples.mkdir(exist_ok=True)
        (samples / (name + '.txt')).write_bytes(sample.rsplit(b'\n', 1)[0] + b'\n')
    (output / 'files.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'samples/files.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', type=Path, required=True)
    args = parser.parse_args()
    try:
        download_files(args.download, os.environ.get('DATA_GO_KR_SERVICE_KEY', ''))
    except (DataError, ApiError) as error:
        raise SystemExit(str(error)) from None
