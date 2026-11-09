"""국토교통부 공개 매매 자료를 인증키 노출 없이 준비한다."""
import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

SOURCE = 'https://www.data.go.kr/data/15126468/openapi.do'
ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'
CODE_SOURCE = 'https://www.code.go.kr/stdcode/regCodeL.do?menuNo=101010100010'


class DataError(Exception):
    pass


class ApiError(DataError):
    def __init__(self, code, status=None):
        self.code, self.status = code, status
        super().__init__(f'실거래가 API 응답 오류: 제공기관 코드 {code}, HTTP {status or "200"}.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise DataError('인증키 보호를 위해 API 주소 변경을 따르지 않습니다.')


def parse_page(payload):
    try:
        root = ET.fromstring(payload)
        for node in root.iter():
            node.tag = node.tag.rsplit('}', 1)[-1]
        code = (root.findtext('.//resultCode') or root.findtext('.//returnReasonCode') or '').strip()
        if code not in ('0', '00', '000'):
            raise ApiError(code if re.fullmatch(r'\d{1,3}', code) else '미확인')
        total = int(root.findtext('.//totalCount', '-1'))
        if total < 0:
            raise ValueError()
        rows = [{child.tag: (child.text or '').strip() for child in item} for item in root.findall('.//items/item')]
        return rows, total
    except (ET.ParseError, ValueError):
        raise DataError('실거래가 응답 형식을 확인하지 못했습니다.') from None


def fetch_page(key, district, month, page=1, size=1000):
    if not key.strip():
        raise DataError('기존 Actions DATA_GO_KR_SERVICE_KEY 비밀 값이 필요합니다.')
    query = urlencode({'serviceKey': unquote(key.strip()), 'LAWD_CD': district, 'DEAL_YMD': month,
                       'pageNo': page, 'numOfRows': size})
    request = Request(ENDPOINT + '?' + query, headers={'User-Agent': 'Galmanzip-sales/1.0'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            payload = response.read(16 * 1024 * 1024 + 1)
    except HTTPError as error:
        try:
            parse_page(error.read(65536))
        except ApiError as parsed:
            raise ApiError(parsed.code, error.code) from None
        except DataError:
            pass
        finally:
            error.close()
        raise ApiError('미확인', error.code) from None
    except (URLError, TimeoutError, OSError):
        raise DataError('실거래가 API에 연결하지 못했습니다. 인증키와 요청 주소는 출력하지 않습니다.') from None
    if len(payload) > 16 * 1024 * 1024:
        raise DataError('실거래가 응답 크기가 예상 범위를 넘었습니다.')
    return parse_page(payload)


def probe(output, key):
    output.mkdir(parents=True, exist_ok=True)
    report = {'checkedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(), 'source': SOURCE}
    try:
        rows, total = fetch_page(key, '11110', '202610', size=10)
        report.update(status='ready', total=total, fields=sorted(rows[0]) if rows else [])
        (output / 'sample.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    except DataError as error:
        report.update(status='unavailable', message=str(error))
    try:
        with build_opener().open(Request(CODE_SOURCE, headers={'User-Agent': 'Mozilla/5.0'}), timeout=30) as response:
            (output / 'code-page.html').write_bytes(response.read(4 * 1024 * 1024))
        report['codePage'] = 'ready'
    except (HTTPError, URLError, TimeoutError, OSError):
        report['codePage'] = 'unavailable'
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.probe:
        probe(args.output, os.environ.get('DATA_GO_KR_SERVICE_KEY', ''))
