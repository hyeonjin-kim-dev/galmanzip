"""실거래가 표시·늦은 응답·주소 대조·모바일과 iframe 동작을 확인한다."""
import gzip
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, choose, includes_selection, prepare

MANIFEST = dict(version=1, status='ready', collectedOn='2026-11-09',
    months=['202512'] + [f'2026{i:02d}' for i in range(1, 12)],
    source=dict(url='https://www.data.go.kr/data/15126468/openapi.do'),
    districts=[dict(code='41135', name='경기도 성남시 분당구', asset='sales-41135-123456abcdef.json.gz')])


def record(apt_id, number, transactions, date='2026-10-20'):
    return dict(id=apt_id, names=[f'검증 {number}단지'], roadAddresses=[f'경기도 성남시 분당구 검증로 {number}'],
        lotAddresses=[f'경기도 성남시 분당구 검증동 {number}'], date=date, transactions=transactions)


def evaluate(app, script, arg=None):
    return app.locator('.map-canvas').evaluate(script, arg)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일')
        calls = []
        def sales(route):
            calls.append(route.request.url)
            if route.request.url.endswith('index.json'):
                route.fulfill(json=MANIFEST)
            else:
                time.sleep(1)
                route.fulfill(content_type='application/octet-stream', body=gzip.compress(json.dumps(dict(version=1, district='41135',
                    apartments=[record('41135-1', 1, [[123456, 84.99, 7]]), record('41135-2', 2, [[70000, 59.9, 3], [90000, 84.8, 10]])])).encode()))
        context.route('**/data/sales/**', sales)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:800px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        evaluate(app, '''() => { const state=window.__searchTest;
          state.homes = state.homes.slice(0,3).map((home,i)=>({...home, road_address_name:`경기 성남시 분당구 검증로 ${i+1}`,
            address_name:`경기 성남시 분당구 검증동 ${i+1}`}));
        }''')
        app.get_by_role('button', name='검색', exact=True).click()
        expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
        app.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
        card = app.locator('[data-place-id="slow"]')
        card.locator('.apartment-sale').scroll_into_view_if_needed()
        expect(card.locator('.apartment-sale')).to_have_attribute('data-status', 'matched', timeout=10000)
        expect(card.locator('.apartment-sale-main strong')).to_have_text('12억 3,456만 원')
        expect(card.locator('.apartment-sale-meta')).to_have_text('2026.10.20 계약 · 전용 84.99㎡ · 7층')
        expect(card.locator('.apartment-sale-source')).to_contain_text('2026.11.09 수집 · 호가 아님')
        card.locator('summary').click()
        expect(card.locator('.route-details')).to_have_attribute('open', '')
        second = app.locator('[data-place-id="transfer"]')
        second.scroll_into_view_if_needed()
        expect(second.locator('.apartment-sale')).to_have_attribute('data-status', 'matched')
        expect(second.locator('.apartment-sale-main strong')).to_have_text('7억 원 ~ 9억 원')
        second.get_by_text('면적·층별 거래 보기', exact=True).click()
        expect(second.locator('.sale-transactions li')).to_have_count(2)
        expect(second.locator('.sale-transactions li')).to_have_text(['전용 59.9㎡ · 3층7억 원', '전용 84.8㎡ · 10층9억 원'])
        app.locator('[data-place-id="fast"] .apartment-sale').scroll_into_view_if_needed()
        expect(app.locator('[data-place-id="fast"] .apartment-sale')).to_have_attribute('data-status', 'unmatched')
        assert len(calls) == 2, calls
        second.locator('.apartment-heading').click()
        expect(app.locator('.map-route-info')).to_be_visible()
        evaluate(app, '() => new Promise(resolve=>setTimeout(resolve,400))')
        assert includes_selection(app, 'transfer')
        assert evaluate(app, '() => document.documentElement.scrollWidth <= innerWidth')
        assert evaluate(app, '() => localStorage.length + sessionStorage.length') == 0
        assert not errors, errors
        second.screenshot(path=f'/tmp/galmanzip-sales-{mode}.png')
        context.close()
        print(mode, '실거래 금액·면적/층/계약일·같은 날 여러 거래·출처·지역 파일 재사용 검증 통과', flush=True)

    context, page, errors = prepare(browser)
    fail = True
    def unstable(route):
        if fail:
            route.fulfill(status=503, body='검증용 일시적 오류')
        elif route.request.url.endswith('index.json'):
            route.fulfill(json=MANIFEST)
        else:
            route.fulfill(json=dict(version=1, district='41135', apartments=[record('41135-1', 1, [[123456, 84.99, 7]])]))
    context.route('**/data/sales/**', unstable)
    choose(page)
    page.evaluate("window.__searchTest.homes=[{...window.__searchTest.homes[2],road_address_name:'경기 성남시 분당구 검증로 1',address_name:'경기 성남시 분당구 검증동 1'}]")
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    page.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
    page.locator('.apartment-sale').scroll_into_view_if_needed()
    expect(page.locator('.apartment-sale')).to_have_attribute('data-status', 'unavailable')
    page.locator('.route-details summary').click()
    initial = page.locator('.route-details').bounding_box()
    fail = False
    page.get_by_role('button', name='다시 확인', exact=True).click()
    expect(page.locator('.apartment-sale')).to_have_attribute('data-status', 'matched')
    expect(page.locator('.route-details')).to_have_attribute('open', '')
    assert abs(page.locator('.route-details').bounding_box()['y'] - initial['y']) <= 1
    expect(page.locator('.apartment-card')).to_have_count(1)
    assert not errors, errors
    context.close()
    print('가격 요청 실패·명시적 재시도·가격 도착 후 기존 목록/상세 위치 유지 검증 통과', flush=True)

    # 가격은 실제 배포 자료를 사용하고 지도·장소 SDK만 대역으로 분리한다.
    root = Path(__file__).resolve().parents[1] / 'public/data/sales'
    index = json.loads((root / 'index.json').read_text())
    district = next(item for item in index['districts'] if item['code'] == '41135')
    records = json.loads(gzip.decompress((root / district['asset']).read_bytes()))['apartments']
    apartment = next(item for item in records if item['id'] == '41135-103')
    def amount(value):
        large, small = divmod(value, 10000)
        return (' '.join(filter(None, [f'{large:,}억' if large else '', f'{small:,}만' if small else ''])) + ' 원')
    prices = [row[0] for row in apartment['transactions']]
    expected = amount(min(prices)) if min(prices) == max(prices) else f'{amount(min(prices))} ~ {amount(max(prices))}'
    context, page, errors = prepare(browser)
    choose(page)
    page.evaluate('''apartment => { const state=window.__searchTest;
      state.homes=[{...state.homes[2], place_name:apartment.names[0]+'아파트',
        road_address_name:apartment.roadAddresses[0].replace('경기도 ', '경기 '),
        address_name:apartment.lotAddresses[0].replace('경기도 ', '경기 ')}];
    }''', apartment)
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
    page.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
    page.locator('.apartment-sale').scroll_into_view_if_needed()
    expect(page.locator('.apartment-sale')).to_have_attribute('data-status', 'matched')
    expect(page.locator('.apartment-sale-main strong')).to_have_text(expected)
    expect(page.locator('.apartment-sale-meta')).to_contain_text(apartment['date'].replace('-', '.')+' 계약')
    expect(page.locator('.apartment-sale-source')).to_contain_text(index['collectedOn'].replace('-', '.')+' 수집')
    assert not errors, errors
    page.locator('.apartment-card').screenshot(path='/tmp/galmanzip-sales-actual.png')
    context.close()
    print(f'실제 국토부 정적 자료·지도 SDK 대역: {apartment["names"][0]} {expected} · 계약일/수집일 표시 검증 통과', flush=True)
    browser.close()
