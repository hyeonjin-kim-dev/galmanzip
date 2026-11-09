"""국토교통부 공개 매매 자료를 인증키 노출 없이 준비한다."""
import argparse
import csv
import hashlib
import io
import gzip
import json
import os
import re
import zipfile
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

SOURCE = 'https://www.data.go.kr/data/15126468/openapi.do'
ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'
CODE_SOURCE = 'https://www.code.go.kr/stdcode/regCodeL.do?menuNo=101010100010'
CODE_DOWNLOAD = 'https://www.code.go.kr/etc/codeFullDown.do'


class DataError(Exception):
    pass


class ApiError(DataError):
    def __init__(self, code, status=None):
        self.code, self.status = code, status
        super().__init__(f'실거래가 API 응답 오류: 제공기관 코드 {code}, HTTP {status or "200"}.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise DataError('인증키 보호를 위해 API 주소 변경을 따르지 않습니다.')


def parse_page(payload):
    try:
        root = ET.fromstring(payload)
        for node in root.iter():
            node.tag = node.tag.rsplit('}', 1)[-1]
        code = (root.findtext('.//resultCode') or root.findtext('.//returnReasonCode') or '').strip()
        if code not in ('0', '00', '000'):
            raise ApiError(code if re.fullmatch(r'\d{1,3}', code) else '미확인')
        total = int(root.findtext('.//totalCount', '-1'))
        if total < 0:
            raise ValueError()
        rows = [{child.tag: (child.text or '').strip() for child in item} for item in root.findall('.//items/item')]
        return rows, total
    except (ET.ParseError, ValueError):
        raise DataError('실거래가 응답 형식을 확인하지 못했습니다.') from None


def fetch_page(key, district, month, page=1, size=1000):
    if not key.strip():
        raise DataError('기존 Actions DATA_GO_KR_SERVICE_KEY 비밀 값이 필요합니다.')
    query = urlencode({'serviceKey': unquote(key.strip()), 'LAWD_CD': district, 'DEAL_YMD': month,
                       'pageNo': page, 'numOfRows': size})
    request = Request(ENDPOINT + '?' + query, headers={'User-Agent': 'Galmanzip-sales/1.0'})
    try:
        with build_opener(NoRedirect()).open(request, timeout=30) as response:
            payload = response.read(16 * 1024 * 1024 + 1)
    except HTTPError as error:
        try:
            parse_page(error.read(65536))
        except ApiError as parsed:
            raise ApiError(parsed.code, error.code) from None
        except DataError:
            pass
        finally:
            error.close()
        raise ApiError('미확인', error.code) from None
    except (URLError, TimeoutError, OSError):
        raise DataError('실거래가 API에 연결하지 못했습니다. 인증키와 요청 주소는 출력하지 않습니다.') from None
    if len(payload) > 16 * 1024 * 1024:
        raise DataError('실거래가 응답 크기가 예상 범위를 넘었습니다.')
    return parse_page(payload)


def download_codes(output):
    request = Request(CODE_DOWNLOAD, data=urlencode({'codeseId': '법정동코드'}).encode(),
                      headers={'User-Agent': 'Mozilla/5.0', 'Referer': CODE_SOURCE})
    try:
        with build_opener().open(request, timeout=60) as response:
            payload = response.read(16 * 1024 * 1024)
        if payload.startswith(b'PK'):
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                files = [info for info in archive.infolist() if info.filename.lower().endswith('.txt')]
                if len(files) != 1 or files[0].file_size > 16 * 1024 * 1024:
                    raise DataError('법정동 전체 파일 구성을 확인하지 못했습니다.')
                source = archive.read(files[0])
        else:
            source = payload
        try:
            text = source.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = source.decode('cp949')
        rows = list(csv.DictReader(io.StringIO(text), delimiter='\t'))
        if not rows or not {'법정동코드', '법정동명', '폐지여부'} <= rows[0].keys():
            raise DataError('법정동 코드 파일 형식이 올바르지 않습니다.')
        selected = [row for row in rows if row['법정동코드'][:2] in ('11', '41')]
        (output / 'legal-codes.json').write_text(json.dumps({'source': CODE_SOURCE,
            'sha256': hashlib.sha256(payload).hexdigest(), 'rows': selected}, ensure_ascii=False, indent=2) + '\n')
        return len(selected)
    except (HTTPError, URLError, TimeoutError, OSError, zipfile.BadZipFile, UnicodeDecodeError):
        raise DataError('공식 법정동 코드 파일을 내려받지 못했습니다.') from None


def probe(output, key):
    output.mkdir(parents=True, exist_ok=True)
    report = {'checkedAt': datetime.now(ZoneInfo('Asia/Seoul')).isoformat(), 'source': SOURCE}
    try:
        rows, total = fetch_page(key, '11110', '202610', size=10)
        report.update(status='ready', total=total, fields=sorted(rows[0]) if rows else [])
        (output / 'sample.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    except DataError as error:
        report.update(status='unavailable', message=str(error))
    try:
        report['legalCodeRows'] = download_codes(output)
    except DataError as error:
        report['legalCodeError'] = str(error)
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False), flush=True)


