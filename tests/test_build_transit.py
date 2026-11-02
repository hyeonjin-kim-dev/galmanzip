"""운영 자료와 분리된 작은 원본으로 KTDB 변환의 손실·제약 처리를 검증한다."""
import csv
import gzip
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

SPEC = importlib.util.spec_from_file_location('build_transit', Path(__file__).resolve().parents[1] / 'scripts/build-transit.py')
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class ConversionTest(unittest.TestCase):
    def test_route_styles_use_source_category_instead_of_bus_number(self):
        route = {'route_short_name': '102'}
        for category, label, color in [('0_1100_1', '간선', '#2876D5'), ('0_3100_01', '일반', '#2A9B48'),
                                       ('0_3100_03', '직행좌석', '#E60012')]:
            self.assertEqual(BUILD.route_style(route, dict(mode=0, category=category)), dict(typeName=label, color=color))
        self.assertEqual(BUILD.route_style(route, dict(mode=0, category='미분류')), dict(typeName='버스', color='#64748B'))

    def test_known_rail_lines_and_bus_types_have_distinct_stable_colors(self):
        rail = BUILD.STYLES['rail']
        self.assertEqual(len({style['color'] for style in rail.values()}), len(rail))
        self.assertEqual(BUILD.route_style({'route_short_name': '수인분당선'}, dict(mode=1)),
                         dict(typeName='수인분당선', color='#F5A200'))
        self.assertEqual(BUILD.route_style({'route_short_name': '신분당선'}, dict(mode=1)),
                         dict(typeName='신분당선', color='#D4003B'))
        bus = {style['typeName']: style['color'] for style in BUILD.STYLES['bus'].values()}
        self.assertEqual(len(set(bus.values())), len(bus))

    def test_source_specific_modes_and_time(self):
        self.assertTrue(BUILD.in_scope(dict(mode=0, category='0_3111', region='수원시')))
        self.assertTrue(BUILD.in_scope(dict(mode=1, category='', region='수도권')))
        self.assertFalse(BUILD.in_scope(dict(mode=3, category='0_3111', region='수원시')))
        self.assertFalse(BUILD.in_scope(dict(mode=1, category='', region='부산권')))
        self.assertEqual(BUILD.clock('25:10:03'), 90603)
        for value in ('01:65:00', '-1:00:00', '48:00:00'):
            with self.assertRaises(ValueError): BUILD.clock(value)
        self.assertEqual(BUILD.average_wait([0, 600, 600, 2400]), 750)
        self.assertIsNone(BUILD.average_wait([600, 600]))

    def test_dwell_direction_restrictions_and_missing_headways(self):
        with tempfile.TemporaryDirectory() as folder:
            source, output = Path(folder) / '원본.zip', Path(folder) / '결과'
            meta = {'bus': dict(mode=0, category='0_1100_1', region='서울특별시')}
            with ZipFile(source, 'w') as archive:
                def table(name, header, rows):
                    data = io.StringIO(newline='')
                    writer = csv.writer(data)
                    writer.writerow(header.split(','))
                    writer.writerows(rows)
                    archive.writestr('202503_GTFS_DataSet/' + name, data.getvalue().encode('utf-8-sig'))
                table('routes.txt', 'route_id,route_short_name,route_long_name,route_type', [('bus', '검증', '검증용 노선', 0)])
                table('stops.txt', 'stop_id,stop_name,stop_lat,stop_lon', [('A', '가', 37.5, 127), ('B', '나', 37.51, 127), ('C', '다', 37.52, 127)])
                table('trips.txt', 'trip_id,route_id', [(key, 'bus') for key in ('one', 'two', 'reverse', 'night')])
                times = []
                for trip, hour in [('one', '06'), ('two', '07')]:
                    times += [(trip, hour + ':00:00', hour + ':00:00', 'A', 1, 0, 1, 1),
                              (trip, hour + ':05:00', hour + ':05:30', 'B', 2, 1, 0, 1),
                              (trip, hour + ':10:00', hour + ':10:00', 'C', 3, 1, 0, 1)]
                for trip, hour in [('reverse', '08'), ('night', '25')]:
                    times += [(trip, hour + ':00:00', hour + ':00:00', 'C', 1, 0, 0, 1),
                              (trip, hour + ':05:00', hour + ':05:00', 'A', 2, 0, 0, 1)]
                table('stop_times.txt', 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type,timepoint', times)
                table('transfers.txt', 'from_stop_id,to_stop_id,transfer_type,min_transfer_time', [('A', 'B', 2, 180)])
            with patch.object(BUILD, 'metadata', return_value=meta), redirect_stdout(io.StringIO()):
                BUILD.convert(source, output)
            manifest = json.loads((output / 'transit.json').read_text())
            graph = json.loads(gzip.decompress((output / manifest['asset']).read_bytes()))
            audit = json.loads((output / 'audit.json').read_text())
            self.assertEqual(len(graph['lines']), 1)
            line = graph['lines'][0]
            self.assertEqual(line['typeName'], '간선')
            self.assertEqual(line['color'], '#2876D5')
            self.assertEqual(line['stops'], ['A', 'B', 'C'])
            self.assertEqual(line['seconds'], [300, 270])
            self.assertEqual(line['dwellSeconds'], [0, 30, 0])
            self.assertEqual(line['waitSeconds'], 1800)
            self.assertEqual(line['pickup'], [True, False, False])
            self.assertEqual(line['dropoff'], [False, True, True])
            self.assertEqual(graph['transfers'], [{'from': 'A', 'to': 'B', 'seconds': 180}])
            self.assertEqual(audit['singleDeparturePatterns'], 1)
            self.assertEqual(audit['outsideHours'], 1)
            self.assertEqual(audit['invalidTrips'], {})

    def test_future_feed_requires_reinspection(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / '새자료.zip'
            with ZipFile(source, 'w') as archive: archive.writestr('202603_GTFS_DataSet/stop_times.txt', '')
            with self.assertRaisesRegex(ValueError, '설명서부터 확인'):
                BUILD.convert(source, Path(folder) / '결과')


if __name__ == '__main__':
    unittest.main()
