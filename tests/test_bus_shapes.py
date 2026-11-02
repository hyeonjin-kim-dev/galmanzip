"""도로 선형의 방향·순환·정류장 일치와 공개 자료 준비 과정의 키 비노출을 검사한다."""
import gzip
import importlib.util
import io
import json
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

SPEC = importlib.util.spec_from_file_location('bus_shapes', Path(__file__).resolve().parents[1] / 'scripts/prepare-bus-shapes.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)
IDS = ['BS_TAGO_GGB000000001', 'BS_TAGO_GGB000000002', 'BS_TAGO_GGB000000003']
POINTS = [dict(lat=37.4, lng=127.1), dict(lat=37.401, lng=127.105), dict(lat=37.4, lng=127.12),
          dict(lat=37.402, lng=127.13), dict(lat=37.4, lng=127.14)]
STOPS = {identifier: dict(id=identifier, name=identifier, **POINTS[index * 2]) for index, identifier in enumerate(IDS)}
STATIONS = [dict(id=f'{index + 1:09}', **POINTS[index * 2]) for index in range(3)]
LINE = dict(id='BR_TAGO_GGB206000007:abcdef123456', mode='bus', name='102번', stops=IDS, seconds=[300, 300], waitSeconds=120)


def xml_rows(rows, name, sequence, identifier=None):
    items = []
    for index, row in enumerate(rows):
        data = f'<{sequence}>{index + 1}</{sequence}><x>{row["lng"]}</x><y>{row["lat"]}</y>'
        if identifier:
            data += f'<{identifier}>{row["id"]}</{identifier}>'
        items.append(f'<{name}>{data}</{name}>')
    return ('<response><msgHeader><resultCode>0</resultCode></msgHeader><msgBody>' + ''.join(items) + '</msgBody></response>').encode()


class ShapeTest(unittest.TestCase):
    def test_road_bends_and_boarding_positions_are_preserved(self):
        shape = BUILD.make_shape(LINE, STOPS, STATIONS, POINTS, '2026-11-02')
        self.assertEqual(shape['points'], POINTS)
        self.assertEqual(shape['stopIndexes'], [0, 2, 4])

    def test_loop_repeated_stop_keeps_the_driving_order(self):
        line = {**LINE, 'stops': [IDS[0], IDS[1], IDS[0], IDS[2]]}
        road = [POINTS[0], POINTS[2], POINTS[0], POINTS[4]]
        stations = [STATIONS[0], STATIONS[1], STATIONS[0], STATIONS[2]]
        shape = BUILD.make_shape(line, STOPS, stations, road, '2026-11-02')
        self.assertEqual(shape['stopIndexes'], [0, 1, 2, 3])

    def test_later_nearest_point_does_not_reverse_the_route(self):
        road = [dict(lat=37.40005, lng=127.1), POINTS[2], POINTS[0]]
        positions = BUILD.road_positions(STATIONS[:2], road)
        self.assertLess(positions[0], 1)
        self.assertGreaterEqual(positions[1], 1)

    def test_reversed_missing_or_moved_stations_are_rejected(self):
        for line, stations in [({**LINE, 'stops': list(reversed(IDS))}, STATIONS), (LINE, STATIONS[:2]),
                               (LINE, [{**station, 'lat': station['lat'] + .01} for station in STATIONS])]:
            with self.assertRaises(BUILD.DataError):
                BUILD.make_shape(line, STOPS, stations, POINTS, '2026-11-02')

    def test_response_contract_and_auth_failure_do_not_expose_key(self):
        rows = BUILD.xml_rows(xml_rows(POINTS, 'busRouteLineList', 'lineSeq'), 'busRouteLineList', 'lineSeq')
        self.assertEqual([(row['lat'], row['lng']) for row in rows], [(row['lat'], row['lng']) for row in POINTS])
        with self.assertRaises(BUILD.ApiError) as caught:
            BUILD.xml_rows(b'<response><resultCode>30</resultCode><message>PRIVATE_KEY</message></response>', 'busRouteLineList', 'lineSeq')
        self.assertNotIn('PRIVATE_KEY', str(caught.exception))
        body = io.BytesIO(b'<response><returnReasonCode>30</returnReasonCode><message>PRIVATE_KEY</message></response>')
        with patch.object(BUILD, 'urlopen', side_effect=HTTPError('https://example.org/?serviceKey=PRIVATE_KEY', 403, 'Forbidden', {}, body)):
            with self.assertRaises(BUILD.ApiError) as caught:
                BUILD.Client('PRIVATE_KEY', 2).get('getBusRouteLineListv2', '206000007')
        self.assertIn('HTTP 403', str(caught.exception))
        self.assertIn('코드 30', str(caught.exception))
        self.assertNotIn('PRIVATE_KEY', str(caught.exception))
        with patch.object(BUILD, 'urlopen', side_effect=URLError('https://example.org/?serviceKey=PRIVATE_KEY')):
            with self.assertRaises(BUILD.ApiError) as caught:
                BUILD.Client('PRIVATE_KEY', 2).get('getBusRouteLineListv2', '206000007')
        self.assertNotIn('PRIVATE_KEY', str(caught.exception))

    def test_request_budget_stops_before_an_extra_api_call(self):
        with patch.object(BUILD, 'urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(b'<response/>')) as send, patch.object(BUILD.time, 'sleep'):
            client = BUILD.Client('PRIVATE_KEY', 2)
            client.get('getBusRouteLineListv2', '206000007')
            client.get('getBusRouteStationListv2', '206000007')
            with self.assertRaises(BUILD.ApiError):
                client.get('getBusRouteLineListv2', '206000007')
            self.assertEqual(send.call_count, 2)

    def test_transient_failure_retries_within_budget_but_auth_failure_does_not(self):
        with patch.object(BUILD, 'urlopen', side_effect=[HTTPError('https://example.org/?serviceKey=PRIVATE_KEY', 503, 'Unavailable', {}, io.BytesIO()),
                                                       io.BytesIO(b'<response/>')]) as send, patch.object(BUILD.time, 'sleep'):
            client = BUILD.Client('PRIVATE_KEY', 2)
            self.assertEqual(client.get('getBusRouteLineListv2', '206000007'), b'<response/>')
            self.assertEqual((client.calls, send.call_count), (2, 2))
        with patch.object(BUILD, 'urlopen', side_effect=HTTPError('https://example.org/?serviceKey=PRIVATE_KEY', 403, 'Forbidden', {}, io.BytesIO())) as send:
            with self.assertRaises(BUILD.ApiError):
                BUILD.Client('PRIVATE_KEY', 10).get('getBusRouteLineListv2', '206000007')
            self.assertEqual(send.call_count, 1)
        exhausted = io.BytesIO(b'<response><returnReasonCode>22</returnReasonCode></response>')
        with patch.object(BUILD, 'urlopen', side_effect=HTTPError('https://example.org/?serviceKey=PRIVATE_KEY', 429, 'Too Many Requests', {}, exhausted)) as send:
            with self.assertRaises(BUILD.ApiError):
                BUILD.Client('PRIVATE_KEY', 10).get('getBusRouteLineListv2', '206000007')
            self.assertEqual(send.call_count, 1)

    def write_network(self, root, lines):
        root.mkdir(exist_ok=True)
        (root / 'transit.json').write_text(json.dumps(dict(asset='transit-test.json.gz')))
        (root / 'transit-test.json.gz').write_bytes(gzip.compress(json.dumps(dict(stops=list(STOPS.values()), lines=lines)).encode()))

    def test_bulk_keeps_valid_data_when_a_later_api_request_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output = Path(folder) / '자료', Path(folder) / '좌표'
            later = {**LINE, 'id': 'BR_TAGO_GGB206000008:abcdef123456'}
            self.write_network(root, [LINE, later])
            responses = iter([xml_rows(POINTS, 'busRouteLineList', 'lineSeq'),
                              xml_rows(STATIONS, 'busRouteStationList', 'stationSeq', 'stationId')])
            def fetch(client, operation, identifier):
                client.calls += 1
                if identifier == '206000008':
                    raise BUILD.ApiError('버스 노선 API 시간 초과')
                return next(responses)
            with patch.object(BUILD.Client, 'get', fetch), redirect_stdout(io.StringIO()):
                report = BUILD.prepare(root, output, 'PRIVATE_KEY', '', 10)
            index = json.loads((output / 'index.json').read_text())
            self.assertIn(LINE['id'], index['patterns'])
            self.assertEqual(report['preparedPatterns'], 1)
            self.assertEqual(report['attemptedRoutes'], ['206000007'])
            self.assertFalse(report['complete'])
            self.assertEqual(report['remainingRoutes'], 1)
            self.assertIn('시간 초과', report['stopReason'])

    def test_bulk_resumes_without_repeating_unavailable_routes_and_refreshes_next_day(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / '자료'
            missing = {**LINE, 'id': 'BR_TAGO_GGB100000001:abcdef123456'}
            self.write_network(root, [LINE, missing])
            def respond(request, **kwargs):
                if parse_qs(urlparse(request.full_url).query)['routeId'] == ['100000001']:
                    return io.BytesIO(b'<response><resultCode>4</resultCode></response>')
                return io.BytesIO(xml_rows(POINTS, 'busRouteLineList', 'lineSeq') if 'getBusRouteLineListv2' in request.full_url
                                  else xml_rows(STATIONS, 'busRouteStationList', 'stationSeq', 'stationId'))
            with patch.object(BUILD, 'urlopen', side_effect=respond), patch.object(BUILD.time, 'sleep'), redirect_stdout(io.StringIO()):
                first = BUILD.prepare(root, root / 'bus-shapes', 'PRIVATE_KEY', '', 10)
            self.assertTrue(first['complete'])
            self.assertEqual(first['rejected'], {'노선 좌표 없음': 1})
            with patch.object(BUILD, 'urlopen') as send, redirect_stdout(io.StringIO()):
                second = BUILD.prepare(root, Path(folder) / '재개', 'PRIVATE_KEY', '', 10)
            self.assertEqual(second['requests'], 0)
            send.assert_not_called()
            audit_path = root / 'bus-shapes' / 'audit.json'
            audit = json.loads(audit_path.read_text())
            audit_path.write_text(json.dumps({**audit, 'date': '2000-01-01'}))
            with patch.object(BUILD, 'urlopen', return_value=io.BytesIO(b'<response><resultCode>4</resultCode></response>')) as send, redirect_stdout(io.StringIO()):
                refreshed = BUILD.prepare(root, Path(folder) / '재확인', 'PRIVATE_KEY', '', 10)
            self.assertEqual(refreshed['requests'], 1)
            self.assertEqual(send.call_count, 1)

    def test_incomplete_scan_resumes_across_days_without_repeating_checked_routes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / '자료'
            self.write_network(root, [LINE])
            def respond(request, **kwargs):
                return io.BytesIO(xml_rows(POINTS, 'busRouteLineList', 'lineSeq') if 'getBusRouteLineListv2' in request.full_url
                                  else xml_rows(STATIONS, 'busRouteStationList', 'stationSeq', 'stationId'))
            with patch.object(BUILD, 'urlopen', side_effect=respond), patch.object(BUILD.time, 'sleep'), redirect_stdout(io.StringIO()):
                BUILD.prepare(root, root / 'bus-shapes', 'PRIVATE_KEY', '206000007', 2)
            lines = [LINE, {**LINE, 'id': 'BR_TAGO_GGB100000001:abcdef123456'}, {**LINE, 'id': 'BR_TAGO_GGB300000001:abcdef123456'}]
            self.write_network(root, lines)
            audit_path = root / 'bus-shapes' / 'audit.json'
            audit = json.loads(audit_path.read_text())
            audit_path.write_text(json.dumps({**audit, 'date': '2000-01-01', 'complete': False,
                                             'attemptedRoutes': ['100000001']}))
            with patch.object(BUILD, 'urlopen', return_value=io.BytesIO(b'<response><resultCode>4</resultCode></response>')) as send, redirect_stdout(io.StringIO()):
                resumed = BUILD.prepare(root, Path(folder) / '재개', 'PRIVATE_KEY', '', 2)
            self.assertEqual(resumed['requests'], 1)
            self.assertEqual(send.call_count, 1)
            self.assertEqual(resumed['attemptedRoutes'], ['100000001', '300000001'])
            self.assertTrue(resumed['complete'])

    def test_parallel_fetches_share_one_request_budget_and_start_interval(self):
        clock, starts, scheduled, guard = [100.0], [], [], threading.Lock()
        def now():
            scheduled.append(clock[0])
            return clock[0]
        def sleep(seconds):
            clock[0] += seconds
        def respond(request, **kwargs):
            with guard:
                starts.append(clock[0])
            return io.BytesIO(b'<response/>')
        client = BUILD.Client('PRIVATE_KEY', 5)
        with patch.object(BUILD.time, 'monotonic', side_effect=now), patch.object(BUILD.time, 'sleep', side_effect=sleep), patch.object(BUILD, 'urlopen', side_effect=respond):
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = [pool.submit(client.get, 'getBusRouteLineListv2', '206000007') for _ in range(8)]
                results = []
                for future in futures:
                    try:
                        results.append(future.result())
                    except BUILD.ApiError:
                        pass
        self.assertEqual(client.calls, 5)
        self.assertEqual(len(starts), 5)
        self.assertEqual(len(results), 5)
        reservations = scheduled[1::2]
        self.assertTrue(all(b - a >= .1999 for a, b in zip(reservations, reservations[1:])))

    def test_preparation_fetches_four_routes_concurrently_without_losing_results(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output = Path(folder) / '자료', Path(folder) / '좌표'
            lines = [{**LINE, 'id': f'BR_TAGO_GGB20600000{number}:abcdef123456'} for number in range(4)]
            self.write_network(root, lines)
            barrier = threading.Barrier(4)
            def respond(request, **kwargs):
                if 'getBusRouteLineListv2' in request.full_url:
                    barrier.wait(timeout=5)
                    return io.BytesIO(xml_rows(POINTS, 'busRouteLineList', 'lineSeq'))
                return io.BytesIO(xml_rows(STATIONS, 'busRouteStationList', 'stationSeq', 'stationId'))
            with patch.object(BUILD, 'urlopen', side_effect=respond), patch.object(BUILD.time, 'sleep'), redirect_stdout(io.StringIO()):
                report = BUILD.prepare(root, output, 'PRIVATE_KEY', '', 8)
            self.assertEqual(report['requests'], 8)
            self.assertEqual(report['preparedPatterns'], 4)
            self.assertEqual(report['publishedPatterns'], 4)
            self.assertTrue(report['complete'])

    def test_preparation_publishes_only_verified_geometry_without_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            root, output = Path(folder) / '자료', Path(folder) / '좌표'
            root.mkdir()
            (root / 'transit.json').write_text(json.dumps(dict(asset='transit-test.json.gz')))
            (root / 'transit-test.json.gz').write_bytes(gzip.compress(json.dumps(dict(stops=list(STOPS.values()), lines=[LINE])).encode()))
            responses = iter([xml_rows(POINTS, 'busRouteLineList', 'lineSeq'), xml_rows(STATIONS, 'busRouteStationList', 'stationSeq', 'stationId')])
            with patch.object(BUILD, 'urlopen', side_effect=lambda *args, **kwargs: io.BytesIO(next(responses))), patch.object(BUILD.time, 'sleep'), redirect_stdout(io.StringIO()) as log:
                report = BUILD.prepare(root, output, 'PRIVATE_KEY', '206000007', 2)
            self.assertEqual(report['requests'], 2)
            self.assertNotIn('PRIVATE_KEY', log.getvalue())
            index = json.loads((output / 'index.json').read_text())
            shape = json.loads(gzip.decompress((output / index['patterns'][LINE['id']]).read_bytes()))
            self.assertEqual(shape['points'], POINTS)
            self.assertEqual(shape['stopIds'], IDS)
            self.assertNotIn('PRIVATE_KEY', json.dumps(shape))


if __name__ == '__main__':
    unittest.main()
