"""주변 결과 우선 표시, 지도 영역의 마커와 누적 목록의 안정성을 검증한다."""
import json
import time
from playwright.sync_api import sync_playwright, expect
from browser_support import NETWORK, choose, includes_selection, line, prepare

VIEW_NETWORK = dict(NETWORK,
    stops=[dict(id='C', name='목적지역', lat=37.4, lng=127.16),
           dict(id='N', name='주변역', lat=37.4, lng=127.155),
           dict(id='A', name='먼역', lat=37.4, lng=127.1),
           dict(id='Y', name='새로 본 역', lat=37.46, lng=127.2)],
    lines=[line('주변 직통', ['N', 'C'], [720]), line('먼 직통', ['A', 'C'], [660]),
           line('새 지역 직통', ['Y', 'C'], [660])])


def homes(page, include_new=False):
    page.evaluate('''includeNew => {
      const state = window.__searchTest, sample = state.homes[2];
      state.homes = [{ ...sample, id: 'near', place_name: '주변 아파트', y: '37.4', x: '127.155' },
                     { ...sample, id: 'far', place_name: '먼 아파트', y: '37.4', x: '127.1' }];
      if (includeNew) state.homes.push({ ...sample, id: 'new-area', place_name: '새 지역 아파트', y: '37.46', x: '127.2' });
    }''', include_new)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mobile in (False, True):
        context, page, errors = prepare(browser, mobile=mobile, network=VIEW_NETWORK)
        def delayed_network(route):
            time.sleep(0.8)
            route.fulfill(content_type='application/json', body=json.dumps(VIEW_NETWORK))
        context.route('**/data/transit.json', delayed_network)
        homes(page)
        choose(page, touch=mobile)
        page.evaluate('''() => {
          window.__started = performance.now();
          window.__searchTest.delayFor = (query, options) => query !== '아파트' ? 10
            : Number(options.rect.split(',')[2]) < 127.14 ? 1600 : 350;
        }''')
        page.get_by_role('button', name='검색', exact=True).click()
        expect(page.locator('[data-place-id="near"]')).to_be_visible(timeout=10000)
        first = page.evaluate('performance.now() - window.__started')
        assert page.evaluate('window.__searchTest.calls.find(call => call.query === "아파트").started - window.__started') < 300
        assert page.evaluate('window.__searchTest.map.getCenter().getLng()') == 127.16
        assert page.evaluate('window.__searchTest.level') == 6
        assert page.locator('progress').count() == 0
        expect(page.get_by_role('button', name='중단', exact=True)).to_be_visible()
        expect(page.locator('.test-cluster')).to_have_text('1')
        page.locator('[data-place-id="near"] .apartment-heading').click()
        page.wait_for_function('window.__searchTest.fitCount === 1')
        assert includes_selection(page, 'near')
        selected_center = page.evaluate('window.__searchTest.map.getCenter().getLng()')
        page.locator('[data-place-id="near"] summary').click()
        expect(page.locator('[data-place-id="near"] .route-details')).to_have_attribute('open', '')
        expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
        total = page.evaluate('performance.now() - window.__started')
        assert first < total - 500
        expect(page.locator('.apartment-card')).to_have_count(1)
        assert page.evaluate('window.__searchTest.fitCount') == 1
        assert page.evaluate('window.__searchTest.map.getCenter().getLng()') == selected_center
        assert includes_selection(page, 'near')
        page.get_by_role('button', name='목적지로', exact=True).click()
        before = page.evaluate('window.__searchTest.calls.length')
        for _ in range(4):
            page.get_by_role('button', name='지도 축소', exact=True).click()
        expect(page.locator('[data-place-id="far"]')).to_be_visible()
        assert page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)') == ['near', 'far']
        expect(page.locator('[data-place-id="near"] .route-details')).to_have_attribute('open', '')
        expect(page.locator('.test-cluster')).to_have_text('2')
        assert page.evaluate('window.__searchTest.calls.length') == before
        page.get_by_role('button', name='수단·시간순 정렬', exact=True).click()
        assert page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)') == ['far', 'near']
        for _ in range(4):
            page.get_by_role('button', name='지도 확대', exact=True).click()
        expect(page.locator('[data-place-id="far"]')).to_have_count(1)
        expect(page.locator('.results-summary h2')).to_have_text('찾은 아파트 2곳')
        expect(page.locator('.results-map-count')).to_have_text('현재 지도 안 1곳')
        assert page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)') == ['far', 'near']
        expect(page.locator('[data-place-id="near"] .route-details')).to_have_attribute('open', '')
        expect(page.locator('.test-cluster')).to_have_text('1')
        page.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
        expect(page.locator('.apartment-card')).to_have_count(2)
        assert not errors, errors
        assert page.evaluate('localStorage.length + sessionStorage.length') == 0
        page.screenshot(path=f'/tmp/galmanzip-viewport-{"mobile" if mobile else "desktop"}.png')
        context.close()
        print(f'{"모바일" if mobile else "PC"}: 첫 주변 결과 {first / 1000:.1f}초, 전체 {total / 1000:.1f}초 · 확대/축소 시 목록 유지·지도 마커 필터·선택 유지 검증 통과', flush=True)

    context, page, errors = prepare(browser)
    choose(page)
    page.evaluate('''() => {
      const state = window.__searchTest, slow = state.homes[0], fast = state.homes[2];
      state.pageSize = 4;
      state.homes = [...Array.from({length: 4}, (_, i) => ({ ...slow, id: `slow-${i}`, place_name: `먼저 찾은 집 ${i}` })), fast];
      state.delayFor = (query, options) => query === '아파트' && options.page === 2 ? 1600 : 20;
    }''')
    page.get_by_role('button', name='검색', exact=True).click()
    page.locator('.map-canvas').evaluate('''() => {
      const maps = window.kakao.maps;
      window.__searchTest.map.setBounds(new maps.LatLngBounds(new maps.LatLng(37.38, 127.08), new maps.LatLng(37.45, 127.18)));
    }''')
    expect(page.locator('.apartment-card')).to_have_count(4, timeout=10000)
    page.locator('.apartment-card').first.locator('summary').click()
    page.locator('.apartment-card').first.get_by_role('link', name='네이버 부동산').focus()
    reading = page.evaluate('''() => {
      const panel = document.querySelector('.panel-content'); panel.scrollTop = 100;
      window.__readingCard = document.querySelector('.apartment-card'); window.__readingFocus = document.activeElement;
      return { ids: [...document.querySelectorAll('.apartment-card')].map(card => card.dataset.placeId),
        top: window.__readingCard.getBoundingClientRect().top, scroll: panel.scrollTop };
    }''')
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    expect(page.locator('.apartment-card')).to_have_count(5)
    after = page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)')
    assert after[:4] == reading['ids'] and after[-1] == 'fast'
    assert page.evaluate('document.querySelector(".apartment-card") === window.__readingCard')
    assert page.evaluate('document.activeElement === window.__readingFocus')
    assert abs(page.evaluate('window.__readingCard.getBoundingClientRect().top') - reading['top']) <= 1
    assert abs(page.locator('.panel-content').evaluate('(panel) => panel.scrollTop') - reading['scroll']) <= 1
    expect(page.locator('.apartment-card').first.locator('details')).to_have_attribute('open', '')
    assert not errors, errors
    page.screenshot(path='/tmp/galmanzip-stable-reading.png')
    context.close()
    print('늦게 도착한 빠른 집을 뒤에 추가 · 읽던 DOM·순서·상세 펼침·스크롤·포커스 유지 검증 통과', flush=True)

    context, page, errors = prepare(browser, network=VIEW_NETWORK)
    homes(page, include_new=True)
    choose(page)
    page.evaluate('window.__searchTest.delay = 400')
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.locator('[data-place-id="near"]')).to_be_visible(timeout=10000)
    previous = page.evaluate('window.__searchTest.calls.filter(call => call.query === "아파트").length')
    page.locator('.map-canvas').evaluate('''() => window.__searchTest.map.setCenter(new window.kakao.maps.LatLng(37.46, 127.2))''')
    expect(page.locator('[data-place-id="new-area"]')).to_be_visible(timeout=10000)
    calls = page.evaluate('window.__searchTest.calls.filter(call => call.query === "아파트")')
    def includes_new(call):
        west, south, east, north = map(float, call['rect'].split(','))
        return west <= 127.2 <= east and south <= 37.46 <= north
    # 병렬 조회가 이미 새 영역을 확인 중이면 그 응답도 바로 재사용할 수 있다.
    if not any(includes_new(call) for call in calls[:previous]):
        next_new = next(i for i in range(previous, len(calls)) if includes_new(calls[i]))
        assert next_new - previous <= 1, (previous, next_new, calls)
    expect(page.locator('[data-place-id="near"]')).to_have_count(1)
    assert not errors, errors
    context.close()
    print('검색 중 지도 이동 시 새 화면의 요청 우선 처리와 기존 목록 유지 검증 통과', flush=True)
    browser.close()
