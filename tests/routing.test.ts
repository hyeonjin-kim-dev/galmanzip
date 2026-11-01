import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACCESS_RADIUS, distance, findReachableStops, indexStops, rankApartment, searchZones, sortApartments, validateNetwork, walkingSeconds } from '../src/search/routing.ts'
import type { Place, TransitLine, TransitNetwork } from '../src/search/types.ts'

// 실제 서비스 자료와 분리된, 방향·환승·시간 경계를 검증하기 위한 작은 교통망이다.
const stops = [
  { id: 'A', name: '출발역', lat: 37.4, lng: 127.1 },
  { id: 'B', name: '환승역', lat: 37.4, lng: 127.13 },
  { id: 'C', name: '목적지역', lat: 37.4, lng: 127.16 },
  { id: 'D', name: '멀리 있는 역', lat: 37.45, lng: 127.1 },
]
const destination: Place = { ...stops[2], name: '목적지', address: '경기 성남시', url: '' }
const apartment: Place = { ...stops[0], id: 'home', name: '검증용 아파트', address: '경기 성남시', url: '' }
const line = (id: string, stationIds: string[], seconds: number[], waitSeconds = 120): TransitLine =>
  ({ id, name: id, mode: 'rail', stops: stationIds, seconds, waitSeconds })
const network = (lines = [line('완행', ['A', 'B', 'C'], [300, 300])]): TransitNetwork => ({
  version: 1, status: 'ready', source: { name: '검증용 자료', url: 'https://example.org', date: '2025-03-04', license: '검증 전용' },
  coverage: '검증용 범위', stops, lines, transfers: [],
})

test('집에서 목적지 방향으로만 탐색하고 대기와 탑승 시간을 합산한다', () => {
  const forward = findReachableStops(network(), destination, 30)
  const origin = forward.stops.find(stop => stop.id === 'A')!
  assert.equal(origin.seconds, 720)
  assert.equal(origin.boardings, 1)
  assert.deepEqual(origin.legs.filter(leg => leg.mode === 'rail').map(leg => [leg.from, leg.to, leg.seconds]), [['출발역', '목적지역', 600]])
  const reverse = findReachableStops(network(), stops[0], 30)
  assert.equal(reverse.stops.some(stop => stop.id === 'C'), false)
})

test('출발지 접근 도보와 목적지 하차 후 도보도 제한 시간에 포함한다', () => {
  const end = { ...destination, lat: destination.lat + 0.001 }
  const home = { ...apartment, lat: apartment.lat + 0.001 }
  const reachable = findReachableStops(network(), end, 30)
  const result = rankApartment(home, end, reachable.stops, 30)!
  assert.equal(result.seconds, 720 + walkingSeconds(distance(home, stops[0])) + walkingSeconds(distance(stops[2], end)))
  assert.equal(result.transfers, 0)
  assert.equal(result.legs[0].from, home.name)
})

test('같은 총시간이면 환승이 적은 경로를 고른다', () => {
  const graph = network([line('직행', ['A', 'C'], [600], 120), line('첫차', ['A', 'B'], [240], 120), line('둘째차', ['B', 'C'], [240], 120)])
  const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
  assert.equal(result.seconds, 720)
  assert.equal(result.transfers, 0)
  assert.equal(result.legs.some(leg => leg.line === '직행'), true)
})

test('환승이 많아도 총시간이 더 짧은 경로가 우선한다', () => {
  const graph = network([line('직행', ['A', 'C'], [700]), line('첫차', ['A', 'B'], [200]), line('둘째차', ['B', 'C'], [200])])
  const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
  assert.equal(result.seconds, 640)
  assert.equal(result.transfers, 1)
  assert.equal(result.legs.filter(leg => leg.mode === 'wait').length, 2)
})

test('최대 시간과 정확히 같은 결과만 포함하고 10분을 임의로 더하지 않는다', () => {
  const graph = network([line('직행', ['A', 'C'], [1680])])
  const reachable = findReachableStops(graph, destination, 30)
  assert.equal(rankApartment(apartment, destination, reachable.stops, 30)?.seconds, 1800)
  assert.equal(rankApartment({ ...apartment, lat: apartment.lat + 0.0001 }, destination, reachable.stops, 30), null)
  assert.equal(findReachableStops(network([line('직행', ['A', 'C'], [1681])]), destination, 30).stops.some(stop => stop.id === 'A'), false)
})