def month_range(today, count=12):
    index = today.year * 12 + today.month - 1
    return [f'{i // 12:04d}{i % 12 + 1:02d}' for i in range(index - count + 1, index + 1)]


def building_number(main, sub):
    if not main or not main.isdigit() or int(main) == 0:
        return ''
    if sub and not sub.isdigit():
        raise DataError('주소의 건물 번호가 올바르지 않습니다.')
    return str(int(main)) + (f'-{int(sub)}' if sub and int(sub) else '')


def normalize_trade(row, names, month):
    # 해제 여부와 사유 발생일 중 어느 쪽에서든 취소를 확인하면 제외한다.
    if row.get('cdealType', '').upper() not in ('', '-', 'N') or row.get('cdealDay', '') not in ('', '-'):
        return None
    try:
        contract = date(int(row['dealYear']), int(row['dealMonth']), int(row['dealDay']))
        amount = int(row['dealAmount'].replace(',', '').strip())
        area = Decimal(row['excluUseAr'])
        floor = int(row['floor'])
        if contract.strftime('%Y%m') != month or amount <= 0 or amount > 1_000_000_000 or not area.is_finite() or not 0 < area < 5000:
            raise ValueError()
        if not -20 <= floor <= 200 or not row.get('aptNm') or not row.get('aptSeq') or row.get('sggCd') not in names:
            raise ValueError()
        district = names[row['sggCd']]
        road_district = names.get(row.get('roadNmSggCd'), district)
        number = building_number(row.get('roadNmBonbun', ''), row.get('roadNmBubun', ''))
        road = f"{road_district} {row['roadNm']} {number}" if row.get('roadNm') and number and row.get('roadNmbCd') != '1' else ''
        lot = f"{district} {row['umdNm']} {row['jibun']}" if row.get('umdNm') and row.get('jibun') else ''
        if not road and not lot:
            raise ValueError()
        return {'id': row['aptSeq'], 'name': row['aptNm'], 'roadAddress': road, 'lotAddress': lot,
                'date': contract.isoformat(), 'amount': amount, 'area': float(area), 'floor': floor}
    except (KeyError, ValueError, InvalidOperation):
        raise DataError('유효한 거래의 날짜·금액·면적·단지 주소를 확인하지 못했습니다.') from None


def summarize(rows, names):
    apartments = {}
    cancelled = 0
    for month, records in rows:
        for record in records:
            row = normalize_trade(record, names, month)
            if row is None:
                cancelled += 1
                continue
            item = apartments.setdefault(row['id'], {'id': row['id'], 'names': set(), 'roadAddresses': set(),
                'lotAddresses': set(), 'date': row['date'], 'transactions': set()})
            item['names'].add(row['name'])
            if row['roadAddress']:
                item['roadAddresses'].add(row['roadAddress'])
            if row['lotAddress']:
                item['lotAddresses'].add(row['lotAddress'])
            if row['date'] > item['date']:
                item['date'], item['transactions'] = row['date'], set()
            if row['date'] == item['date']:
                item['transactions'].add((row['amount'], row['area'], row['floor']))
    result = []
    for item in sorted(apartments.values(), key=lambda item: item['id']):
        result.append({key: sorted(value) if isinstance(value, set) else value for key, value in item.items()})
    return result, cancelled


