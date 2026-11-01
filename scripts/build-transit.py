"""KTDB 2025년 3월 자료를 평균 소요시간 탐색용 수도권 교통망으로 변환한다."""
import argparse
import csv
import gzip
import hashlib
import io
import json
import math
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
START, END = 6 * 3600, 20 * 3600


def unique_member(archive, suffix):
    names = [name for name in archive.namelist() if name.endswith(suffix)]
    if len(names) != 1:
        raise ValueError(f'원본에서 {suffix} 파일을 하나로 식별하지 못했습니다.')
    return names[0]


def metadata(archive):
    with ZipFile(io.BytesIO(archive.read(unique_member(archive, '.xlsx')))) as book:
        shared = []
        if 'xl/sharedStrings.xml' in book.namelist():
            shared = [''.join(node.itertext()) for node in ET.fromstring(book.read('xl/sharedStrings.xml'))]
        workbook = ET.fromstring(book.read('xl/workbook.xml'))
        sheet = next(node for node in workbook.find('x:sheets', NS) if node.get('name') == '유형')
        relation = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        target = next(node.get('Target') for node in ET.fromstring(book.read('xl/_rels/workbook.xml.rels')) if node.get('Id') == relation)
        sheet_path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        found_header = False
        result = {}
        for row in ET.fromstring(book.read(sheet_path)).find('x:sheetData', NS):
            cells = {}
            for cell in row:
                key = ''.join(char for char in cell.get('r', '') if char.isalpha())
                value = cell.findtext('x:v', '', NS)
                if cell.get('t') == 's': value = shared[int(value)]
                elif cell.get('t') == 'inlineStr': value = ''.join(cell.find('x:is', NS).itertext())
                cells[key] = value
            if cells.get('A') == 'route_id':
                found_header = True
                continue
            if not found_header or not cells.get('A'): continue
            result[cells['A']] = {'mode': int(cells['E']), 'region': cells.get('F', ''), 'category': cells.get('G', '')}
        if not result: raise ValueError('노선 상세 엑셀의 영문 열 이름을 찾지 못했습니다.')
        return result


def in_scope(info):
    # KTDB 전용 수단 코드다. 국제 GTFS의 route_type 의미로 해석하지 않는다.
    return (info['mode'] == 1 and info['region'] == '수도권'
            or info['mode'] == 0 and info['category'].startswith(('0_11', '0_23', '0_31')))


def clock(value):
    pieces = value.split(':')
    if len(pieces) != 3 or not all(piece.isdigit() for piece in pieces):
        raise ValueError('시각 형식 오류')
    hours, minutes, seconds = map(int, pieces)
    if hours > 47 or minutes > 59 or seconds > 59: raise ValueError('시각 범위 오류')
    return hours * 3600 + minutes * 60 + seconds


def average_wait(departures):
    ordered = sorted(set(departures))
    gaps = [b - a for a, b in zip(ordered, ordered[1:])]
    if not gaps: return None
    # 운행 중 임의 시점 도착 시의 평균 대기. 긴 배차 간격의 영향도 포함한다.
    return math.ceil(sum(gap * gap for gap in gaps) / (2 * sum(gaps)))


