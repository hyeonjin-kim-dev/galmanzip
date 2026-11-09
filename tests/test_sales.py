"""실거래가 자료의 오류·해제·단지 식별 처리를 검증한다."""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location('sales', Path(__file__).resolve().parents[1] / 'scripts/prepare_sales.py')
SALES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SALES)


class SalesTest(unittest.TestCase):
    def test_page_and_permission_error(self):
        rows, count = SALES.parse_page(b'<response><header><resultCode>000</resultCode></header><body><items><item><aptNm>A</aptNm></item></items><totalCount>1</totalCount></body></response>')
        self.assertEqual((rows, count), ([{'aptNm': 'A'}], 1))
        with self.assertRaises(SALES.ApiError) as error:
            SALES.parse_page(b'<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>')
        self.assertEqual(error.exception.code, '30')
        with self.assertRaises(SALES.DataError):
            SALES.parse_page(b'<html>error</html>')
