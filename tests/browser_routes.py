"""시간 구성·선택 경로·비동기 경합·경로 표시 실패를 브라우저에서 검증한다."""
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, NETWORK, choose, includes_selection, line, prepare

CURVED = dict(NETWORK,
    stops=NETWORK['stops'] + [dict(id='BEND', name='경유 정류장', lat=37.45, lng=127.17)],
    lines=[dict(line('32번', ['A', 'BEND', 'C'], [300, 300]), mode='bus'),
           line('검증 첫차', ['X', 'B'], [330]), dict(line('마을 7번', ['B', 'C'], [330]), mode='bus'),
           line('검증 완행', ['Y', 'C'], [601])])


def evaluate(app, script, arg=None):
    return app.locator('.map-canvas').evaluate(script, arg)


def pause(app, milliseconds=350):
    evaluate(app, '(element, milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds))', milliseconds)


def active(app):
    return evaluate(app, '''() => window.__searchTest.polylines.filter(line => line.map && line.options.strokeColor !== '#ffffff')
      .map(line => ({ color: line.options.strokeColor, style: line.options.strokeStyle,
        path: line.options.path.map(point => [point.getLat(), point.getLng()]) }))''')


def instrument(app):
    evaluate(app, '''() => {
      window.__routeTasks = []; window.__reachCompact = false;
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function(task, ...options) {
        if (!this.__routeInstrumented) {
          this.__routeInstrumented = true;
          this.addEventListener('message', event => {
            if (window.__routeTasks.find(task => task.id === event.data.id)?.kind === 'reach') {
              window.__reachCompact = !!event.data.result?.stops?.length && event.data.result.stops.every(stop => !('legs' in stop));
            }
          });
        }
        window.__routeTasks.push({ kind: task.kind, id: task.id });
        if (task.kind === 'geometry' && window.__geometryFailNext) {
          window.__geometryFailNext = false;
          task = structuredClone(task); task.apartment.legs.find(leg => leg.mode === 'bus' || leg.mode === 'rail').fromIndex = 999999;
        }
        const delay = task.kind === 'geometry' ? window.__geometryDelay || 0 : 0;
        if (delay) setTimeout(() => post.call(this, task, ...options), delay);
        else post.call(this, task, ...options);
      };
    }''')


