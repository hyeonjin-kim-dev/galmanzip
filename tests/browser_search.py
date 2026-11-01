"""카카오 제휴 승인 대기 화면과 기존 지도·검색 조건 UI를 검증한다."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent
BASE = os.environ.get('GALMANZIP_TEST_URL', 'http://127.0.0.1:5173/galmanzip/')
MESSAGE = '카카오 대중교통 길찾기 연동을 준비하고 있습니다. 경로 검색은 현재 이용할 수 없습니다.'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in (1280, 390, 320):
        context = browser.new_context(viewport=dict(width=width, height=844), is_mobile=width < 768, has_touch=width < 768)
        context.route('https://dapi.kakao.com/**', lambda route: route.fulfill(
            content_type='application/javascript', body=(ROOT / 'fixtures/kakao.js').read_text()))
        page = context.new_page()
        errors, requests, workers = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        page.on('worker', lambda worker: workers.append(worker.url))
        page.goto(BASE)
        expect(page.get_by_text(MESSAGE, exact=True)).to_be_visible()
        field = page.get_by_role('combobox', name='목적지 검색')
        field.fill('검증 목적지')
        page.get_by_role('option', name='검증 목적지 경기 성남시 검증로 1').click()
        duration = page.get_by_role('combobox', name='소요 시간')
        duration.click()
        expect(page.get_by_role('listbox', name='소요 시간').get_by_role('option')).to_have_count(18)
        page.get_by_role('option', name='10분 ~ 20분', exact=True).click()
        expect(page.get_by_role('button', name='검색', exact=True)).to_be_disabled()
        field.press('Enter')
        expect(page.get_by_text(MESSAGE, exact=True)).to_be_visible()
        expect(page.locator('.apartment-card')).to_have_count(0)
        if width < 768:
            page.locator('.sheet-handle').press('End')
            page.wait_for_timeout(250)
            assert page.locator('.map-panel').bounding_box()['y'] >= page.locator('.destination-search').bounding_box()['y'] + page.locator('.destination-search').bounding_box()['height']
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not workers, workers
        assert not any('/data/transit' in url or '/multimodal/directions' in url for url in requests), requests
        assert not page.evaluate('window.__searchTest.calls.some(call => call.query === "아파트")')
        assert not errors, errors
        page.screenshot(path=f'/tmp/galmanzip-transit-pending-{width}.png')
        context.close()
        print(f'{width}px: 승인 대기 안내·검색 중단·교통 자료/계산 작업 미실행 검증 통과', flush=True)
    browser.close()
