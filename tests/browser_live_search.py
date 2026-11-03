"""지도 이벤트 없이 결과가 계속 추가되는지와 느린 장소 응답의 영향을 측정한다."""
import argparse
import json
from playwright.sync_api import sync_playwright, expect
from browser_support import BASE, NETWORK, choose, line, prepare

parser = argparse.ArgumentParser()
parser.add_argument('--measure-only', action='store_true')
args = parser.parse_args()
origins = [(37.397, 127.157), (37.397, 127.163), (37.403, 127.157), (37.403, 127.163)]
stops = [dict(id=str(i), name=f'출발역 {i}', lat=lat, lng=lng) for i, (lat, lng) in enumerate(origins)]
network = dict(NETWORK, stops=stops + [dict(id='D', name='목적지역', lat=37.4, lng=127.16)],
               lines=[line(f'직통 {i}', [str(i), 'D'], [660]) for i in range(4)])


def evaluate(app, script, arg=None):
    return app.locator('.map-canvas').evaluate(script, arg)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for mode in ('PC', '모바일', 'iframe'):
        context, page, errors = prepare(browser, mobile=mode == '모바일', network=network)
        app = page
        if mode == 'iframe':
            page.set_content(f'<iframe src="{BASE}" style="width:390px;height:700px;border:0" sandbox="allow-scripts allow-same-origin allow-popups"></iframe>')
            app = page.frame_locator('iframe')
        choose(app, touch=mode == '모바일')
        evaluate(app, '''(_, origins) => {
          const state = window.__searchTest, sample = state.homes[2];
          state.pageSize = 15; state.cappedTotal = true; state.freezeIdle = true;
          state.homes = origins.flatMap(([lat, lng], group) => Array.from({length: 15}, (_, index) => ({
            ...sample, id: `home-${group}-${index}`, place_name: `자동 갱신 집 ${group}-${index}`,
            y: String(lat + index % 3 * .00001), x: String(lng + Math.floor(index / 3) * .00001),
          })));
          state.delayFor = query => query !== '아파트' ? 10
            : state.calls.filter(call => call.query === '아파트').length === 2 ? 2000 : 500;
          window.__live = { start: performance.now(), changes: [] };
          new MutationObserver(() => {
            const count = document.querySelectorAll('.apartment-card').length, log = window.__live;
            if (count && count !== log.changes.at(-1)?.count) log.changes.push({ count, ms: performance.now() - log.start });
          }).observe(document.querySelector('.panel-content'), { childList: true, subtree: true });
        }''', origins)
        app.get_by_role('button', name='검색', exact=True).click()
        expect(app.locator('.apartment-card')).to_have_count(15, timeout=10000)
        app.locator('.apartment-card').first.locator('summary').click()
        app.locator('.apartment-card').first.get_by_role('link', name='네이버 부동산').focus()
        reading = evaluate(app, '''() => {
          window.__card = document.querySelector('.apartment-card'); window.__focus = document.activeElement;
          return { top: window.__focus.getBoundingClientRect().top,
            ids: [...document.querySelectorAll('.apartment-card')].map(card => card.dataset.placeId) };
        }''')
        expect(app.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=30000)
        expect(app.locator('.results-summary h2')).to_have_text('찾은 아파트 60곳')
        expect(app.locator('.test-cluster')).to_have_text('60')
        assert evaluate(app, '() => window.__searchTest.map.getCenter().getLng()') == 127.16
        assert evaluate(app, '() => window.__searchTest.fitCount || 0') == 0
        assert evaluate(app, '() => document.activeElement === window.__focus && window.__card.querySelector("details").open')
        assert abs(evaluate(app, '() => window.__focus.getBoundingClientRect().top') - reading['top']) <= 2
        ids = app.locator('.apartment-card').evaluate_all('(cards) => cards.map(card => card.dataset.placeId)')
        assert ids[:15] == reading['ids']
        metrics = evaluate(app, '''() => {
          const calls = window.__searchTest.calls.filter(call => call.query === '아파트');
          const overlap = Math.max(...calls.map(call => calls.filter(other => other.started <= call.started && other.completed > call.started).length));
          return { first: window.__live.changes[0].ms, next: window.__live.changes[1].ms,
            total: Math.max(...calls.map(call => call.completed)) - window.__live.start,
            overlap, requests: calls.length, intervals: calls.slice(1).map((call, i) => call.started - calls[i].started),
            overtaken: calls.some((call, i) => calls.slice(i + 1).some(next => next.completed < call.completed)) };
        }''')
        if not args.measure_only:
            assert metrics['overlap'] == 2, metrics
            assert metrics['overtaken'], metrics
            assert min(metrics['intervals']) >= 180, metrics
            assert metrics['next'] - metrics['first'] < 1700, metrics
        assert not errors, errors
        assert evaluate(app, '() => localStorage.length + sessionStorage.length') == 0
        print(mode, json.dumps(metrics, ensure_ascii=False), flush=True)
        context.close()

    context, page, errors = prepare(browser, network=network)
    choose(page)
    evaluate(page, '''(_, origins) => {
      const state = window.__searchTest, sample = state.homes[2];
      state.pageSize = 15; state.cappedTotal = true;
      state.homes = origins.flatMap(([lat, lng], group) => Array.from({length: 15}, (_, index) => ({
        ...sample, id: `cancel-${group}-${index}`, y: String(lat), x: String(lng),
      })));
      state.delayFor = query => query === '아파트' ? 1200 : 10;
    }''', origins)
    page.get_by_role('button', name='검색', exact=True).click()
    page.wait_for_function('window.__searchTest.calls.filter(call => call.query === "아파트" && !call.completed).length === 2')
    page.get_by_role('button', name='중단', exact=True).click()
    expect(page.get_by_text('검색을 중단했습니다.', exact=True)).to_be_visible()
    evaluate(page, '''() => {
      const state = window.__searchTest;
      state.homes = [{ ...state.homes[2], id: 'replacement', place_name: '다시 검색한 집' }];
      state.delayFor = () => 10;
    }''')
    page.get_by_role('button', name='검색', exact=True).click()
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible(timeout=10000)
    expect(page.locator('.apartment-card')).to_have_count(1)
    expect(page.locator('[data-place-id="replacement"]')).to_be_visible()
    page.wait_for_function('window.__searchTest.calls.every(call => call.completed)')
    expect(page.locator('.apartment-card')).to_have_count(1)
    expect(page.get_by_text('검색을 완료했습니다.', exact=True)).to_be_visible()
    assert not errors, errors
    context.close()
    print('동시에 진행 중인 요청 취소·즉시 재검색·늦은 응답의 결과 혼입 방지 검증 통과', flush=True)
    browser.close()
