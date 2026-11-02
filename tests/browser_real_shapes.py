"""배포한 실제 102번 자료의 경로 계산과 도로 좌표 표시를 지도 SDK 대역에서 검증한다."""
import gzip
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, choose, prepare

ROOT = Path(__file__).resolve().parents[1] / 'public/data'
manifest = json.loads((ROOT / 'transit.json').read_text())
network = json.loads(gzip.decompress((ROOT / manifest['asset']).read_bytes()))
index = json.loads((ROOT / 'bus-shapes/index.json').read_text())
identifier = next(key for key in index['patterns'] if key.startswith('BR_TAGO_GGB206000007:'))
shape = json.loads(gzip.decompress((ROOT / 'bus-shapes' / index['patterns'][identifier]).read_bytes()))
line = next(line for line in network['lines'] if line['id'] == identifier)
stops = {stop['id']: stop for stop in network['stops']}
segment = None
for start in range(len(line['stops'])):
    for end in range(start + 2, len(line['stops'])):
        seconds = sum(line['seconds'][start:end]) + sum(line.get('dwellSeconds', [0] * len(line['stops']))[start + 1:end])
        a, b = stops[line['stops'][start]], stops[line['stops'][end]]
        if 650 <= seconds <= 800 and abs(a['lat'] - b['lat']) + abs(a['lng'] - b['lng']) > .025:
            segment = a, b
            break
    if segment:
        break
assert segment, '실제 102번의 검증 구간을 찾지 못했습니다.'
real = dict(network, lines=[line], stops=[stops[key] for key in set(line['stops'])], transfers=[])


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일', network=real)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        app.locator('.map-canvas').evaluate('''(element, pair) => {
          const state = window.__searchTest;
          state.destination = { ...state.destination, y: String(pair[1].lat), x: String(pair[1].lng) };
          state.homes = [{ ...state.homes[0], id: 'real-102', place_name: '실제 102번 좌표 검증용 집',
            y: String(pair[0].lat), x: String(pair[0].lng), address_name: '경기 용인시 수지구' }];
          const post = Worker.prototype.postMessage;
          Worker.prototype.postMessage = function(task, ...options) {
            if (task.kind === 'geometry') window.__selectedRealRoute = task.apartment;
            return post.call(this, task, ...options);
          };
        }''', segment)
        choose(app, touch=mode == '모바일')
        app.get_by_role('button', name='검색', exact=True).click()
        expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=20000)
        app.get_by_role('button', name='찾은 집 모두 보기', exact=True).click()
        card = app.locator('[data-place-id="real-102"]')
        expect(card).to_be_visible()
        expect(card.locator('.apartment-time')).to_contain_text('환승 0회')
        card.locator('.route-gauge-button').click()
        expect(app.get_by_text('버스 도로 경로', exact=True)).to_be_visible()
        expect(app.locator('.map-route-info').get_by_role('link', name='경기버스정보(GBIS)')).to_be_visible()
        result = app.locator('.map-canvas').evaluate('''() => ({ selected: window.__selectedRealRoute,
          lines: window.__searchTest.polylines.filter(line => line.map && line.options.strokeColor === '#E60012')
            .map(line => ({ opacity: line.options.strokeOpacity, points: line.options.path.map(point => ({ lat: point.getLat(), lng: point.getLng() })) })) })''')
        ride = next(leg for leg in result['selected']['legs'] if leg['mode'] == 'bus')
        assert ride['lineId'] == identifier and ride['typeName'] == '직행좌석'
        foreground = next(line for line in result['lines'] if line['opacity'] == 1)
        background = next(line for line in result['lines'] if line['opacity'] < 1)
        assert background['points'] == shape['points']
        assert foreground['points'] == shape['points'][shape['stopIndexes'][ride['fromIndex']]:shape['stopIndexes'][ride['toIndex']] + 1]
        assert len(foreground['points']) > ride['toIndex'] - ride['fromIndex'] + 1
        assert not errors, errors
        context.close()
        print(mode, f'실제 102번 계산·직행좌석 빨강·도로 좌표 {len(background["points"])}개·정확한 탑승 구간 분리 검증 통과', flush=True)
    browser.close()
