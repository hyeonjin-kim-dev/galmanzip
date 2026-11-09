"""실거래가 자료의 오류·해제·단지 식별 처리를 검증한다."""
import importlib.util
import unittest
from datetime import date
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

    def record(self, **changes):
        return dict(aptSeq='11110-1', aptNm='검증아파트', sggCd='11110', roadNmSggCd='11110',
                    roadNm='검증로', roadNmBonbun='00007', roadNmBubun='00002', roadNmbCd='0',
                    umdNm='검증동', jibun='10-2', dealYear='2026', dealMonth='10', dealDay='20',
                    dealAmount='123,456', excluUseAr='84.99', floor='7', cdealType='', cdealDay='', **changes)

    def test_cancelled_newest_is_excluded_and_same_day_transactions_are_kept(self):
        original = self.record()
        newer_cancelled = {**original, 'dealDay': '22', 'cdealType': 'Y'}
        cancelled_date_only = {**original, 'dealDay': '21', 'cdealDay': '26.10.23'}
        same_day = {**original, 'dealAmount': '120,000', 'floor': '3'}
        older = {**original, 'dealDay': '19', 'dealAmount': '999,999'}
        rows, cancelled = SALES.summarize([('202610', [older, original, same_day, newer_cancelled, cancelled_date_only])], {'11110': '서울특별시 종로구'})
        self.assertEqual(cancelled, 2)
        self.assertEqual(rows[0]['date'], '2026-10-20')
        self.assertEqual(rows[0]['transactions'], [(120000, 84.99, 3), (123456, 84.99, 7)])
        self.assertEqual(rows[0]['roadAddresses'], ['서울특별시 종로구 검증로 7-2'])
        self.assertEqual(rows[0]['lotAddresses'], ['서울특별시 종로구 검증동 10-2'])

    def test_invalid_active_transaction_fails_instead_of_publishing_partial_prices(self):
        for changes in ({'dealAmount': '-1'}, {'excluUseAr': 'NaN'}, {'aptSeq': ''}, {'dealDay': '32'}, {'dealMonth': '9'}):
            with self.assertRaises(SALES.DataError):
                SALES.normalize_trade({**self.record(), **changes}, {'11110': '서울특별시 종로구'}, '202610')

    def test_month_window_across_years(self):
        self.assertEqual(SALES.month_range(date(2026, 11, 9)), ['202512'] + [f'2026{i:02d}' for i in range(1, 12)])
