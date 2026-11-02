"""전체 파일의 인증·공식 출처·공개 결과물에서 비밀 값이 섞이지 않는지 검사한다."""
import gzip
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('bus_files', Path(__file__).resolve().parents[1] / 'scripts/bus_files.py')
FILES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FILES)
CATALOG = b'''<response><msgHeader><resultCode>0</resultCode></msgHeader><msgBody><baseInfoItem>
<routeLineDownloadUrl>https://openapi.gbis.go.kr/ws/download/routeline20261102V2.txt</routeLineDownloadUrl><routeLineVersion>20261102</routeLineVersion>
<routeStationDownloadUrl>https://openapi.gbis.go.kr/ws/download/routestation20261102V2.txt</routeStationDownloadUrl><routeStationVersion>20261102</routeStationVersion>
</baseInfoItem></msgBody></response>'''


class FileTest(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
