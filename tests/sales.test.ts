import test from 'node:test'
import assert from 'node:assert/strict'
import { gzipSync } from 'node:zlib'
import { createCatalog, createSalesLoader, formatAmount, matchSale, normalizeAddress, normalizeName, validateSalesIndex } from '../src/sales/data.ts'
import type { SaleApartment } from '../src/sales/data.ts'
import type { Place } from '../src/search/types.ts'

const manifest = { version: 1, status: 'ready', collectedOn: '2026-11-09', months: ['202512', ...Array.from({ length: 11 }, (_, i) => `2026${String(i + 1).padStart(2, '0')}`)],
  source: { url: 'https://www.data.go.kr/data/15126468/openapi.do' },
  districts: [{ code: '11110', name: '서울특별시 종로구', asset: 'sales-11110-123456abcdef.json.gz' }] }
const index = validateSalesIndex(manifest)
const apartment: SaleApartment = { id: '11110-1', names: ['검증1단지'], roadAddresses: ['서울특별시 종로구 검증로 10'],
  lotAddresses: ['서울특별시 종로구 검증동 5-1'], date: '2026-10-20', transactions: [[123456, 84.99, 7]] }
const place: Place = { id: 'kakao-1', name: '검증1단지아파트', address: '서울 종로구 검증로 10', roadAddress: '서울 종로구 검증로 10',
  lotAddress: '서울 종로구 검증동 5-1', lat: 37.5, lng: 127, url: '' }
const catalog = (apartments: SaleApartment[]) => createCatalog({ version: 1, district: '11110', apartments }, '11110', index)

test('만원 단위 금액을 반올림 없이 억·만원으로 표시한다', () => {
  assert.equal(formatAmount(123456), '12억 3,456만 원')
  assert.equal(formatAmount(100000), '10억 원')
  assert.equal(formatAmount(7500), '7,500만 원')
})

test('시도 표기와 괄호를 정리하되 단지 차수와 건물 번호를 유지한다', () => {
  assert.equal(normalizeAddress('경기도 성남시 분당구 판교로 10-2 (삼평동)'), '경기 성남시 분당구 판교로 10-2')
  assert.equal(normalizeName('검증(1단지) 아파트'), normalizeName('검증1단지아파트'))
  assert.notEqual(normalizeName('검증1단지'), normalizeName('검증2단지'))
})

test('정확한 도로명·지번 주소로 연결하며 동명 단지의 다른 주소는 연결하지 않는다', () => {
  assert.equal(matchSale(place, [catalog([apartment])], index).status, 'matched')
  assert.equal(matchSale({ ...place, address: '서울 종로구 다른로 10', roadAddress: undefined, lotAddress: undefined }, [catalog([apartment])], index).status, 'unmatched')
  assert.equal(matchSale({ ...place, address: '서울 중구 검증로 10', roadAddress: undefined, lotAddress: undefined }, [catalog([apartment])], index).status, 'unmatched')
})

test('같은 주소의 여러 단지와 서로 충돌하는 두 주소를 보수적으로 처리한다', () => {
  const second = { ...apartment, id: '11110-2', names: ['검증2단지'] }
  const data = catalog([apartment, second])
  const matched = matchSale(place, [data], index)
  assert.equal(matched.status, 'matched')
  if (matched.status === 'matched') assert.equal(matched.apartment.id, '11110-1')
  assert.equal(matchSale({ ...place, name: '알수없는아파트' }, [data], index).status, 'ambiguous')
  const conflicting = catalog([apartment, { ...second, lotAddresses: ['서울 종로구 검증동 9'], roadAddresses: ['서울 종로구 다른로 9'] }])
  assert.equal(matchSale({ ...place, lotAddress: '서울 종로구 검증동 9' }, [conflicting], index).status, 'ambiguous')
})

test('중복 지역 파일의 같은 단지는 최신 날짜를 택하고 같은 날 거래를 합친다', () => {
  const newer = { ...apartment, date: '2026-10-21', transactions: [[120000, 84.99, 3]] as SaleApartment['transactions'] }
  const result = matchSale(place, [catalog([apartment]), catalog([newer])], index)
  assert.equal(result.status, 'matched')
  if (result.status === 'matched') assert.equal(result.apartment.date, '2026-10-21')
  const sameDate = { ...apartment, transactions: [[130000, 105.1, 10]] as SaleApartment['transactions'] }
  const multi = matchSale(place, [catalog([apartment]), catalog([sameDate])], index)
  assert.equal(multi.status, 'matched')
  if (multi.status === 'matched') assert.equal(multi.apartment.transactions.length, 2)
})

test('경로 탈출 파일·잘못된 금액·수집일 이후 거래를 표시하지 않는다', () => {
  assert.throws(() => validateSalesIndex({ ...manifest, districts: [{ ...manifest.districts[0], asset: '../key.json' }] }))
  assert.throws(() => catalog([{ ...apartment, date: '2026-11-10' }]))
  assert.throws(() => catalog([{ ...apartment, transactions: [[0, 84, 1]] }]))
  assert.throws(() => catalog([{ ...apartment, transactions: [[10000, NaN, 1]] }]))
})

test('동시에 여러 카드를 읽어도 지역 파일을 한 번만 받고 가격 실패를 별도로 처리한다', async () => {
  const original = globalThis.fetch, calls: string[] = []
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url)
    return url.endsWith('index.json') ? Response.json(manifest) : new Response(gzipSync(JSON.stringify({ version: 1, district: '11110', apartments: [apartment] })))
  }
  try {
    const load = createSalesLoader(new URL('https://example.org/galmanzip/data/sales/'))
    const results = await Promise.all([load(place), load(place), load(place)])
    assert.ok(results.every(result => result.status === 'matched'))
    assert.equal(calls.length, 2)
    assert.ok(calls.every(url => url.startsWith('https://example.org/galmanzip/data/sales/')))
    globalThis.fetch = async () => new Response('검증용 실패', { status: 503 })
    const retry = createSalesLoader(new URL('https://example.org/galmanzip/data/sales/'))
    assert.equal((await retry(place)).status, 'unavailable')
    globalThis.fetch = async input => String(input).endsWith('index.json') ? Response.json(manifest)
      : Response.json({ version: 1, district: '11110', apartments: [apartment] })
    assert.equal((await retry(place, true)).status, 'matched')
  } finally { globalThis.fetch = original }
})
