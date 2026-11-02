"""도로 선형의 방향·순환·정류장 일치와 공개 자료 준비 과정의 키 비노출을 검사한다."""
import gzip
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

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
