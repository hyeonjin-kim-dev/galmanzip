"""환승 상한 드롭다운, 수단별 정렬, 늦은 우선 결과의 읽기 위치를 검증한다."""
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, NETWORK, choose, line, prepare

stops = [dict(id='D', name='목적지역', lat=37.4, lng=127.16),
         dict(id='R', name='지하철 출발', lat=37.4, lng=127.1),
         dict(id='E', name='좌석버스 출발', lat=37.41, lng=127.1),
         dict(id='L', name='마을버스 출발', lat=37.42, lng=127.1)]
stops += [dict(id=f'P{i}', name=f'환승 출발 {i}', lat=37.46, lng=127.16 - i * .02) for i in range(4)]
lines = [line('지하철', ['R', 'D'], [900]),
         dict(line('102', ['E', 'D'], [700]), mode='bus', typeName='직행좌석', color='#E60012'),
         dict(line('마을 7', ['L', 'D'], [650]), mode='bus', typeName='마을', color='#6EA800'),
         line('마지막 차량', ['P0', 'D'], [660])]
lines += [line(f'환승 차량 {i}', [f'P{i}', f'P{i-1}'], [180]) for i in range(1, 4)]
network = dict(NETWORK, stops=stops, lines=lines)


def evaluate(app, script, arg=None):
    return app.locator('.map-canvas').evaluate(script, arg)


def setup(app):
    evaluate(app, '''(_, stops) => {
      const state = window.__searchTest, sample = state.homes[2];
      state.pageSize = 15;
      state.homes = stops.filter(stop => !['D', 'P0'].includes(stop.id)).map(stop => ({ ...sample,
        id: stop.id, place_name: `${stop.name} 아파트`, y: String(stop.lat), x: String(stop.lng) }));
    }''', stops)


def search(app):
    app.get_by_role('button', name='검색', exact=True).click()
    expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    app.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일', network=network)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        setup(app)
        transfer = app.get_by_role('combobox', name='최대 환승 횟수')
        expect(transfer.locator('.travel-time-label')).to_have_text('환승 3회 이하')
        transfer.click()
        options = app.get_by_role('listbox', name='최대 환승 횟수').get_by_role('option')
        expect(options).to_have_count(4)
        assert options.all_text_contents() == ['환승 0회', '환승 1회 이하', '환승 2회 이하', '환승 3회 이하']
        transfer.press('Escape')
        expect(transfer).to_have_attribute('aria-expanded', 'false')
        assert transfer.evaluate('(element) => element.getBoundingClientRect().height') == 32
        for limit in (3, 0, 1, 2, 3):
            transfer.press('Home')
            for _ in range(limit):
                transfer.press('ArrowDown')
            transfer.press('Enter')
            expect(app.locator('.apartment-card')).to_have_count(0)
            search(app)
            expect(app.locator('.apartment-card')).to_have_count(3 + limit)
            expect(app.locator('.test-cluster')).to_have_text(str(3 + limit))
            ids = app.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)')
            assert ids == ['R', 'E', 'L'] + [f'P{i}' for i in range(1, limit + 1)], ids
            app.get_by_role('button', name='수단·시간순 정렬', exact=True).click()
            assert app.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)') == ids
            expect(app.locator('.results-summary')).to_contain_text(f'최대 환승 {limit}회')
        assert evaluate(app, '() => document.documentElement.scrollWidth <= innerWidth')
        if mode == '모바일':
            page.set_viewport_size(dict(width=320, height=700))
            assert evaluate(app, '() => document.documentElement.scrollWidth <= innerWidth')
            transfer.click()
            expect(app.get_by_role('option', name='환승 0회', exact=True)).to_be_visible()
            page.screenshot(path='/tmp/galmanzip-transfer-dropdown-mobile.png')
        else:
            page.screenshot(path=f'/tmp/galmanzip-transfer-order-{mode}.png')
        assert evaluate(app, '() => localStorage.length + sessionStorage.length') == 0
        assert not errors, errors
        context.close()
        print(mode, '환승 0~3회 경계·조건 변경·지하철/좌석/마을 순서·키보드·화면 폭 검증 통과', flush=True)

    context, page, errors = prepare(browser, network=network)
    choose(page)
    setup(page)
    evaluate(page, '''() => {
      const state = window.__searchTest, bus = state.homes.find(home => home.id === 'L');
      state.homes = [...Array.from({length: 20}, (_, i) => ({ ...bus, id: `bus-${i}`, place_name: `읽던 마을버스 집 ${i}` })),
        state.homes.find(home => home.id === 'E'), state.homes.find(home => home.id === 'R')];
      state.pageSize = 20;
      state.delayFor = (query, options) => query === '아파트' && options.page === 2 ? 2400 : 30;
    }''')
    page.get_by_role('button', name='검색', exact=True).click()
    evaluate(page, '''() => window.__searchTest.map.setBounds(new window.kakao.maps.LatLngBounds(
      new window.kakao.maps.LatLng(37.395, 127.095), new window.kakao.maps.LatLng(37.425, 127.105)))''')
    expect(page.locator('.apartment-card')).to_have_count(20, timeout=10000)
    initial_ids = page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)')
    card = page.locator('[data-place-id="bus-15"]')
    card.locator('summary').click()
    card.get_by_role('link', name='네이버 부동산').focus()
    reading = evaluate(page, '''() => {
      window.__reading = document.activeElement;
      return window.__reading.getBoundingClientRect().top;
    }''')
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=10000)
    ids = page.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)')
    assert ids == ['R', 'E'] + initial_ids, ids
    assert evaluate(page, '() => window.__reading === document.activeElement')
    assert abs(evaluate(page, '() => window.__reading.getBoundingClientRect().top') - reading) <= 2
    expect(card.locator('details')).to_have_attribute('open', '')
    assert not errors, errors
    context.close()
    print('늦은 지하철·좌석버스 우선 추가 후 읽던 버스 목록·상세·스크롤·포커스 유지 검증 통과', flush=True)
    browser.close()
