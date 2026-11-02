"""GBIS의 실제 노선 좌표를 검증해 선택 경로용 정적 자료로 준비한다."""
import argparse
import bisect
import gzip
import hashlib
import json
import math
import os
import re
import shutil
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, unquote
from urllib.request import Request, urlopen
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

SOURCE_URL = 'https://www.data.go.kr/data/15080662/openapi.do'
ASSET = re.compile(r'shape-[a-f0-9]{12}\.json\.gz')
ROUTE = re.compile(r'BR_TAGO_(?:GGB|SEB|ICB)(\d{9}):[a-f0-9]{12}')
STOP = re.compile(r'BS_TAGO_(?:GGB|SEB|ICB)(\d{9})')


class DataError(ValueError):
    pass


class ApiError(RuntimeError):
    pass


def metres(a, b):
    rad = math.pi / 180
    value = math.sin((a['lat'] - b['lat']) * rad / 2) ** 2
    value += math.cos(a['lat'] * rad) * math.cos(b['lat'] * rad) * math.sin((a['lng'] - b['lng']) * rad / 2) ** 2
    return 12742000 * math.asin(min(1, math.sqrt(value)))


def xml_rows(payload, name, sequence, identifier=None):
    try:
        root = ET.fromstring(payload)
        for node in root.iter():
            node.tag = node.tag.rsplit('}', 1)[-1]
        code = root.findtext('.//resultCode', '').strip()
        if code == '4':
            return []
        if code != '0':
            raise ApiError('API 인증·이용 한도·서비스 상태를 확인해 주세요.')
        rows = []
        for node in root.findall('.//' + name):
            point = {'lat': float(node.findtext('y', '')), 'lng': float(node.findtext('x', ''))}
            if not 32 <= point['lat'] <= 40 or not 123 <= point['lng'] <= 133:
                raise DataError('좌표 범위 오류')
            row = {'sequence': int(node.findtext(sequence, '')), **point}
            if identifier:
                row['id'] = node.findtext(identifier, '').strip()
                if not re.fullmatch(r'\d{9}', row['id']):
                    raise DataError('정류장 ID 오류')
            rows.append(row)
        rows.sort(key=lambda row: row['sequence'])
        if len({row['sequence'] for row in rows}) != len(rows):
            raise DataError('중복 순서')
        return rows
    except (ET.ParseError, TypeError, ValueError) as error:
        if isinstance(error, DataError):
            raise
        raise DataError('API 좌표 자료 형식 오류') from None


def align_stations(ids, stations):
    positions = {}
    for index, station in enumerate(stations):
        positions.setdefault(station['id'], []).append(index)
    choices = []
    for first in positions.get(ids[0], []):
        chosen = [first]
        for identifier in ids[1:]:
            options = positions.get(identifier, [])
            next_index = bisect.bisect_right(options, chosen[-1])
            if next_index == len(options):
                break
            chosen.append(options[next_index])
        if len(chosen) == len(ids):
            choices.append(chosen)
    if not choices:
        raise DataError('현재 노선과 정류장 순서 불일치')
    return min(choices, key=lambda choice: choice[-1] - choice[0])


def road_positions(stations, road):
    # 가장 가까운 점만 고르면 순환·왕복 노선의 반대 방향으로 붙을 수 있어 전체 순서를 함께 확인한다.
    scale_x = 111320 * math.cos(stations[0]['lat'] * math.pi / 180)
    projected = [(point['lng'] * scale_x, point['lat'] * 111320) for point in road]
    layers = []
    for station in stations:
        x, y = station['lng'] * scale_x, station['lat'] * 111320
        candidates = {}
        for index, (a, b) in enumerate(zip(projected, projected[1:])):
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = dx * dx + dy * dy
            if length == 0:
                continue
            ratio = min(1, max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / length))
            error = (x - a[0] - ratio * dx) ** 2 + (y - a[1] - ratio * dy) ** 2
            if error <= 80 ** 2:
                position = round(index + ratio, 10)
                candidates[position] = min(candidates.get(position, math.inf), error)
        current, previous, cursor, best = [], layers[-1] if layers else [], 0, -1
        for position, error in sorted(candidates.items()):
            while cursor < len(previous) and previous[cursor][0] <= position:
                if best < 0 or previous[cursor][1] < previous[best][1]:
                    best = cursor
                cursor += 1
            if not layers or best >= 0:
                current.append((position, error + (previous[best][1] if layers else 0), best))
        if not current:
            raise DataError('도로 좌표와 정류장 위치·방향 불일치')
        layers.append(current)
    selected = min(range(len(layers[-1])), key=lambda index: layers[-1][index][1])
    result = []
    for layer in reversed(layers):
        position, _, selected = layer[selected]
        result.append(position)
    return list(reversed(result))


