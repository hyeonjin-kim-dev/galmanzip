"""늦게 추가되는 무환승 결과의 우선 표시와 읽던 항목·분류별 페이지 유지를 검사한다."""
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, choose, prepare


def evaluate(app, script):
    return app.locator('.map-canvas').evaluate(script)


def focus_both(app):
    evaluate(app, '''() => window.__searchTest.map.setBounds(new window.kakao.maps.LatLngBounds(
      new window.kakao.maps.LatLng(37.395, 127.095), new window.kakao.maps.LatLng(37.435, 127.105)))''')


def record_reader(app, apartment_id='transfer-15'):
    card = app.locator(f'[data-place-id="{apartment_id}"]')
    card.locator('summary').click()
    card.get_by_role('link', name='네이버 부동산').focus()
    return evaluate(app, '''() => {
      window.__readingFocus = document.activeElement;
      window.__readingCard = document.activeElement.closest('.apartment-card');
      return { top: document.activeElement.getBoundingClientRect().top,
        ids: [...document.querySelectorAll('.apartment-card')].map(card => card.dataset.placeId) };
    }''')


def assert_reader(app, reading):
    assert evaluate(app, '() => document.activeElement === window.__readingFocus')
    assert evaluate(app, '() => document.querySelector(`[data-place-id="${window.__readingCard.dataset.placeId}"]`) === window.__readingCard')
    assert abs(evaluate(app, '() => window.__readingFocus.getBoundingClientRect().top') - reading['top']) <= 2
    assert evaluate(app, '() => window.__readingCard.querySelector("details").open')


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일')
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        evaluate(app, '''() => {
          const state = window.__searchTest, transfer = state.homes[1], direct = state.homes[2];
          state.pageSize = 20;
          state.homes = [...Array.from({length: 20}, (_, index) => ({ ...transfer, id: `transfer-${index}`, place_name: `읽던 집 ${index}` })),
            { ...direct, id: 'late-direct', place_name: '늦게 찾은 무환승 집' }];
          state.delayFor = (query, options) => query === '아파트' && options.page === 2 ? 2400 : 30;
        }''')
        app.get_by_role('button', name='검색', exact=True).click()
        focus_both(app)
        expect(app.locator('.apartment-card')).to_have_count(20, timeout=10000)
        expect(app.get_by_role('region', name='환승 0회 아파트')).to_have_count(0)
        reading = record_reader(app)
        expect(app.locator('[data-place-id="late-direct"]')).to_have_count(1, timeout=10000)
        expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=10000)
        ids = app.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)')
        assert ids[0] == 'late-direct' and ids[1:] == reading['ids']
        assert_reader(app, reading)
        assert not errors, errors
        context.close()
        print(mode, '늦은 환승 0회 자동 우선 표시·기존 환승 목록 순서·상세·포커스·보던 위치 유지 검증 통과', flush=True)

    context, page, errors = prepare(browser)
    choose(page)
    evaluate(page, '''() => {
      const state = window.__searchTest, transfer = state.homes[1], direct = state.homes[2];
      state.pageSize = 15; state.cappedTotal = true;
      state.homes = [...Array.from({length: 20}, (_, index) => ({ ...transfer, id: `transfer-${index}`, place_name: `읽던 집 ${index}` })),
        ...Array.from({length: 60}, (_, index) => ({ ...direct, id: `direct-${index}`, place_name: `무환승 집 ${index}`,
          y: String(37.3994 + index % 8 * .00015), x: String(127.0994 + Math.floor(index / 8) * .00015) }))];
    }''')
    page.get_by_role('button', name='검색', exact=True).click()
    evaluate(page, '''() => window.__searchTest.map.setBounds(new window.kakao.maps.LatLngBounds(
      new window.kakao.maps.LatLng(37.415, 127.095), new window.kakao.maps.LatLng(37.425, 127.105)))''')
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=30000)
    expect(page.locator('.apartment-card')).to_have_count(20)
    reading = record_reader(page)
    calls = evaluate(page, '() => window.__searchTest.calls.length')
    focus_both(page)
    expect(page.locator('.apartment-card')).to_have_count(70)
    assert_reader(page, reading)
    direct = page.get_by_role('region', name='환승 0회 아파트')
    transfer = page.get_by_role('region', name='환승 1회 이상 아파트')
    expect(direct.locator('.apartment-card')).to_have_count(50)
    expect(transfer.locator('.apartment-card')).to_have_count(20)
    direct.get_by_role('button', name='환승 0회 더 보기', exact=True).click()
    expect(direct.locator('.apartment-card')).to_have_count(60)
    expect(transfer.locator('.apartment-card')).to_have_count(20)
    assert evaluate(page, '() => window.__searchTest.calls.length') == calls
    assert evaluate(page, '() => window.__readingCard.querySelector("details").open')
    assert not errors, errors
    page.screenshot(path='/tmp/galmanzip-transfer-priority.png')
    context.close()
    print('지도 확대 범위의 무환승 우선·분류별 더 보기·기존 항목 페이지 이탈 방지 검증 통과', flush=True)
    browser.close()
