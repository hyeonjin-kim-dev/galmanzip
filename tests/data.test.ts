import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { decodeNetwork, loadNetwork } from '../src/search/data.ts'
import { findReachableStops } from '../src/search/routing.ts'

const root = new URL('../public/data/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('transit.json', root), 'utf8'))
const packed = readFileSync(new URL(manifest.asset, root))
const bytes = (value: Uint8Array) => Uint8Array.from(value).buffer

test('배포한 실제 자료의 내용 해시와 검증 보고서가 일치한다', async () => {
  const payload = gunzipSync(packed)
  assert.equal(manifest.asset, `transit-${createHash('sha256').update(payload).digest('hex').slice(0, 12)}.json.gz`)
  const network = await decodeNetwork(bytes(packed))
  const audit = JSON.parse(readFileSync(new URL('transit-audit.json', root), 'utf8'))
  assert.equal(network.stops.length, audit.outputStops)
  assert.equal(network.lines.length, audit.outputPatterns)
  assert.equal(network.transfers.length, audit.outputTransfers)
  assert.equal(audit.missingTrips, 0)
  assert.deepEqual(audit.invalidTrips, {})
  assert.equal(network.source.date, '2025년 3월 평일 하루')
})

test('실제 서현역에서 강남역까지 정자 환승의 방향과 지정 시간이 보존된다', async () => {
  const network = await decodeNetwork(bytes(packed))
  const rail = { ...network, lines: network.lines.filter(line => line.mode === 'rail') }
  const result = findReachableStops(rail, { lat: 37.498103, lng: 127.028079 }, 90)
  const seohyeon = result.stops.find(stop => stop.id === 'RS_ACC1_S-1-1855')!
  assert.ok(seohyeon)
  assert.equal(seohyeon.boardings, 2)
  assert.deepEqual(seohyeon.legs.filter(leg => leg.mode === 'rail').map(leg => [leg.from, leg.to]), [
    ['서현', '정자(수인분당선)'], ['정자(신분당선)', '강남(신분당선)'],
  ])
  assert.equal(seohyeon.legs.find(leg => leg.from === '정자(수인분당선)' && leg.mode === 'walk')?.seconds, 120)
  for (const stop of result.stops) {
    assert.equal(stop.legs.reduce((total, leg) => total + leg.seconds, 0), stop.seconds)
    assert.ok(Number.isFinite(stop.seconds) && stop.seconds <= 90 * 60)
  }
})

test('서버가 이미 압축을 해제했거나 자료가 손상된 응답을 구분한다', async () => {
  const plain = gunzipSync(packed)
  assert.equal((await decodeNetwork(bytes(plain))).status, 'ready')
  await assert.rejects(decodeNetwork(bytes(packed.subarray(0, 40))), /압축 또는 JSON 형식/)
  await assert.rejects(decodeNetwork(bytes(new TextEncoder().encode('<html>오류</html>'))), /JSON 형식/)
})

test('배포 정보의 상대 주소를 해석하고 잘못된 주소와 통신 오류를 차단한다', async t => {
  const calls: string[] = []
  const fetch = t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    calls.push(String(url))
    return calls.length === 1 ? Response.json(manifest) : new Response(bytes(packed))
  })
  await loadNetwork('https://example.org/galmanzip/data/transit.json')
  assert.deepEqual(calls, ['https://example.org/galmanzip/data/transit.json', `https://example.org/galmanzip/data/${manifest.asset}`])
  fetch.mock.mockImplementation(async () => Response.json({ ...manifest, asset: '../다른-자료.json' }))
  await assert.rejects(loadNetwork('https://example.org/data/transit.json'), /배포 정보/)
  fetch.mock.mockImplementation(async () => new Response('오류', { status: 503 }))
  await assert.rejects(loadNetwork('https://example.org/data/transit.json'), /불러오지 못했습니다/)
  fetch.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch') })
  await assert.rejects(loadNetwork('https://example.org/data/transit.json'), /인터넷 연결/)
})

test('압축 해제 후에도 미준비 자료를 정상 검색 자료로 취급하지 않는다', async () => {
  await assert.rejects(decodeNetwork(bytes(gzipSync(JSON.stringify({ version: 1, status: 'pending' })))), /아직 준비되지 않아/)
})