def make_shape(line, stops, stations, road, date):
    if len(road) < 2 or len(road) > 50000:
        raise DataError('노선 좌표 수 오류')
    ids = []
    for identifier in line['stops']:
        match = STOP.fullmatch(identifier)
        if not match:
            raise DataError('정류장 ID를 제공기관 자료와 연결할 수 없음')
        ids.append(match[1])
    order = align_stations(ids, stations)
    selected = [stations[index] for index in order]
    if any(metres(stops[identifier], station) > 80 for identifier, station in zip(line['stops'], selected)):
        raise DataError('기존 정류장과 현재 정류장 위치 불일치')
    anchors = road_positions(selected, road)
    if anchors[-1] <= anchors[0]:
        raise DataError('운행 방향을 확인할 수 없음')
    events = sorted(set(anchors) | set(range(math.ceil(anchors[0]), math.floor(anchors[-1]) + 1)))
    points, offsets = [], {}
    for position in events:
        index = min(math.floor(position), len(road) - 2)
        ratio = position - index
        point = {key: round(road[index][key] + ratio * (road[index + 1][key] - road[index][key]), 6) for key in ('lat', 'lng')}
        if not points or point != points[-1]:
            points.append(point)
        offsets[position] = len(points) - 1
    indexes = [offsets[anchor] for anchor in anchors]
    if any(metres(stops[identifier], points[index]) > 80 for identifier, index in zip(line['stops'], indexes)):
        raise DataError('정류장과 도로 연결 거리 초과')
    return {'version': 1, 'lineId': line['id'], 'stopIds': line['stops'], 'stopIndexes': indexes, 'points': points,
            'source': {'name': '경기버스정보(GBIS)', 'url': SOURCE_URL, 'date': date,
                       'license': '경기도 버스노선 조회 · 이용허락범위 제한 없음'}}


class Client:
    def __init__(self, key, budget):
        self.key, self.budget, self.calls = unquote(key.strip()), budget, 0

    def get(self, operation, route_id):
        if self.calls >= self.budget:
            raise ApiError('설정한 요청 수에 도달했습니다.')
        self.calls += 1
        if self.calls > 1:
            time.sleep(.2)
        url = 'https://apis.data.go.kr/6410000/busrouteservice/v2/' + operation
        url += '?' + urlencode({'serviceKey': self.key, 'routeId': route_id, 'format': 'xml'})
        try:
            with urlopen(Request(url, headers={'User-Agent': 'Galmanzip-bus-shapes/1.0'}), timeout=20) as response:
                payload = response.read(8 * 1024 * 1024 + 1)
            if len(payload) > 8 * 1024 * 1024:
                raise DataError('API 응답 크기 초과')
            return payload
        except (HTTPError, URLError, TimeoutError, OSError):
            # 예외의 URL·응답 본문에는 인증키가 포함될 수 있으므로 출력하지 않는다.
            raise ApiError('버스 노선 API 연결·인증·서비스 상태를 확인해 주세요.') from None


