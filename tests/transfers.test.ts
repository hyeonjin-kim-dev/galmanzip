import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouter } from '../src/search/routing.ts'
import type { Place, TransitLine, TransitNetwork } from '../src/search/types.ts'

const stops = Array.from('ABCDEF', (id, index) => ({ id, name: id, lat: 37.4, lng: 127.1 + index * .02 }))
const place = (index: number): Place => ({ ...stops[index], address: '', url: '' })
const destination = place(4)
const line = (id: string, from: string, to: string, seconds: number): TransitLine =>
  ({ id, name: id, mode: 'rail', stops: [from, to], seconds: [seconds], waitSeconds: 0 })
const chain = [line('첫차', 'A', 'B', 100), line('둘째차', 'B', 'C', 100),
  line('셋째차', 'C', 'D', 100), line('넷째차', 'D', 'E', 100), line('범위밖', 'F', 'A', 100)]
const network = (lines = chain): TransitNetwork => ({ version: 1, status: 'ready', stops, lines, transfers: [],
  source: { name: '환승 검증용', date: '2025-03-04', url: 'https://example.org', license: '검증 전용' }, coverage: '검증용' })

test('환승 0~3회 상한의 경계와 네 번 탑승을 환승 세 번으로 계산한다', () => {
  const route = createRouter(network())
  for (const maxTransfers of [0, 1, 2, 3]) {
    const reachable = route(destination, 30, maxTransfers)
    assert.ok(reachable.stops.every(stop => stop.boardings <= maxTransfers + 1))
    for (let index = 0; index < 4; index++) {
      const result = route.rank(place(index), destination)
      if (3 - index > maxTransfers) assert.equal(result, null)
      else {
        assert.equal(result?.transfers, 3 - index)
        assert.equal(result?.legs.filter(leg => leg.mode !== 'walk').length, 4 - index)
        assert.equal(result?.seconds, (4 - index) * 100)
      }
    }
    assert.equal(route.rank(place(5), destination), null)
  }
})

test('빠른 경로의 환승이 제한을 넘으면 같은 정류장에서 출발하는 느린 대안을 복원한다', () => {
  const route = createRouter(network([...chain, line('환승 적은 대안', 'B', 'E', 800)]))
  for (const [limit, seconds, transfers] of [[3, 400, 3], [1, 900, 1], [2, 900, 1], [0, 0, 0], [3, 400, 3]]) {
    route(destination, 30, limit)
    const result = route.rank(place(0), destination)
    if (!limit) assert.equal(result, null)
    else {
      assert.equal(result?.seconds, seconds)
      assert.equal(result?.transfers, transfers)
      assert.equal(result?.legs.reduce((sum, leg) => sum + leg.seconds, 0), seconds)
    }
  }
})

test('환승 제한을 충족하는 대안도 시간 상한을 넘으면 제외하고 무환승 우선을 유지한다', () => {
  const route = createRouter(network([...chain, line('환승 적은 대안', 'B', 'E', 800), line('직통', 'A', 'E', 1200)]))
  route(destination, 30, 3)
  assert.equal(route.rank(place(0), destination)?.transfers, 0)
  route(destination, 10, 3)
  assert.equal(route.rank(place(0), destination)?.transfers, 3)
  route(destination, 10, 1)
  assert.equal(route.rank(place(0), destination), null)
  route(destination, 30, 0)
  assert.equal(route.rank(place(0), destination)?.seconds, 1200)
})

test('허용 범위 밖 환승 설정은 오류로 알리고 도보 전용은 환승 없이 포함한다', () => {
  const route = createRouter(network())
  for (const invalid of [-1, .5, 4, Infinity, NaN]) assert.throws(() => route(destination, 30, invalid), /환승 횟수/)
  route(destination, 10, 0)
  assert.equal(route.rank({ ...destination, lat: destination.lat + .001 }, destination)?.transfers, 0)
})