def convert(source, destination):
    report = {'rows': 0, 'selectedTrips': 0, 'acceptedTrips': 0, 'outsideHours': 0,
              'invalidTrips': {}, 'invalidExamples': [], 'singleDeparturePatterns': 0,
              'zeroSegments': 0, 'nonzeroDwells': 0}
    patterns = {}
    used_routes = set()
    with ZipFile(source) as archive:
        if unique_member(archive, '/stop_times.txt') != '202503_GTFS_DataSet/stop_times.txt':
            raise ValueError('이 변환기는 확인한 2025년 3월 KTDB 자료 전용입니다. 새 자료는 설명서부터 확인해 주세요.')
        def table(name):
            return csv.DictReader(io.TextIOWrapper(archive.open(unique_member(archive, '/' + name)), encoding='utf-8-sig', newline=''))

        meta = metadata(archive)
        selected = {key for key, value in meta.items() if in_scope(value)}
        if not selected: raise ValueError('변환할 수도권 노선이 없습니다.')
        routes = {row['route_id']: row for row in table('routes.txt') if row['route_id'] in selected}
        if routes.keys() != selected: raise ValueError('선택한 노선의 기본정보가 누락되었습니다.')
        for key, route in routes.items():
            if int(route['route_type']) != meta[key]['mode']: raise ValueError('노선 수단 코드가 엑셀과 다릅니다.')
        stops = {row['stop_id']: {'id': row['stop_id'], 'name': row['stop_name'], 'lat': float(row['stop_lat']), 'lng': float(row['stop_lon'])} for row in table('stops.txt')}
        trips = {row['trip_id']: row['route_id'] for row in table('trips.txt') if row['route_id'] in selected}
        report['selectedTrips'] = len(trips)
        report['selectedRoutes'] = len(routes)
        print(f'선택 노선 {len(routes):,}개 · 운행 회차 {len(trips):,}개', flush=True)

        def consume(trip_id, rows):
            if not rows: return
            try:
                ordered = sorted(rows, key=lambda row: int(row[4]))
                if len(ordered) < 2: raise ValueError('정차지 부족')
                if len({row[4] for row in ordered}) != len(ordered): raise ValueError('정차 순서 중복')
                arrivals = [clock(row[1]) for row in ordered]
                departures = [clock(row[2]) for row in ordered]
                if not START <= departures[0] < END:
                    report['outsideHours'] += 1
                    return
                ids = tuple(row[3] for row in ordered)
                if any(key not in stops for key in ids): raise ValueError('정류장 누락')
                if any(not 32 <= stops[key]['lat'] <= 40 or not 123 <= stops[key]['lng'] <= 133 for key in ids): raise ValueError('좌표 범위 오류')
                if any(row[5] not in ('0', '1') or row[6] not in ('0', '1') for row in ordered): raise ValueError('승하차 제약 미지원')
                pickup, dropoff = tuple(row[5] == '0' for row in ordered), tuple(row[6] == '0' for row in ordered)
                dwell = [dep - arr for arr, dep in zip(arrivals, departures)]
                running = [arrivals[i + 1] - departures[i] for i in range(len(ids) - 1)]
                if min(dwell) < 0 or min(running) < 0: raise ValueError('시각 역전')
                if min(running) == 0: raise ValueError('구간 시간 누락')
                key = trips[trip_id], ids, pickup, dropoff
                pattern = patterns.setdefault(key, {'running': [0] * len(running), 'dwells': [0] * len(dwell), 'departures': [], 'count': 0})
                pattern['count'] += 1
                pattern['departures'].append(departures[0])
                for i, seconds in enumerate(running): pattern['running'][i] += seconds
                for i, seconds in enumerate(dwell): pattern['dwells'][i] += seconds
                report['acceptedTrips'] += 1
                report['zeroSegments'] += running.count(0)
                report['nonzeroDwells'] += sum(seconds > 0 for seconds in dwell)
            except (ValueError, KeyError) as error:
                reason = str(error)
                report['invalidTrips'][reason] = report['invalidTrips'].get(reason, 0) + 1
                if len(report['invalidExamples']) < 20: report['invalidExamples'].append({'trip': trip_id, 'reason': reason})

        seen = set()
        current, rows = None, []
        with io.TextIOWrapper(archive.open(unique_member(archive, '/stop_times.txt')), encoding='utf-8-sig', newline='') as stream:
            reader = csv.reader(stream)
            if next(reader) != ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'pickup_type', 'drop_off_type', 'timepoint']:
                raise ValueError('정차 시각표의 열 구성을 확인해야 합니다.')
            for row in reader:
                report['rows'] += 1
                if report['rows'] % 2_000_000 == 0: print(f'정차 시각표 {report["rows"]:,}행 확인', flush=True)
                trip_id = row[0]
                if trip_id not in trips: continue
                if current != trip_id:
                    consume(current, rows)
                    if trip_id in seen: raise ValueError('운행 회차가 나뉘어 나타납니다. 정렬 후 변환해야 합니다.')
                    seen.add(trip_id)
                    current, rows = trip_id, []
                rows.append(row)
            consume(current, rows)
        report['missingTrips'] = len(trips.keys() - seen)

        lines, used_stops = [], set()
        for (route_id, ids, pickup, dropoff), pattern in sorted(patterns.items()):
            wait = average_wait(pattern['departures'])
            if wait is None:
                report['singleDeparturePatterns'] += 1
                continue
            route = routes[route_id]
            line = {'id': route_id + ':' + hashlib.sha256(json.dumps([ids, pickup, dropoff]).encode()).hexdigest()[:12],
                    'name': route['route_long_name'] if meta[route_id]['mode'] == 1 else route['route_short_name'] + '번',
                    'mode': 'rail' if meta[route_id]['mode'] == 1 else 'bus', 'stops': ids,
                    'seconds': [math.ceil(seconds / pattern['count']) for seconds in pattern['running']],
                    'dwellSeconds': [math.ceil(seconds / pattern['count']) for seconds in pattern['dwells']],
                    'waitSeconds': wait, 'pickup': pickup, 'dropoff': dropoff}
            lines.append(line)
            used_routes.add(route_id)
            used_stops.update(ids)
        if not lines: raise ValueError('배차와 구간 시간을 확인할 수 있는 노선이 없습니다.')
        transfers = []
        for row in table('transfers.txt'):
            if row['from_stop_id'] not in used_stops or row['to_stop_id'] not in used_stops: continue
            if row['transfer_type'] != '2': raise ValueError('환승 유형을 다시 확인해야 합니다.')
            transfers.append({'from': row['from_stop_id'], 'to': row['to_stop_id'], 'seconds': int(row['min_transfer_time'])})
        stop_modes = {}
        for line in lines:
            for key in line['stops']: stop_modes[key] = line['mode']
        graph = {'version': 1, 'status': 'ready',
                 'source': {'name': '국가교통DB(KTDB) 대중교통 GTFS',
                            'url': 'https://www.ktdb.go.kr/www/selectBbsNttView.do?bbsNo=2&key=45&nttNo=3831',
                            'date': '2025년 3월 평일 하루', 'reference': '06~20시 출발 회차의 운행 중 평균',
                            'license': '출처: 국토교통부·한국교통연구원 국가교통DB. 가공: 갈만집. KTDB 저작권정책의 출처 표시 기준.'},
                 'coverage': '서울·경기·인천 시내·마을·광역버스와 수도권 도시철도 자료 기준. 아파트 조회는 서울·경기로 한정합니다. 시외·공항버스, 일반·고속철도, 야간 전용 노선과 배차 추정이 불가능한 운행 패턴은 제외합니다.',
                 'stops': [{**stops[key], 'mode': stop_modes[key]} for key in sorted(used_stops)],
                 'lines': lines, 'transfers': sorted(transfers, key=lambda row: (row['from'], row['to']))}
        report.update({'outputStops': len(used_stops), 'outputPatterns': len(lines), 'outputRoutes': len(used_routes),
                       'outputTransfers': len(transfers), 'outputRegions': dict(sorted(Counter(meta[key]['region'] for key in used_routes).items())),
                       'excludedRoutes': sorted(selected - used_routes)})
    destination.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(graph, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')
    asset = 'transit-' + hashlib.sha256(payload).hexdigest()[:12] + '.json.gz'
    (destination / asset).write_bytes(gzip.compress(payload, mtime=0))
    (destination / 'transit.json').write_text(json.dumps({'version': 1, 'status': 'ready', 'asset': asset}, indent=2) + '\n')
    with source.open('rb') as stream: report['sourceSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    report['jsonBytes'] = len(payload)
    report['gzipBytes'] = (destination / asset).stat().st_size
    (destination / 'audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key not in ('excludedRoutes', 'invalidExamples')}, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='복원한 KTDB 원본 ZIP')
    parser.add_argument('output', type=Path, help='변환 결과와 검증 보고서를 쓸 폴더')
    args = parser.parse_args()
    convert(args.source, args.output)
