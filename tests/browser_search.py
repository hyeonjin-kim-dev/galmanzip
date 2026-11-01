"""로컬 검증: 검증용 지도 키로 개발 서버를 실행한 뒤 python tests/browser_search.py 실행."""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

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
                      line('검증 먼 노선', ['Z', 'C'], [2000])],
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
    page.get_by_role('combobox', name='최소 소요 시간').click()
    expect(page.get_by_role('listbox', name='최소 소요 시간').get_by_role('option')).to_have_count(18)
    page.get_by_role('option', name='약 10분', exact=True).click()
    page.get_by_role('combobox', name='최대 소요 시간').click()
    expect(page.get_by_role('listbox', name='최대 소요 시간').get_by_role('option')).to_have_count(18)
    page.get_by_role('option', name='약 30분', exact=True).click()
    expect(page.get_by_role('button', name='검색', exact=True)).to_be_enabled()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mobile in (False, True):
        context, page, errors = prepare(browser, mobile)
        choose(page, touch=mobile)
        page.get_by_role('button', name='검색', exact=True).click()
        expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
        expect(page.locator('.apartment-card')).to_have_count(4)
        assert page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)') == ['walk', 'fast', 'transfer', 'slow']
        expect(page.locator('.test-cluster')).to_have_text('4')
        assert page.evaluate('window.__searchTest.clusterOptions.minClusterSize') == 1
        assert page.locator('.test-cluster').evaluate('(e) => getComputedStyle(e).backgroundColor') == 'rgb(0, 0, 0)'
        assert page.locator('.test-cluster').evaluate('(e) => getComputedStyle(e).color') == 'rgb(255, 255, 255)'
        assert page.evaluate('window.__searchTest.calls.some(call => call.page > 1)')
        assert page.evaluate('window.__searchTest.fitCount') >= 2
        page.locator('[data-place-id="fast"] .apartment-heading').click()
        assert page.evaluate('window.__searchTest.map.getCenter().getLng()') == 127.1
        page.locator('[data-place-id="fast"] summary').click()
        expect(page.locator('[data-place-id="fast"] .route-details')).to_contain_text('검증 출발역 → 검증 목적지역')
        assert page.locator('[data-place-id="fast"] a').first.get_attribute('href').startswith('https://map.kakao.com/link/by/traffic/')
        assert page.locator('[data-place-id="fast"] a').nth(1).get_attribute('href') == 'https://land.naver.com/'
        assert page.evaluate('localStorage.length') == 0
        assert page.evaluate('sessionStorage.length') == 0
        assert not context.cookies()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        if mobile:
            handle = page.locator('.sheet-handle')
            handle.focus()
            handle.press('End')
            page.wait_for_timeout(250)
            assert page.locator('.map-panel').bounding_box()['y'] > page.locator('.search-options').bounding_box()['y'] + 32
            page.screenshot(path='/tmp/galmanzip-search-mobile.png')
            handle.press('Home')
            expect(page.locator('.panel-content')).to_be_hidden()
            page.set_viewport_size(dict(width=1280, height=900))
            expect(page.locator('.panel-content')).to_be_visible()
        else:
            page.screenshot(path='/tmp/galmanzip-search-desktop.png')
        assert not errors, errors
        context.close()
        print('모바일' if mobile else '데스크톱', '검색·정렬·페이지 조회·클러스터·경로·화면 크기 검증 통과')

    context, page, errors = prepare(browser, mobile=True)
    page.set_viewport_size(dict(width=320, height=700))
    choose(page, touch=True)
    minimum = page.get_by_role('combobox', name='최소 소요 시간')
    minimum.press('End')
    minimum.press('Enter')
    expect(minimum).to_contain_text('약 3시간')
    expect(page.get_by_role('alert')).to_contain_text('최대 소요 시간은 최소 소요 시간 이상')
    expect(page.get_by_role('button', name='검색', exact=True)).to_be_disabled()
    minimum.click()
    page.get_by_role('option', name='약 20분', exact=True).click()
    expect(page.get_by_role('alert')).to_have_count(0)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.locator('.sheet-handle').press('End')
    page.wait_for_timeout(250)
    assert page.locator('.map-panel').bounding_box()['y'] >= page.locator('.destination-search').bounding_box()['y'] + page.locator('.destination-search').bounding_box()['height']
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    expect(page.locator('.apartment-card')).to_have_count(0)
    assert not errors, errors
    context.close()
    print('시간 범위 오류·키보드 끝 항목·최소 시간 필터·작은 모바일 화면 검증 통과')

    context, page, errors = prepare(browser, network=dict(version=1, status='pending'))
    choose(page)
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('교통 자료가 아직 준비되지 않아')
    expect(page.locator('.apartment-card')).to_have_count(0)
    assert not page.evaluate('window.__searchTest.calls.some(call => call.query === "아파트")')
    assert not errors, errors
    context.close()
    print('미확보 자료를 정상적인 검색 결과 없음으로 표시하지 않는지 검증 통과')

    context, page, errors = prepare(browser)
    choose(page)
    page.evaluate('window.__searchTest.delay = 400')
    page.get_by_role('button', name='검색', exact=True).click()
    page.wait_for_function('window.__searchTest.calls.some(call => call.query === "아파트")')
    page.get_by_role('button', name='중단', exact=True).click()
    expect(page.get_by_text('검색을 중단했습니다.', exact=True)).to_be_visible()
    page.get_by_role('combobox', name='목적지 검색').fill('새 목적지')
    page.wait_for_timeout(1000)
    expect(page.locator('.apartment-card')).to_have_count(0)
    assert page.evaluate('window.__searchTest.markers.length') == 0
    assert not errors, errors
    context.close()
    print('취소 후 늦은 응답과 조건 변경 시 이전 결과 제거 검증 통과')

    context, page, errors = prepare(browser)
    choose(page)
    page.evaluate('window.__searchTest.failAfter = 1')
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('장소 검색을 완료하지 못했습니다.', timeout=10000)
    expect(page.get_by_text('중단 전까지 확인한 일부 결과입니다.', exact=True)).to_be_visible()
    expect(page.locator('.apartment-card')).to_have_count(1)
    assert not errors, errors
    context.close()
    print('API 오류 시 일부 결과 표시 검증 통과')

    context, page, errors = prepare(browser)
    page.set_content(f'<iframe title="갈만집 검증" src="{BASE}" style="width:390px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
    app = page.frame_locator('iframe')
    choose(app)
    app.get_by_role('button', name='검색', exact=True).click()
    expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    expect(app.locator('.apartment-card')).to_have_count(4)
    assert app.locator('.map-page').evaluate('(element) => element.scrollWidth <= innerWidth')
    assert not errors, errors
    context.close()
    print('iframe 내부 검색과 작업 스레드 실행 검증 통과')

    for mobile in (False, True):
        context, page, errors = prepare(browser, mobile=mobile, network=None)
        if mobile:
            context.new_cdp_session(page).send('Emulation.setCPUThrottlingRate', {'rate': 4})
        compressed = []
        page.on('response', lambda response: compressed.append(response.url) if response.url.endswith('.json.gz') else None)
        page.evaluate('''() => {
          const state = window.__searchTest;
          Object.assign(state.destination, { y: '37.384988', x: '127.123390' });
          state.homes = [
            { ...state.homes[3], y: '37.385488', x: '127.123390' },
            { ...state.homes[2], y: '37.366143', x: '127.108097' },
          ];
        }''')
        choose(page, touch=mobile)
        started = time.monotonic()
        page.get_by_role('button', name='검색', exact=True).click()
        expect(page.locator('.results-basis')).to_contain_text('2025년 3월 평일 하루', timeout=30000)
        calculated = time.monotonic() - started
        expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=90000)
        expect(page.locator('.apartment-card')).to_have_count(1)
        expect(page.locator('.test-cluster')).to_have_text('1')
        page.locator('[data-place-id="fast"] summary').click()
        expect(page.locator('[data-place-id="fast"] .route-details')).to_contain_text('정자역 → 서현역.AK플라자')
        assert len(compressed) == 1, compressed
        assert not errors, errors
        assert page.evaluate('localStorage.length + sessionStorage.length') == 0
        page.screenshot(path=f'/tmp/galmanzip-real-transit-{"mobile" if mobile else "desktop"}.png')
        print(f'실제 교통 자료·모의 장소 {"모바일(처리 속도 4배 제한)" if mobile else "데스크톱"}: 계산 {calculated:.1f}초, 전체 {time.monotonic() - started:.1f}초 검증 통과', flush=True)
        context.close()
    browser.close()