def prepare(network_dir, output, key, route_id='', max_requests=200):
    manifest = json.loads((network_dir / 'transit.json').read_text())
    network = json.loads(gzip.decompress((network_dir / manifest['asset']).read_bytes()))
    stops = {stop['id']: stop for stop in network['stops']}
    groups = {}
    for line in network['lines']:
        match = ROUTE.fullmatch(line['id'])
        if line['mode'] == 'bus' and match and (not route_id or match[1] == route_id):
            groups.setdefault(match[1], []).append(line)
    if not groups:
        raise DataError('지정한 노선 ID를 현재 교통 자료에서 찾지 못했습니다.')
    output.mkdir(parents=True, exist_ok=True)
    existing = network_dir / 'bus-shapes'
    index = {'version': 1, 'patterns': {}}
    if (existing / 'index.json').exists():
        published = json.loads((existing / 'index.json').read_text())
        current = {line['id'] for line in network['lines']}
        for identifier, asset in published.get('patterns', {}).items():
            if identifier in current and isinstance(asset, str) and ASSET.fullmatch(asset) and (existing / asset).is_file():
                index['patterns'][identifier] = asset
                if (existing / asset).resolve() != (output / asset).resolve():
                    shutil.copyfile(existing / asset, output / asset)
    client, reasons, added = Client(key, max_requests), Counter(), 0
    date = datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
    for identifier, lines in sorted(groups.items(), key=lambda item: (item[0] != '206000007', item[0])):
        if not route_id:
            lines = [line for line in lines if line['id'] not in index['patterns']]
            if not lines:
                continue
        if client.calls + 2 > max_requests:
            break
        road = xml_rows(client.get('getBusRouteLineListv2', identifier), 'busRouteLineList', 'lineSeq')
        if not road:
            reasons['노선 좌표 없음'] += len(lines)
            continue
        stations = xml_rows(client.get('getBusRouteStationListv2', identifier), 'busRouteStationList', 'stationSeq', 'stationId')
        for line in lines:
            try:
                shape = make_shape(line, stops, stations, road, date)
                payload = json.dumps(shape, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
                asset = 'shape-' + hashlib.sha256(payload).hexdigest()[:12] + '.json.gz'
                (output / asset).write_bytes(gzip.compress(payload, mtime=0))
                index['patterns'][line['id']] = asset
                added += 1
            except DataError as error:
                reasons[str(error)] += 1
    report = {'requests': client.calls, 'preparedPatterns': added, 'publishedPatterns': len(index['patterns']),
              'rejected': dict(reasons), 'sourceUrl': SOURCE_URL, 'date': date}
    (output / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (output / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if not added and (route_id or not index['patterns']):
        raise DataError('조건에 맞는 도로 좌표를 준비하지 못했습니다.')
    referenced = set(index['patterns'].values())
    for path in output.glob('shape-*.json.gz'):
        if ASSET.fullmatch(path.name) and path.name not in referenced:
            path.unlink()
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', type=Path, default=Path('public/data'))
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--request', type=Path)
    parser.add_argument('--route-id', default=os.environ.get('BUS_SHAPE_ROUTE_ID', '206000007'))
    parser.add_argument('--max-requests', type=int, default=int(os.environ.get('BUS_SHAPE_MAX_REQUESTS', '200')))
    args = parser.parse_args()
    key = os.environ.get('DATA_GO_KR_SERVICE_KEY', '').strip()
    if not key:
        raise SystemExit('공공데이터포털 인증키 DATA_GO_KR_SERVICE_KEY를 비밀 값으로 등록해 주세요.')
    if args.request and args.request.exists():
        request = json.loads(args.request.read_text(encoding='utf-8'))
        args.route_id, args.max_requests = request.get('routeId', args.route_id), request.get('maxRequests', args.max_requests)
    if not isinstance(args.route_id, str) or args.route_id and not re.fullmatch(r'\d{9}', args.route_id):
        raise SystemExit('노선 ID는 9자리 숫자여야 합니다. 전체 조회는 빈 문자열을 사용해 주세요.')
    if not isinstance(args.max_requests, int) or not 2 <= args.max_requests <= 2000:
        raise SystemExit('한 번의 요청 수는 2~2000 사이로 지정해 주세요.')
    try:
        prepare(args.network, args.output, key, args.route_id, args.max_requests)
    except (DataError, ApiError) as error:
        raise SystemExit(str(error)) from None
