"""전체 파일의 인증·공식 출처·공개 결과물에서 비밀 값이 섞이지 않는지 검사한다."""
import gzip
import csv
import hashlib
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch
from test_bus_shapes import LINE, STOPS, STATIONS, POINTS

SPEC = importlib.util.spec_from_file_location('bus_files', Path(__file__).resolve().parents[1] / 'scripts/bus_files.py')
FILES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FILES)
CATALOG = b'''<response><msgHeader><resultCode>0</resultCode></msgHeader><msgBody><baseInfoItem>
<routeLineDownloadUrl>https://openapi.gbis.go.kr/ws/download/routeline20261102V2.txt</routeLineDownloadUrl><routeLineVersion>20261102</routeLineVersion>
<routeStationDownloadUrl>https://openapi.gbis.go.kr/ws/download/routestation20261102V2.txt</routeStationDownloadUrl><routeStationVersion>20261102</routeStationVersion>
</baseInfoItem></msgBody></response>'''


class FileTest(unittest.TestCase):
    def fixture(self, folder, delimiter='|', header=True, encoding='utf-8-sig', record_separator='\r\n', directions=None):
        directory, network = Path(folder) / '전체 파일', Path(folder) / '교통 자료'
        directory.mkdir(exist_ok=True)
        network.mkdir(exist_ok=True)
        (network / 'transit.json').write_text(json.dumps({'asset': 'transit-test.json.gz'}))
        (network / 'transit-test.json.gz').write_bytes(gzip.compress(json.dumps({'stops': list(STOPS.values()), 'lines': [LINE]}).encode()))
        report = {'version': 1, 'sourceUrl': FILES.SOURCE, 'files': {}}
        for kind in FILES.FILES:
            text = io.StringIO(newline='')
            writer = csv.writer(text, delimiter=delimiter, lineterminator=record_separator)
            if header:
                writer.writerow(FILES.FIELDS[kind])
            if kind == 'routeline':
                for index, point in enumerate(POINTS):
                    writer.writerow(['206000007', index + 1, 0, 0, point['lng'], point['lat']])
            else:
                for index, point in enumerate(STATIONS):
                    writer.writerow(['206000007', '102번', directions[index] if directions else 0, index + 1, point['id'], '검증 정류장, 별칭', point['lng'], point['lat']])
            payload = text.getvalue().encode(encoding)
            name = kind + '.txt.gz'
            (directory / name).write_bytes(gzip.compress(payload, mtime=0))
            report['files'][kind] = {'file': name, 'version': '20261102', 'bytes': len(payload),
                                     'sha256': hashlib.sha256(payload).hexdigest(), 'rows': payload.count(b'\n')}
        (directory / 'files.json').write_text(json.dumps(report))
        return directory, network

    def test_only_one_catalog_call_then_two_bulk_files_without_published_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            responses = iter([CATALOG, b'routeId|lineSeq|x|y\n206000007|1|127.1|37.4\n',
                              b'routeId|staOrder|stationId|x|y\n206000007|1|000000001|127.1|37.4\n'])
            with patch.object(FILES, 'open_resource', side_effect=lambda *args: io.BytesIO(next(responses))) as send, redirect_stdout(io.StringIO()) as log:
                report = FILES.download_files(Path(folder), 'PRIVATE_KEY')
            self.assertEqual(send.call_count, 3)
            self.assertIn('baseinfoservice', send.call_args_list[0].args[0])
            self.assertNotIn('serviceKey', send.call_args_list[1].args[0])
            self.assertEqual(report['apiRequests'], 1)
            self.assertEqual(set(report['files']), {'routeline', 'routestation'})
            self.assertNotIn('PRIVATE_KEY', log.getvalue())
            self.assertNotIn('PRIVATE_KEY', (Path(folder) / 'files.json').read_text())
            self.assertIn(b'206000007', gzip.decompress((Path(folder) / 'routeline.txt.gz').read_bytes()))

    def test_unapproved_or_exhausted_catalog_does_not_expose_provider_messages(self):
        for code in (22, 30):
            with self.assertRaises(FILES.ApiError) as caught:
                FILES.parse_catalog(f'<response><returnReasonCode>{code}</returnReasonCode><message>PRIVATE_KEY</message></response>'.encode())
            self.assertNotIn('PRIVATE_KEY', str(caught.exception))
            self.assertIn(str(code), str(caught.exception))

    def test_foreign_hosts_credentials_and_redirects_are_rejected(self):
        for url in ('https://example.org/data.txt', 'https://openapi.gbis.go.kr.evil.test/data.txt',
                    'https://user:PRIVATE_KEY@openapi.gbis.go.kr/data.txt',
                    'https://openapi.gbis.go.kr/data.txt?serviceKey=PRIVATE_KEY'):
            with self.assertRaises(FILES.DataError):
                FILES.check_url(url, FILES.FILE_HOSTS)
        redirect = FILES.SafeRedirect(FILES.FILE_HOSTS)
        with self.assertRaises(FILES.DataError):
            redirect.redirect_request(None, None, 302, '', {}, 'https://example.org/data.txt')

    def test_incomplete_catalog_is_not_treated_as_a_successful_download(self):
        with self.assertRaises(FILES.DataError):
            FILES.parse_catalog(b'<response><resultCode>0</resultCode></response>')

    def test_offline_preparation_never_calls_api_and_keeps_real_road_vertices(self):
        with tempfile.TemporaryDirectory() as folder:
            directory, network = self.fixture(folder)
            output = Path(folder) / '배포 좌표'
            with patch.object(FILES, 'open_resource') as request, redirect_stdout(io.StringIO()):
                audit = FILES.prepare_files(directory, network, output)
            request.assert_not_called()
            self.assertEqual(audit['apiRequests'], 0)
            self.assertEqual(audit['preparedPatterns'], 1)
            self.assertEqual(audit['sourceDate'], '2026-11-02')
            index = json.loads((output / 'index.json').read_text())
            shape = json.loads(gzip.decompress((output / index['patterns'][LINE['id']]).read_bytes()))
            self.assertEqual(shape['points'], POINTS)
            self.assertEqual(shape['stopIndexes'], [0, 2, 4])
            self.assertEqual(shape['source']['url'], FILES.SOURCE)

    def test_actual_gbis_record_separators_without_newlines_are_streamed_in_order(self):
        with tempfile.TemporaryDirectory() as folder:
            directory, network = self.fixture(folder, encoding='utf-8', record_separator='^')
            self.assertNotIn(b'\n', gzip.decompress((directory / 'routeline.txt.gz').read_bytes()))
            with redirect_stdout(io.StringIO()):
                audit = FILES.prepare_files(directory, network, Path(folder) / '좌표')
            self.assertEqual(audit['preparedPatterns'], 1)
            self.assertEqual(audit['sourceFiles']['routeline']['rows'], 5)
            self.assertEqual(audit['sourceFiles']['routestation']['rows'], 3)

    def test_roundtrip_terminal_uses_direction_change_not_last_repeated_origin(self):
        line = {**LINE, 'stops': LINE['stops'] + [LINE['stops'][0]]}
        stations = [{**station, 'direction': direction} for station, direction in
                    zip(STATIONS + [STATIONS[0]], ['상행', '상행', '하행', '하행'])]
        self.assertEqual(FILES.terminal_indexes(line, STOPS, stations), [0, 2])
        for altered in ([{**station, 'direction': '상행'} for station in stations],
                        [stations[0], {**stations[1], 'direction': '하행'}, {**stations[2], 'direction': '상행'}, stations[3]],
                        [{**station, 'lat': station['lat'] + .01} for station in stations]):
            self.assertIsNone(FILES.terminal_indexes(line, STOPS, altered))
        for ids in ([line['stops'][0], line['stops'][1], line['stops'][-1]], line['stops'][1:]):
            self.assertIsNone(FILES.terminal_indexes({**line, 'stops': ids}, STOPS, stations))

    def test_terminal_only_update_keeps_shape_files_and_never_calls_api(self):
        with tempfile.TemporaryDirectory() as folder:
            directory, network = self.fixture(folder, directions=['상행', '하행', '하행'])
            output = Path(folder) / '좌표'
            with redirect_stdout(io.StringIO()):
                FILES.prepare_files(directory, network, output)
            before = {path.name: path.read_bytes() for path in output.glob('*.gz')}
            index = json.loads((output / 'index.json').read_text())
            self.assertEqual(index['terminals'][LINE['id']], [0, 1])
            with patch.object(FILES, 'open_resource') as request, redirect_stdout(io.StringIO()):
                FILES.prepare_terminals(directory, network, output)
            request.assert_not_called()
            self.assertEqual(json.loads((output / 'index.json').read_text()), index)
            self.assertEqual({path.name: path.read_bytes() for path in output.glob('*.gz')}, before)

    def test_supported_delimiters_encodings_and_headerless_official_order(self):
        for delimiter, header, encoding in [('|', True, 'utf-8-sig'), ('^', True, 'cp949'),
                                             (',', True, 'utf-8'), ('\t', False, 'cp949')]:
            with self.subTest(delimiter=delimiter, header=header, encoding=encoding), tempfile.TemporaryDirectory() as folder:
                directory, _ = self.fixture(folder, delimiter, header, encoding)
                road, rejected = FILES.read_table(directory / 'routeline.txt.gz', 'routeline', {'206000007'})
                stations, invalid = FILES.read_table(directory / 'routestation.txt.gz', 'routestation', {'206000007'})
                self.assertEqual(len(road['206000007']), 5)
                self.assertEqual([value['id'] for value in stations['206000007']], [value['id'] for value in STATIONS])
                self.assertFalse(rejected or invalid)

    def test_changed_raw_file_or_missing_source_date_is_rejected_before_publication(self):
        with tempfile.TemporaryDirectory() as folder:
            directory, network = self.fixture(folder)
            (directory / 'routeline.txt.gz').write_bytes(gzip.compress(b'changed'))
            with self.assertRaises(FILES.DataError):
                FILES.prepare_files(directory, network, Path(folder) / '좌표')
            self.assertFalse((Path(folder) / '좌표/index.json').exists())
            directory, _ = self.fixture(folder)
            manifest = json.loads((directory / 'files.json').read_text())
            manifest['files']['routeline']['version'] = 'unknown'
            (directory / 'files.json').write_text(json.dumps(manifest))
            with self.assertRaises(FILES.DataError):
                FILES.verify_files(directory)

    def test_duplicate_or_moved_coordinates_cannot_be_published_as_verified_geometry(self):
        for replacement in ('1|0|0|127.1|37.4', '1|0|0|127.1|0'):
            with self.subTest(replacement=replacement), tempfile.TemporaryDirectory() as folder:
                directory, network = self.fixture(folder, header=False, encoding='utf-8')
                path = directory / 'routeline.txt.gz'
                raw = gzip.decompress(path.read_bytes()).decode()
                rows = raw.splitlines()
                rows[1] = '206000007|' + replacement
                payload = ('\n'.join(rows) + '\n').encode()
                path.write_bytes(gzip.compress(payload))
                manifest = json.loads((directory / 'files.json').read_text())
                manifest['files']['routeline'].update(bytes=len(payload), sha256=hashlib.sha256(payload).hexdigest())
                (directory / 'files.json').write_text(json.dumps(manifest))
                with redirect_stdout(io.StringIO()), self.assertRaises(FILES.DataError):
                    FILES.prepare_files(directory, network, Path(folder) / '좌표')
                index = json.loads((Path(folder) / '좌표/index.json').read_text())
                self.assertEqual(index['patterns'], {})

    def test_older_verified_pattern_is_kept_when_not_in_current_bulk_files(self):
        with tempfile.TemporaryDirectory() as folder:
            directory, network = self.fixture(folder)
            other = {**LINE, 'id': 'BR_TAGO_GGB206000008:abcdef123456'}
            (network / 'transit-test.json.gz').write_bytes(gzip.compress(json.dumps({'stops': list(STOPS.values()), 'lines': [LINE, other]}).encode()))
            existing = network / 'bus-shapes'
            existing.mkdir()
            shape = FILES.SHAPES.make_shape(other, STOPS, STATIONS, POINTS, '2026-11-01')
            payload = json.dumps(shape).encode()
            asset = 'shape-' + hashlib.sha256(payload).hexdigest()[:12] + '.json.gz'
            (existing / asset).write_bytes(gzip.compress(payload))
            (existing / 'index.json').write_text(json.dumps({'version': 1, 'patterns': {other['id']: asset}}))
            output = Path(folder) / '좌표'
            with redirect_stdout(io.StringIO()):
                audit = FILES.prepare_files(directory, network, output)
            self.assertEqual(audit['publishedPatterns'], 2)
            self.assertEqual(audit['preservedPatterns'], 1)
            self.assertEqual((output / asset).read_bytes(), (existing / asset).read_bytes())


if __name__ == '__main__':
    unittest.main()