def collect(output, key, config, today=None):
    today = today or datetime.now(ZoneInfo('Asia/Seoul')).date()
    months = month_range(today)
    districts = config['districts']
    names = {item['code']: item['name'] for item in districts}
    if len(names) != len(districts) or not 50 <= len(names) <= 100:
        raise DataError('서울·경기 시군구 목록을 확인하지 못했습니다.')
    if any(not re.fullmatch(r'(11|41)\d{3}', code) for code in names):
        raise DataError('지원 지역 밖의 시군구 코드입니다.')
    staging = output.with_name(output.name + '-staging')
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    lock, stop = threading.Lock(), threading.Event()
    request_count, next_request = 0, 0.0
    def request(district, month, page):
        nonlocal request_count, next_request
        for attempt in range(3):
            with lock:
                if stop.is_set():
                    raise DataError('앞선 수집 오류로 추가 호출을 중단했습니다.')
                if request_count >= 2000:
                    stop.set()
                    raise DataError('무료 이용을 위한 이번 수집의 호출 상한에 도달했습니다.')
                request_count += 1
                wait = max(0, next_request - time.monotonic())
                next_request = max(next_request, time.monotonic()) + .4
            if stop.wait(wait):
                raise DataError('자료 수집이 중단됐습니다.')
            try:
                return fetch_page(key, district, month, page)
            except ApiError as error:
                if (error.code in ('01', '04', '05', '23') or error.status in (500, 502, 503, 504)) and attempt < 2:
                    stop.wait(5 * (attempt + 1))
                    continue
                raise
        raise DataError('실거래가 응답을 확인하지 못했습니다.')

    def district_data(district):
        try:
            collected = []
            raw_count = 0
            for month in reversed(months):
                rows, total = request(district['code'], month, 1)
                if total > 100000 or (total and not rows) or len(rows) > total:
                    raise DataError('실거래가 페이지 건수가 올바르지 않습니다.')
                page = 1
                while len(rows) < total:
                    page += 1
                    more, reported = request(district['code'], month, page)
                    if reported != total or not more or len(rows) + len(more) > total:
                        raise DataError('수집 중 자료 건수가 변경됐습니다. 기존 배포 자료를 유지합니다.')
                    rows.extend(more)
                raw_count += len(rows)
                collected.append((month, rows))
            apartments, cancelled = summarize(collected, names)
            payload = json.dumps({'version': 1, 'district': district['code'], 'apartments': apartments}, ensure_ascii=False, separators=(',', ':')).encode()
            asset = f"sales-{district['code']}-{hashlib.sha256(payload).hexdigest()[:12]}.json.gz"
            (staging / asset).write_bytes(gzip.compress(payload, mtime=0))
            print(f"{district['name']}: 원본 {raw_count}건 · 해제 제외 {cancelled}건 · 단지 {len(apartments)}곳", flush=True)
            return {**district, 'asset': asset, 'apartments': len(apartments), 'records': raw_count, 'cancelled': cancelled}
        except Exception:
            stop.set()
            raise

    try:
        # 인증 오류는 광역 수집 전에 한 번만 확인한다.
        request(districts[0]['code'], months[-1], 1)
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(district_data, districts))
        manifest = {'version': 1, 'status': 'ready', 'collectedOn': today.isoformat(), 'months': months,
                    'source': {'name': '국토교통부 아파트 매매 실거래가 상세 자료', 'url': SOURCE, 'license': '이용허락범위 제한 없음'},
                    'districts': [{key: item[key] for key in ('code', 'name', 'asset')} for item in results]}
        (staging / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        (staging / 'audit.json').write_text(json.dumps({'apiRequests': request_count, 'collectedOn': today.isoformat(),
            'months': months, 'codeSource': config['source'], 'codeSourceSha256': config['sourceSha256'], 'districts': results}, ensure_ascii=False, indent=2) + '\n')
        if output.exists():
            shutil.rmtree(output)
        staging.rename(output)
        print(f'전체 자료 수집 완료: {len(results)}개 지역, API {request_count}회', flush=True)
    except Exception:
        stop.set()
        shutil.rmtree(staging, ignore_errors=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--probe', action='store_true')
    parser.add_argument('--districts', type=Path, default=Path('config/sales-districts.json'))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.probe:
            probe(args.output, os.environ.get('DATA_GO_KR_SERVICE_KEY', ''))
        else:
            collect(args.output, os.environ.get('DATA_GO_KR_SERVICE_KEY', ''), json.loads(args.districts.read_text()))
    except DataError as error:
        print(str(error), flush=True)
        raise SystemExit(1) from None
