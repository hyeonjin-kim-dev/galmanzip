"""클러스터 확대·단일 아이콘 정보창과 Worker의 실제 보행망 표시를 검증한다."""
import gzip
import json
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, NETWORK, choose, includes_selection, line, prepare


def evaluate(app, script, arg=None):
    return app.locator('.map-canvas').evaluate(script, arg)


def walking_lines(app):
    return evaluate(app, '''() => window.__searchTest.polylines.filter(line => line.map && line.options.strokeStyle === 'shortdash')
      .map(line => line.options.path.map(point => [point.getLat(), point.getLng()]))''')


def fixture(context, failed=False):
    calls = []
    def walking(route):
        calls.append(route.request.url)
        if failed:
            route.fulfill(status=503, body='검증용 자료 실패')
        elif route.request.url.endswith('index.json'):
            route.fulfill(json=dict(version=1, cell=.02, source=dict(timestamp='2026-11-02'),
                tiles={f'{y}-{x}': 'walk-123456abcdef.json.gz' for y in range(1869, 1872) for x in range(6356, 6360)}))
        else:
            tile = dict(version=1, nodes=[[1, 374000000, 1271590000], [2, 374005000, 1271590000],
                                         [3, 374005000, 1271600000], [4, 374000000, 1271600000]],
                        edges=[[1, 2, 0], [2, 3, 0], [3, 4, 0]])
            route.fulfill(content_type='application/octet-stream', body=gzip.compress(json.dumps(tile).encode()))
    context.route('**/data/walking/**', walking)
    return calls


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        network = dict(NETWORK, lines=[line('검증 직행', ['A', 'C'], [660])])
        context, page, errors = prepare(browser, mobile=mode == '모바일', network=network)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:740px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        evaluate(app, '''() => {
          const state = window.__searchTest, sample = state.homes[2];
          state.homes = [{...sample, id:'a', place_name:'검증 아파트 가'}, {...sample, id:'b', place_name:'검증 아파트 나', x:'127.1001'}];
        }''')
        app.get_by_role('button', name='검색', exact=True).click()
        expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
        app.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
        expect(app.locator('.test-cluster')).to_have_text('2')
        before = evaluate(app, '() => ({level:window.__searchTest.level, fits:window.__searchTest.fitCount})')
        app.locator('.test-cluster').click()
        assert evaluate(app, '() => window.__searchTest.level') == before['level'] - 1
        assert abs(evaluate(app, '() => window.__searchTest.map.getCenter().getLng()') - 127.10005) < .000001
        assert evaluate(app, '() => window.__searchTest.fitCount') == before['fits']
        expect(app.locator('.map-route-info')).to_have_count(0)
        expect(app.locator('.apartment-card')).to_have_count(2)
        evaluate(app, '''() => window.__searchTest.map.setBounds(new window.kakao.maps.LatLngBounds(
          new window.kakao.maps.LatLng(37.399,127.099),new window.kakao.maps.LatLng(37.401,127.1)))''')
        # 대역의 범위 여유보다 충분히 떨어진 한 항목만 직접 제외해 SDK 단일 표시를 재현한다.
        evaluate(app, '''() => {
          const map=window.__searchTest.map;
          map.bounds=new window.kakao.maps.LatLngBounds(new window.kakao.maps.LatLng(37.3999,127.0999),new window.kakao.maps.LatLng(37.4001,127.10001));
          map.changed();
        }''')
        expect(app.locator('.test-cluster')).to_have_count(0)
        expect(app.locator('.test-apartment-marker')).to_have_count(1)
        previous = evaluate(app, '() => ({level:window.__searchTest.level,fits:window.__searchTest.fitCount})')
        app.locator('.test-apartment-marker').click()
        expect(app.get_by_role('dialog', name='검증 아파트 가 정보')).to_be_visible()
        expect(app.locator('.apartment-tooltip')).to_contain_text('약 11분 · 환승 0회')
        assert evaluate(app, '() => ({level:window.__searchTest.level,fits:window.__searchTest.fitCount})') == previous
        expect(app.locator('.map-route-info')).to_have_count(0)
        app.get_by_role('button', name='아파트 정보 닫기').click()
        expect(app.locator('.apartment-tooltip')).to_have_count(0)
        app.locator('.test-apartment-marker').click()
        app.get_by_role('button', name='경로 보기', exact=True).click()
        expect(app.locator('.map-route-info > strong')).to_contain_text('검증 아파트 가')
        evaluate(app, '() => new Promise(resolve=>setTimeout(resolve,500))')
        assert includes_selection(app, 'a')
        assert not errors, errors
        context.close()
        print(mode, '클러스터 중심 확대·단일 아이콘/정보창·경로 보기·누적 목록 유지 통과', flush=True)

    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일')
        calls = fixture(context)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:740px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        evaluate(app, '''() => {const state=window.__searchTest;state.homes=[{...state.homes[2],id:'walk',place_name:'도보 검증 아파트',x:'127.159',y:'37.4'}]}''')
        app.get_by_role('combobox', name='소요 시간').click()
        app.get_by_role('option', name='0~10분', exact=True).click()
        app.get_by_role('button', name='검색', exact=True).click()
        expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
        expect(app.locator('[data-place-id="walk"]')).to_be_visible()
        assert calls == []
        app.locator('[data-place-id="walk"] .apartment-heading').click()
        expect(app.locator('.walking-path-info')).to_be_visible()
        assert walking_lines(app) == [[[37.4,127.159],[37.4005,127.159],[37.4005,127.16],[37.4,127.16]]]
        expect(app.locator('.map-route-info').get_by_role('link', name='OpenStreetMap 기여자')).to_be_visible()
        assert len(calls) == 2
        app.locator('[data-place-id="walk"] .apartment-heading').click()
        evaluate(app, '() => new Promise(resolve=>setTimeout(resolve,300))')
        assert len(calls) == 2
        assert includes_selection(app, 'walk')
        assert not errors, errors
        page.screenshot(path=f'/tmp/galmanzip-walking-{mode}.png')
        context.close()
        print(mode, 'Worker 도보 길 연결·선택 후 지역 파일 준비·메모리 재사용·출처 표시 통과', flush=True)

    # 공개 보행망 파일을 그대로 읽어 원본의 꺾인 선형과 속도를 확인한다.
    real_network = dict(NETWORK, stops=[dict(stop, lat=37.386, lng=127.1226) if stop['id']=='C' else stop for stop in NETWORK['stops']])
    context, page, errors = prepare(browser, network=real_network)
    choose(page)
    page.evaluate('''() => { const state=window.__searchTest;
      state.destination={...state.destination,x:'127.1226',y:'37.386'};
      state.homes=[{...state.homes[2],id:'real-walk',place_name:'서현역 주변 보행 검증',x:'127.1233',y:'37.3851'}];
    }''')
    page.get_by_role('combobox', name='목적지 검색').fill('서현역 주변')
    page.get_by_role('option', name='검증 목적지 경기 성남시 검증로 1').click()
    page.get_by_role('combobox', name='소요 시간').click()
    page.get_by_role('option', name='0~10분', exact=True).click()
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    page.evaluate('window.__walkStart=performance.now()')
    page.locator('[data-place-id="real-walk"] .apartment-heading').click()
    expect(page.locator('.walking-path-info')).to_be_visible()
    elapsed=page.evaluate('performance.now()-window.__walkStart')
    paths=walking_lines(page)
    assert len(paths)==1 and len(paths[0])==5
    assert paths[0][1:4]==[[37.3857095,127.1233849],[37.3861478,127.1229234],[37.3862311,127.1228356]]
    expect(page.locator('.walking-path-info')).to_contain_text('연결은 미확인')
    assert elapsed < 3000, elapsed
    assert not errors, errors
    print(f'실제 서현역 주변 보행망 2개 파일·5개 선형 좌표 표시: {elapsed:.0f}ms (로컬 SDK 대역)', flush=True)
    context.close()

    context, page, errors = prepare(browser)
    fixture(context, failed=True)
    choose(page)
    page.evaluate("window.__searchTest.homes=[{...window.__searchTest.homes[2],id:'walk',x:'127.159',y:'37.4'}]")
    page.get_by_role('combobox', name='소요 시간').click()
    page.get_by_role('option', name='0~10분', exact=True).click()
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    page.locator('[data-place-id="walk"] .apartment-heading').click()
    expect(page.locator('.walking-path-missing')).to_be_visible()
    assert walking_lines(page)==[]
    expect(page.locator('.apartment-card')).to_have_count(1)
    assert not errors, errors
    context.close()
    print('자료 실패 시 직선 생략·이유 안내·기존 목록 유지 통과', flush=True)
    browser.close()
