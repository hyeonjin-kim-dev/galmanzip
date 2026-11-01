"""로컬 검증: 검증용 지도 키로 개발 서버를 실행한 뒤 python tests/browser_search.py 실행."""
import json
import os
from pathlib import Path
from playwright.sync_api import expect

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get('GALMANZIP_TEST_URL', 'http://127.0.0.1:5173/galmanzip/')
STOPS = [
    dict(id='A', name='검증 출발역', lat=37.4, lng=127.1),
    dict(id='B', name='검증 환승역', lat=37.4, lng=127.13),
    dict(id='C', name='검증 목적지역', lat=37.4, lng=127.16),
    dict(id='X', name='검증 출발 정류장', lat=37.42, lng=127.1),
    dict(id='Y', name='검증 먼 역', lat=37.43, lng=127.11),
    dict(id='Z', name='검증 시간초과 역', lat=37.5, lng=127.1),
]


def line(name, stops, seconds):
    return dict(id=name, name=name, mode='rail', stops=stops, seconds=seconds, waitSeconds=120)


NETWORK = dict(version=1, status='ready', stops=STOPS, transfers=[],
               lines=[line('검증 직행', ['A', 'C'], [600]), line('검증 첫차', ['X', 'B'], [240]),
                      line('검증 둘째차', ['B', 'C'], [240]), line('검증 완행', ['Y', 'C'], [601]),
                      line('검증 먼 노선', ['Z', 'C'], [2000]), line('검증 빠른 환승', ['A', 'B'], [50])],
               source=dict(name='브라우저 검증용 자료', url='https://example.org', date='2025-03-04', license='검증 전용'),
               coverage='실제 서비스 자료가 아닌 검증용 교통망')


def prepare(browser, mobile=False, network=NETWORK):
    context = browser.new_context(viewport=dict(width=390 if mobile else 1280, height=844 if mobile else 900),
                                  is_mobile=mobile, has_touch=mobile)
    context.route('https://dapi.kakao.com/**', lambda route: route.fulfill(
        content_type='application/javascript', body=(ROOT / 'fixtures/kakao.js').read_text()))
    if network is not None:
        context.route('**/data/transit.json', lambda route: route.fulfill(content_type='application/json', body=json.dumps(network)))
    page = context.new_page()
    errors = []
    requests = []
    workers = []
    closed_workers = []
    page.on('request', lambda request: requests.append(request.url))
    page.__dict__['routing_requests'] = requests
    page.__dict__['routing_workers'] = workers
    page.__dict__['closed_workers'] = closed_workers
    def record_worker(worker):
        workers.append(worker.url)
        worker.on('close', lambda: closed_workers.append(worker.url))
    page.on('worker', record_worker)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE)
    page.wait_for_function('window.__searchTest && window.__searchTest.clusterer')
    return context, page, errors


def choose(page, touch=False):
    expect(page.get_by_role('button', name='검색', exact=True)).to_be_disabled()
    field = page.get_by_role('combobox', name='목적지 검색')
    field.fill('검증 목적지')
    expect(page.get_by_role('option', name='검증 목적지 경기 성남시 검증로 1')).to_be_visible()
    if touch:
        page.get_by_role('option', name='검증 목적지 경기 성남시 검증로 1').tap()
    else:
        field.press('ArrowDown')
        field.press('Enter')
    expect(page.locator('.travel-time-field')).to_have_count(1)
    page.get_by_role('combobox', name='소요 시간').click()
    options = page.get_by_role('listbox', name='소요 시간').get_by_role('option')
    expect(options).to_have_count(18)
    expect(options.first).to_have_text('0~10분')
    expect(options.nth(5)).to_have_text('50분 ~ 1시간')
    expect(options.last).to_have_text('2시간 50분 ~ 3시간')
    page.get_by_role('option', name='10분 ~ 20분', exact=True).click()
    expect(page.get_by_role('button', name='검색', exact=True)).to_be_enabled()