test('승차 불가·하차 불가 정류장에서 이용할 수 없는 경로를 만들지 않는다', () => {
  const noPickup = line('무정차', ['A', 'B', 'C'], [300, 300])
  noPickup.pickup = [false, true, true]
  assert.equal(findReachableStops(network([noPickup]), destination, 30).stops.some(stop => stop.id === 'A'), false)
  const noDropoff = line('무정차', ['A', 'B', 'C'], [300, 300])
  noDropoff.dropoff = [true, true, false]
  assert.equal(findReachableStops(network([noDropoff]), destination, 30).stops.some(stop => stop.id === 'A'), false)
})

test('동일 역·순환 노선에서도 무한 순환 없이 경로를 복원한다', () => {
  const graph = network([line('순환', ['A', 'B', 'A', 'C'], [100, 100, 300], 0)])
  const result = findReachableStops(graph, destination, 30).stops.find(stop => stop.id === 'A')!
  assert.equal(result.seconds, 300)
  assert.equal(result.boardings, 1)
})

test('최종 목록은 총시간, 환승 횟수 순으로 정렬한다', () => {
  const result = rankApartment(apartment, destination, findReachableStops(network(), destination, 30).stops, 30)!
  const sorted = sortApartments([{ ...result, id: 'b', seconds: 900, transfers: 0 }, { ...result, id: 'a', seconds: 720, transfers: 2 }, { ...result, id: 'c', seconds: 720, transfers: 1 }])
  assert.deepEqual(sorted.map(item => item.id), ['c', 'a', 'b'])
})

test('합친 검색 구역도 각 정류장의 아파트 접근 반경을 모두 포함한다', () => {
  const nearby = [...stops, { ...stops[0], lat: 37.405, lng: 127.105 }]
  const zones = searchZones(nearby)
  assert.ok(zones.length < nearby.length)
  for (const stop of nearby) assert.ok(zones.some(zone => distance(zone, stop) + ACCESS_RADIUS <= zone.radius))
})

test('공간 색인 경계에서도 접근 가능한 정류장을 빠뜨리지 않는다', () => {
  const reachable = findReachableStops(network(), destination, 30).stops
  const home = { ...apartment, lng: 127.0999 }
  const indexed = rankApartment(home, destination, indexStops(reachable)(home), 30)
  assert.deepEqual(indexed, rankApartment(home, destination, reachable, 30))
})

test('자료 준비 전·유효하지 않은 노선·검색 조건을 오류로 구분한다', () => {
  assert.throws(() => validateNetwork({ version: 1, status: 'pending' }), /아직 준비되지/)
  assert.throws(() => validateNetwork(network([line('오류', ['A', 'C'], [-10])])), /노선 자료/)
  assert.throws(() => validateNetwork(network([line('오류', ['A', '없는역'], [100])])), /노선 자료/)
  assert.throws(() => findReachableStops(network(), destination, 181), /소요시간/)
  assert.throws(() => findReachableStops(network(), { lat: NaN, lng: 127 }, 30), /좌표/)
})

test('중간 정류장의 정차 시간을 포함하고 승차·하차 지점의 정차는 중복하지 않는다', () => {
  const service = line('정차', ['A', 'B', 'C'], [300, 300])
  service.dwellSeconds = [50, 45, 60]
  const result = findReachableStops(network([service]), destination, 30).stops.find(stop => stop.id === 'A')!
  assert.equal(result.seconds, 765)
  assert.equal(result.legs.reduce((sum, leg) => sum + leg.seconds, 0), 765)
})

test('같은 정류장에서 차를 바꾸는 경우에도 최소 환승 시간을 지킨다', () => {
  const graph = network([line('첫차', ['A', 'B'], [300]), line('둘째차', ['B', 'C'], [300])])
  graph.transfers = [{ from: 'B', to: 'B', seconds: 180 }]
  validateNetwork(graph)
  const result = findReachableStops(graph, destination, 30).stops.find(stop => stop.id === 'A')!
  assert.equal(result.seconds, 1020)
  assert.equal(result.boardings, 2)
})

test('주변 정류장을 연쇄 도보로 연결해 지정된 철도 환승 시간을 우회하지 않는다', () => {
  const graph = network([line('첫차', ['A', 'B'], [300]), line('둘째차', ['E', 'C'], [300])])
  graph.stops = [...stops, { id: 'E', name: '환승역 다른 승강장', lat: 37.4001, lng: 127.13 },
    { id: 'F', name: '역 앞 버스 정류장', lat: 37.40005, lng: 127.13 }]
  graph.transfers = [{ from: 'B', to: 'E', seconds: 300 }]
  const result = findReachableStops(graph, destination, 30).stops.find(stop => stop.id === 'A')!
  assert.equal(result.seconds, 1140)
  assert.equal(result.boardings, 2)
})
