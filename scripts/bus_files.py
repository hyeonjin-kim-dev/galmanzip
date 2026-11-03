"""GBIS 전체 파일을 한 번 내려받아 정적 버스 도로 좌표를 준비한다."""
import argparse
import codecs
import csv
import gzip
import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
from collections import Counter
from datetime import datetime
from itertools import chain
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
        digest, size, rows, carets, sample, tail = hashlib.sha256(), 0, 0, 0, b'', b''
        try:
            with open_resource(item['url'], FILE_HOSTS) as response, gzip.GzipFile(filename=target, mode='wb', mtime=0) as result:
                while chunk := response.read(65536):
                    size += len(chunk)
                    if size > 512 * 1024 * 1024:
                        raise DataError('전체 파일의 크기 제한을 초과했습니다.')
                    digest.update(chunk)
                    rows += chunk.count(b'\n')
                    carets += chunk.count(b'^')
                    tail = chunk[-1:]
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
        if b'^' in sample.split(b'\n', 1)[0] and sample.lstrip(b'\xef\xbb\xbf').startswith(b'routeId|'):
            rows = carets + int(tail != b'^') - 1
        report['files'][name] = {'file': target.name, 'version': item['version'], 'bytes': size,
                                 'sha256': digest.hexdigest(), 'rows': rows}
        samples = output / 'samples'
        samples.mkdir(exist_ok=True)
        (samples / (name + '.txt')).write_bytes(sample.rsplit(b'\n', 1)[0] + b'\n')
    (output / 'files.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'samples/files.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return report


FIELDS = {
    'routeline': ('routeId', 'lineSeq', 'subLength', 'sumLength', 'x', 'y'),
    'routestation': ('routeId', 'routeName', 'upDown', 'staOrder', 'stationId', 'stationName', 'x', 'y'),
}


def records(source):
    # GBIS V2는 줄바꿈 대신 ^로 레코드를 구분한다. 큰 원본도 한 번에 메모리에 펼치지 않는다.
    tail = ''
    while chunk := source.read(65536):
        values = (tail + chunk).split('^')
        yield from values[:-1]
        tail = values[-1]
        if len(tail) > 65536:
            raise DataError('전체 파일의 단일 레코드 크기를 초과했습니다.')
    if tail:
        yield tail


def read_table(path, kind, wanted):
    with gzip.open(path, 'rb') as source:
        sample = source.read(8192)
    # 구분자는 CSV 규칙으로 읽되 열의 의미는 공식 항목명 또는 명세의 열 순서로만 정한다.
    encoding = 'utf-8-sig'
    try:
        codecs.getincrementaldecoder(encoding)().decode(sample, final=False)
    except UnicodeDecodeError:
        encoding = 'cp949'
    text = sample.decode(encoding, errors='ignore')
    fields = FIELDS[kind]
    normalize = lambda value: re.sub(r'[^a-z0-9]', '', value.lower())
    expected = [normalize(value) for value in fields]
    prefix_text = text.split('^', 1)[0]
    prefix = next(csv.reader([prefix_text], delimiter='|'), []) if '^' in text and '\n' not in prefix_text and '\r' not in prefix_text else []
    gbis = '^' in text and all(value in [normalize(item) for item in prefix] for value in expected)
    delimiters = []
    for candidate in ('|' if gbis else '|^,\t'):
        try:
            first = prefix if gbis else next(csv.reader(io.StringIO(text), delimiter=candidate), [])
        except csv.Error:
            continue
        names = [normalize(value) for value in first]
        if all(value in names for value in expected) or len(first) == len(fields) and re.fullmatch(r'\d{9}', first[0].strip()):
            delimiters.append(candidate)
    if len(delimiters) != 1:
        raise DataError('전체 파일의 구분자·열 순서를 확인하지 못했습니다.')
    delimiter = delimiters[0]
    groups, rejected = {}, {}
    with gzip.open(path, 'rt', encoding=encoding, newline='') as source:
        reader = csv.reader(records(source) if gbis else source, delimiter=delimiter)
        header = next(reader, [])
        names = [normalize(value) for value in header]
        if 'routeid' in names:
            if not all(value in names for value in expected) or len(set(names)) != len(names):
                raise DataError('전체 파일의 항목명이 공식 명세와 다릅니다.')
            indexes = [names.index(value) for value in expected]
        else:
            if len(header) != len(fields):
                raise DataError('전체 파일의 열 개수가 공식 명세와 다릅니다.')
            indexes = list(range(len(fields)))
            # 헤더 없는 공식 열 순서도 첫 번째 경로점을 잃지 않게 처리한다.
            reader = chain([header], reader)
        for row in reader:
            if not row or len(row) <= indexes[0]:
                continue
            identifier = row[indexes[0]].strip()
            if identifier not in wanted or identifier in rejected:
                continue
            try:
                value = {name: row[index].strip() for name, index in zip(fields, indexes)}
                point = {'lat': float(value['y']), 'lng': float(value['x'])}
                if not 32 <= point['lat'] <= 40 or not 123 <= point['lng'] <= 133:
                    raise ValueError()
                sequence = int(value['lineSeq' if kind == 'routeline' else 'staOrder'])
                if sequence < 0:
                    raise ValueError()
                item = {'sequence': sequence, **point}
                if kind == 'routestation':
                    if not re.fullmatch(r'\d{9}', value['stationId']):
                        raise ValueError()
                    item['id'] = value['stationId']
                    item['direction'] = value['upDown']
                group = groups.setdefault(identifier, [])
                group.append(item)
                if len(group) > 50000:
                    raise ValueError()
            except (ValueError, IndexError):
                rejected[identifier] = '전체 파일의 순서·정류장·좌표 형식 오류'
                groups.pop(identifier, None)
    for identifier, rows in list(groups.items()):
        rows.sort(key=lambda row: row['sequence'])
        if len({row['sequence'] for row in rows}) != len(rows):
            rejected[identifier] = '전체 파일의 중복 순서'
            del groups[identifier]
    return groups, rejected


def verify_files(directory):
    report = json.loads((directory / 'files.json').read_text(encoding='utf-8'))
    if report.get('version') != 1 or report.get('sourceUrl') != SOURCE or set(report.get('files', {})) != set(FILES):
        raise DataError('전체 파일의 출처·파일 목록이 올바르지 않습니다.')
    for name, metadata in report['files'].items():
        if metadata.get('file') != name + '.txt.gz' or not re.fullmatch(r'[a-f0-9]{64}', metadata.get('sha256', '')):
            raise DataError('전체 파일의 이름·해시가 올바르지 않습니다.')
        digest, size, carets, newlines, prefix, tail = hashlib.sha256(), 0, 0, 0, b'', b''
        with gzip.open(directory / metadata['file'], 'rb') as source:
            while chunk := source.read(65536):
                size += len(chunk)
                if size > 512 * 1024 * 1024:
                    raise DataError('전체 파일의 크기 제한을 초과했습니다.')
                digest.update(chunk)
                carets += chunk.count(b'^')
                newlines += chunk.count(b'\n')
                if not prefix:
                    prefix = chunk[:1024]
                tail = chunk[-1:]
        if digest.hexdigest() != metadata['sha256'] or size != metadata.get('bytes'):
            raise DataError('전체 파일의 내용 해시·크기가 다릅니다.')
        if not newlines and prefix.lstrip(b'\xef\xbb\xbf').startswith(b'routeId|') and carets:
            metadata['rows'] = carets + int(tail != b'^') - 1
    version = report['files']['routeline'].get('version', '')
    match = re.search(r'(?<!\d)(20\d{6})(?:\d{0,6})(?!\d)', version)
    try:
        date = datetime.strptime(match[1], '%Y%m%d').date().isoformat() if match else None
    except ValueError:
        date = None
    if not date:
        raise DataError('노선 형상 파일의 기준일을 버전에서 확인하지 못했습니다.')
    return report, date


def terminal_indexes(line, stops, stations):
    """왕복 노선의 상행→하행 전환 정류장을 현재 운행 순서와 대조한다."""
    directions = [station.get('direction') for station in stations]
    changes = [i for i in range(1, len(directions)) if directions[i] != directions[i - 1]]
    if not directions or directions[0] != '상행' or directions[-1] != '하행' or len(changes) != 1:
        return None
    ids = [SHAPES.STOP.fullmatch(identifier) for identifier in line['stops']]
    if not all(ids):
        return None
    try:
        order = SHAPES.align_stations([match[1] for match in ids], stations)
    except DataError:
        return None
    # 일부 구간만 포함한 운행 패턴을 전체 노선의 기·종점으로 오인하지 않는다.
    if order[0] != 0 or order[-1] != len(stations) - 1 or changes[0] not in order:
        return None
    if any(SHAPES.metres(stops[identifier], stations[index]) > 80 for identifier, index in zip(line['stops'], order)):
        return None
    return [0, order.index(changes[0])]


def prepare_terminals(directory, network_dir, output):
    """기존 도로 좌표를 다시 만들지 않고 같은 원본의 기·종점 정보만 보완한다."""
    report, date = verify_files(directory)
    manifest = json.loads((network_dir / 'transit.json').read_text())
    network = json.loads(gzip.decompress((network_dir / manifest['asset']).read_bytes()))
    index = json.loads((output / 'index.json').read_text())
    stops = {stop['id']: stop for stop in network['stops']}
    lines = [line for line in network['lines'] if line['id'] in index['patterns'] and SHAPES.ROUTE.fullmatch(line['id'])]
    stations, _ = read_table(directory / report['files']['routestation']['file'], 'routestation',
                             {SHAPES.ROUTE.fullmatch(line['id'])[1] for line in lines})
    index['terminals'] = {}
    for line in lines:
        endpoints = terminal_indexes(line, stops, stations.get(SHAPES.ROUTE.fullmatch(line['id'])[1], []))
        if endpoints:
            index['terminals'][line['id']] = endpoints
    index['terminalSource'] = {'url': SOURCE, 'date': date}
    (output / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"전체 파일의 기·종점 {len(index['terminals'])}개 운행 패턴 준비 완료 · 외부 요청 없음")


def prepare_files(directory, network_dir, output, api_requests=0):
    report, date = verify_files(directory)
    manifest = json.loads((network_dir / 'transit.json').read_text())
    network = json.loads(gzip.decompress((network_dir / manifest['asset']).read_bytes()))
    stops = {stop['id']: stop for stop in network['stops']}
    groups = {}
    for line in network['lines']:
        match = SHAPES.ROUTE.fullmatch(line['id'])
        if line['mode'] == 'bus' and match:
            groups.setdefault(match[1], []).append(line)
    tables, rejected = {}, {}
    for kind in FILES:
        tables[kind], invalid = read_table(directory / report['files'][kind]['file'], kind, groups)
        rejected.update(invalid)
    output.mkdir(parents=True, exist_ok=True)
    index = {'version': 1, 'patterns': {}, 'terminals': {}, 'terminalSource': {'url': SOURCE, 'date': date}}
    existing = network_dir / 'bus-shapes'
    current = {line['id'] for line in network['lines']}
    if (existing / 'index.json').exists():
        for identifier, asset in json.loads((existing / 'index.json').read_text()).get('patterns', {}).items():
            if identifier in current and isinstance(asset, str) and SHAPES.ASSET.fullmatch(asset) and (existing / asset).is_file():
                index['patterns'][identifier] = asset
                if (existing / asset).resolve() != (output / asset).resolve():
                    shutil.copyfile(existing / asset, output / asset)
    prior = set(index['patterns'])
    reasons, prepared = Counter(), set()
    for number, (identifier, lines) in enumerate(sorted(groups.items()), 1):
        road, stations = tables['routeline'].get(identifier), tables['routestation'].get(identifier)
        reason = rejected.get(identifier) or ('전체 파일에 노선 형상·정류소가 없음' if not road or not stations else None)
        if reason:
            reasons[reason] += len(lines)
            continue
        for line in lines:
            try:
                shape = SHAPES.make_shape(line, stops, stations, road, date)
                shape['source'] = {'name': '경기버스정보(GBIS)', 'url': SOURCE, 'date': date,
                                   'license': '경기도 기반정보 관리 · 이용허락범위 제한 없음'}
                payload = json.dumps(shape, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
                asset = 'shape-' + hashlib.sha256(payload).hexdigest()[:12] + '.json.gz'
                (output / asset).write_bytes(gzip.compress(payload, mtime=0))
                index['patterns'][line['id']] = asset
                endpoints = terminal_indexes(line, stops, stations)
                if endpoints:
                    index['terminals'][line['id']] = endpoints
                prepared.add(line['id'])
            except DataError as error:
                reasons[str(error)] += 1
        if number % 100 == 0:
            print(json.dumps({'checkedRoutes': number, 'preparedPatterns': len(prepared)}, ensure_ascii=False), flush=True)
    audit = {'sourceUrl': SOURCE, 'sourceDate': date, 'sourceFiles': report['files'], 'apiRequests': api_requests,
             'downloadApiRequests': report.get('apiRequests', 0),
             'networkAsset': manifest['asset'], 'eligibleRoutes': len(groups), 'preparedPatterns': len(prepared),
             'newPatterns': len(prepared - prior), 'preservedPatterns': len(prior - prepared),
             'publishedPatterns': len(index['patterns']), 'rejected': dict(reasons)}
    (output / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(audit, ensure_ascii=False), flush=True)
    if not prepared:
        raise DataError('전체 파일에서 기존 교통 자료와 일치하는 노선 형상을 준비하지 못했습니다.')
    referenced = set(index['patterns'].values())
    for path in output.glob('shape-*.json.gz'):
        if SHAPES.ASSET.fullmatch(path.name) and path.name not in referenced:
            path.unlink()
    return audit


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--download', type=Path)
    source.add_argument('--files', type=Path)
    parser.add_argument('--network', type=Path, default=Path('public/data'))
    parser.add_argument('--output', type=Path)
    parser.add_argument('--terminals-only', action='store_true', help='기존 도로 좌표를 유지하고 전체 파일의 기·종점 정보만 보완')
    args = parser.parse_args()
    try:
        if args.download:
            download_files(args.download, os.environ.get('DATA_GO_KR_SERVICE_KEY', ''))
        if args.output:
            if args.terminals_only:
                prepare_terminals(args.files or args.download, args.network, args.output)
            else:
                prepare_files(args.files or args.download, args.network, args.output, api_requests=1 if args.download else 0)
    except (DataError, ApiError) as error:
        raise SystemExit(str(error)) from None
    except (OSError, UnicodeError, csv.Error, json.JSONDecodeError):
        raise SystemExit('전체 파일의 저장·문자 인코딩·내용 형식을 확인해 주세요.') from None