def search(app):
    app.get_by_role('button', name='검색', exact=True).click()
    expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    app.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일', network=CURVED)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        instrument(app)
        search(app)
        fast = app.locator('[data-place-id="fast"]')
        expect(fast.locator('.route-gauge')).to_have_count(1)
        assert fast.locator('.route-gauge-segment').evaluate_all('(segments) => segments.map(segment => segment.dataset.mode)') == ['bus']
        expect(fast.locator('.apartment-time')).to_contain_text('약 10분')
        assert '대기' not in fast.locator('.route-gauge').get_attribute('aria-label')
        assert '대기' not in fast.locator('.route-details').text_content()
        expect(fast.locator('.route-transit-stops')).to_contain_text('32번')
        expect(fast.locator('.route-transit-stops')).to_contain_text('2개 정류장')
        assert active(app) == []
        fast.locator('.route-gauge-button').click()
        expect(app.get_by_text('정류장 연결 경로', exact=True)).to_be_visible()
        pause(app)
        assert includes_selection(app, 'fast')
        assert active(app)[0]['path'] == [[37.4, 127.1], [37.45, 127.17], [37.4, 127.16]]
        assert active(app)[0]['color'] == '#65A30D'
        assert evaluate(app, '() => window.__searchTest.map.getBounds().getNorthEast().getLat()') >= 37.45
        evaluate(app, '() => window.__previousLines = window.__searchTest.polylines.filter(line => line.map)')
        app.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
        transfer = app.locator('[data-place-id="transfer"]')
        transfer.locator('.route-gauge-button').click()
        expect(app.locator('.map-route-info > strong')).to_contain_text('검증 환승 아파트')
        pause(app)
        assert len(active(app)) == 2
        assert len(set(line['color'] for line in active(app))) == 2
        assert evaluate(app, '() => window.__previousLines.every(line => !line.map)')
        assert evaluate(app, '() => window.__reachCompact')
        assert evaluate(app, '() => document.documentElement.scrollWidth <= innerWidth')
        if mode != 'PC':
            assert app.locator('.map-route-info').bounding_box()['y'] >= app.locator('.destination-search').bounding_box()['y'] + app.locator('.destination-search').bounding_box()['height']
        transfer.locator('.route-preview').screenshot(path=f'/tmp/galmanzip-route-card-{mode}.png')
        assert not errors, errors
        context.close()
        print(mode, '시간 게이지·수단/지도 색상·경유 정류장 전체 맞춤·이전 경로 제거 검증 통과', flush=True)

    context, page, errors = prepare(browser, network=CURVED)
    choose(page); instrument(page)
    evaluate(page, '''() => {
      window.__searchTest.pageSize = 2;
      window.__searchTest.delayFor = (query, options) => query === '아파트' && options.page === 2 ? 900 : 40;
    }''')
    page.get_by_role('button', name='검색', exact=True).click()
    evaluate(page, '''() => window.__searchTest.map.setBounds(new window.kakao.maps.LatLngBounds(
      new window.kakao.maps.LatLng(37.38, 127.08), new window.kakao.maps.LatLng(37.46, 127.18)))''')
    expect(page.locator('[data-place-id="slow"]')).to_be_visible(timeout=10000)
    expect(page.locator('[data-place-id="transfer"]')).to_be_visible()
    evaluate(page, '() => window.__geometryDelay = 1100')
    page.locator('[data-place-id="slow"] .route-gauge-button').click()
    evaluate(page, '() => window.__geometryDelay = 20')
    page.locator('[data-place-id="transfer"] .route-gauge-button').click()
    expect(page.get_by_text('정류장 연결 경로', exact=True)).to_be_visible()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    pause(page, 1400)
    expect(page.locator('.map-route-info > strong')).to_contain_text('검증 환승 아파트')
    assert len(active(page)) == 2
    assert evaluate(page, '() => window.__routeTasks.filter(task => task.kind === "geometry").length') == 2
    assert not errors, errors
    context.close()
    print('검색·경로 좌표 요청 동시 처리와 늦은 이전 선택 응답 무시 검증 통과', flush=True)

    context, page, errors = prepare(browser, network=CURVED)
    choose(page); instrument(page); search(page)
    evaluate(page, '() => window.__geometryDelay = 600')
    page.locator('[data-place-id="fast"] .route-gauge-button').click()
    evaluate(page, '''() => {
      const map = window.__searchTest.map;
      (map.events.dragstart || []).forEach(listener => listener());
      map.setCenter(new window.kakao.maps.LatLng(37.4, 127.14));
    }''')
    expect(page.get_by_text('정류장 연결 경로', exact=True)).to_be_visible()
    pause(page)
    assert evaluate(page, '() => window.__searchTest.map.getCenter().getLng()') == 127.14
    assert evaluate(page, '() => window.__searchTest.fitCount') == 1
    assert len(active(page)) == 1
    page.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
    page.locator('[data-place-id="fast"] .route-gauge-button').click()
    pause(page)
    assert includes_selection(page, 'fast')
    assert evaluate(page, '() => window.__routeTasks.filter(task => task.kind === "geometry").length') == 1
    evaluate(page, '() => { const initial = Date.now(); Date.now = () => initial + 2 * 3600000 + 1 }')
    page.locator('[data-place-id="fast"] .route-gauge-button').click()
    expect(page.get_by_text('정류장 연결 경로', exact=True)).to_be_visible()
    assert evaluate(page, '() => window.__routeTasks.filter(task => task.kind === "geometry").length') == 2
    page.get_by_role('combobox', name='소요 시간').click()
    page.get_by_role('option', name='20분 ~ 30분', exact=True).click()
    assert active(page) == []
    expect(page.locator('.map-route-info')).to_have_count(0)
    assert not errors, errors
    context.close()
    print('사용자 지도 유지·재선택 재사용·2시간 만료·조건 초기화 검증 통과', flush=True)

    context, page, errors = prepare(browser, network=CURVED)
    choose(page); instrument(page); search(page)
    evaluate(page, '() => window.__geometryFailNext = true')
    page.locator('[data-place-id="fast"] .route-gauge-button').click()
    expect(page.get_by_role('alert')).to_contain_text('운행 순서')
    assert active(page) == []
    expect(page.locator('.apartment-card')).not_to_have_count(0)
    page.get_by_role('button', name='경로 다시 표시', exact=True).click()
    expect(page.get_by_text('정류장 연결 경로', exact=True)).to_be_visible()
    assert len(active(page)) == 1
    assert not errors, errors
    context.close()
    print('잘못된 선형을 그리지 않고 오류 안내·재시도·기존 목록 유지 검증 통과', flush=True)

    context, page, errors = prepare(browser)
    choose(page)
    evaluate(page, "() => window.__searchTest.homes = [{ ...window.__searchTest.homes[3], y: '37.4005' }]")
    page.get_by_role('combobox', name='소요 시간').click()
    page.get_by_role('option', name='0~10분', exact=True).click()
    search(page)
    page.locator('.route-gauge-button').click()
    expect(page.get_by_text('정류장 연결 경로', exact=True)).to_be_visible()
    assert len(active(page)) == 1 and active(page)[0]['style'] == 'shortdash'
    assert active(page)[0]['path'][0] == [37.4005, 127.16]
    assert active(page)[0]['path'][-1] == [37.4, 127.16]
    assert not errors, errors
    context.close()
    print('도보 전용 게이지·점선과 실제 양 끝 좌표 연결 검증 통과', flush=True)
    browser.close()
