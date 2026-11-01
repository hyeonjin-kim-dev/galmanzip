import assert from 'node:assert/strict'
import { test } from 'node:test'
import { distance, createRouter, findReachableStops, indexStops, rankApartment, sortApartments, validateNetwork, walkingSeconds } from '../src/search/routing.ts'
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

test('환승 경로가 더 빨라도 최대 시간 내 무환승 경로를 우선한다', () => {
  const graph = network([line('직행', ['A', 'C'], [700]), line('첫차', ['A', 'B'], [200]), line('둘째차', ['B', 'C'], [200])])
  const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
  assert.equal(result.seconds, 820)
  assert.equal(result.transfers, 0)
  assert.equal(result.legs.filter(leg => leg.mode === 'wait').length, 1)
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

test('최소 시간 경계는 포함하고 더 빠른 아파트에 우회 경로를 붙여 포함하지 않는다', () => {
  const reachable = findReachableStops(network(), destination, 30)
  assert.equal(rankApartment(apartment, destination, reachable.stops, 30, 12)?.seconds, 720)
  assert.equal(rankApartment(apartment, destination, reachable.stops, 30, 13), null)
  assert.equal(rankApartment(destination, destination, reachable.stops, 30, 10), null)
})

test('동일 역·순환 노선에서도 무한 순환 없이 경로를 복원한다', () => {
  const graph = network([line('순환', ['A', 'B', 'A', 'C'], [100, 100, 300], 0)])
  const result = findReachableStops(graph, destination, 30).stops.find(stop => stop.id === 'A')!
  assert.equal(result.seconds, 300)
  assert.equal(result.boardings, 1)
})

test('최종 목록은 환승 없음, 총시간, 환승 횟수 순으로 정렬한다', () => {
  const result = rankApartment(apartment, destination, findReachableStops(network(), destination, 30).stops, 30)!
  const sorted = sortApartments([{ ...result, id: 'b', seconds: 900, transfers: 0 }, { ...result, id: 'a', seconds: 720, transfers: 2 }, { ...result, id: 'c', seconds: 720, transfers: 1 }])
  assert.deepEqual(sorted.map(item => item.id), ['b', 'c', 'a'])
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

for (const mode of ['bus', 'rail'] as const) {
  test(`${mode} 무환승이 최단시간 경로보다 느려도 별도 탐색으로 찾아낸다`, () => {
    const direct = { ...line('무환승', ['A', 'B', 'C'], [500, 500]), mode, dwellSeconds: [0, 40, 0] }
    const graph = network([direct, line('빠른첫차', ['A', 'B'], [100]), line('빠른둘째차', ['B', 'C'], [100])])
    const found = findReachableStops(graph, destination, 30)
    assert.ok(found.stops.some(stop => stop.id === 'A' && stop.boardings === 2))
    const result = rankApartment(apartment, destination, indexStops(found.stops)(apartment), 30)!
    assert.equal(result.transfers, 0)
    assert.equal(result.seconds, 1160)
    assert.deepEqual(result.legs.filter(leg => leg.mode === 'bus' || leg.mode === 'rail').map(leg => leg.line), ['무환승'])
    assert.equal(result.legs.reduce((sum, leg) => sum + leg.seconds, 0), result.seconds)
  })
}

test('무환승이 최대 시간을 넘으면 시간 안에 도착하는 환승 경로를 사용한다', () => {
  const graph = network([line('늦은직행', ['A', 'C'], [1800]), line('첫차', ['A', 'B'], [200]), line('둘째차', ['B', 'C'], [200])])
  const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
  assert.equal(result.transfers, 1)
  assert.equal(result.seconds, 640)
})

test('이름이 같은 다른 운행 패턴을 붙여 무환승이라고 표시하지 않는다', () => {
  const graph = network([{ ...line('서로다른방향1', ['A', 'B'], [300]), name: '같은번호' },
    { ...line('서로다른방향2', ['B', 'C'], [300]), name: '같은번호' }])
  const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
  assert.equal(result.transfers, 1)
})

test('무환승 승차 또는 하차가 금지된 구간을 직통 경로로 만들지 않는다', () => {
  for (const field of ['pickup', 'dropoff'] as const) {
    const direct = line('이용불가직행', ['A', 'C'], [600])
    direct[field] = field === 'pickup' ? [false, true] : [true, false]
    const graph = network([direct, line('첫차', ['A', 'B'], [300]), line('둘째차', ['B', 'C'], [300])])
    const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
    assert.equal(result.transfers, 1)
  }
})

test('조금 더 걸어가는 정류장의 무환승도 가까운 정류장의 환승보다 우선한다', () => {
  const graph = network([line('가까운첫차', ['A', 'B'], [100]), line('가까운둘째차', ['B', 'C'], [100]), line('조금먼직행', ['E', 'C'], [900])])
  graph.stops = [...graph.stops, { id: 'E', name: '조금 먼 정류장', lat: 37.4015, lng: 127.1 }]
  const result = rankApartment(apartment, destination, findReachableStops(graph, destination, 30).stops, 30)!
  assert.equal(result.transfers, 0)
  assert.equal(result.startStop, '조금 먼 정류장')
})


test('준비한 교통망을 재사용해도 이전 목적지와 시간 조건이 다음 결과에 섞이지 않는다', () => {
  const graph = network([line('직행', ['A', 'C'], [700]), line('첫차', ['A', 'B'], [200]), line('둘째차', ['B', 'C'], [200])])
  const route = createRouter(graph)
  const first = route(destination, 30)
  assert.deepEqual(first, findReachableStops(graph, destination, 30))
  assert.deepEqual(route(stops[0], 10), findReachableStops(graph, stops[0], 10))
  assert.deepEqual(route(destination, 10), findReachableStops(graph, destination, 10))
  assert.deepEqual(route(destination, 30), first)
})


test('도보만 이동할 때 5분은 포함하고 5분을 넘으면 제외한다', () => {
  const near = { ...destination, lat: destination.lat + 0.00249 }
  assert.equal(walkingSeconds(distance(near, destination)), 300)
  assert.equal(rankApartment(near, destination, [], 30)?.seconds, 300)
  assert.equal(rankApartment({ ...near, lat: destination.lat + 0.0025 }, destination, [], 30), null)
})

test('출발 도보는 5분까지 포함하며 도착 도보와 합쳐 5분을 넘어도 허용한다', () => {
  const end = { ...destination, lat: destination.lat + 0.00149 }
  const home = { ...apartment, lat: apartment.lat + 0.00249 }
  const route = createRouter(network())
  route(end, 30)
  const result = route.rank(home, end)!
  assert.ok(result)
  assert.equal(result.legs[0].seconds, 300)
  assert.equal(result.legs.at(-1)?.seconds, 180)
  const beyond = { ...home, lat: apartment.lat + 0.002491 }
  assert.equal(walkingSeconds(distance(beyond, apartment)), 301)
  assert.equal(route.rank(beyond, end), null)
})

test('도착 도보는 정확히 5분까지 허용하고 5분 1초면 제외한다', () => {
  for (const [delta, expected] of [[0.00249, 300], [0.002491, 301]]) {
    const end = { ...destination, lat: destination.lat + delta }
    assert.equal(walkingSeconds(distance(destination, end)), expected)
    const route = createRouter(network())
    route(end, 30)
    assert.equal(Boolean(route.rank(apartment, end)), expected === 300)
  }
})

test('출발과 도착이 각각 약 3분이면 전체 도보 5분을 넘어도 무환승을 포함한다', () => {
  const end = { ...destination, lat: destination.lat + 0.0015 }
  const home = { ...apartment, lat: apartment.lat + 0.0015 }
  const route = createRouter(network())
  route(end, 30)
  const result = route.rank(home, end)!
  assert.ok(result)
  assert.equal(result.transfers, 0)
  assert.equal(result.legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0), 362)
})

test('각 구간이 5분 이하면 더 빠른 무환승의 하차 지점을 선택한다', () => {
  const graph = network([line('직통', ['A', 'E', 'C'], [300, 400])])
  graph.stops = [...stops, { id: 'E', name: '도착지에서 조금 먼 정류장', lat: 37.4015, lng: 127.16 }]
  const route = createRouter(graph)
  route(destination, 30)
  const home = { ...apartment, lat: apartment.lat + 0.0012 }
  const result = route.rank(home, destination)!
  assert.equal(result.transfers, 0)
  assert.equal(result.legs.find(leg => leg.mode === 'rail')?.to, '도착지에서 조금 먼 정류장')
  assert.ok(result.legs.filter(leg => leg.mode === 'walk').every(leg => leg.seconds <= 300))
  assert.ok(result.legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0) > 300)
})

function walkingAlternatives(extraOrigin = false) {
  const graph = network([line('빠른첫차', ['A', 'B'], [100]), line('빠른둘째차', ['E', 'F'], [100]),
    line('적게걷는첫차', ['A', 'D'], [300]), line('적게걷는둘째차', ['D', 'C'], [500])])
  graph.stops = [...stops, { id: 'E', name: '환승 승강장', lat: 37.4001, lng: 127.13 },
    { id: 'F', name: '도착지에서 먼 정류장', lat: 37.4015, lng: 127.16 }]
  graph.transfers = [{ from: 'B', to: 'E', seconds: 301 }]
  if (extraOrigin) {
    graph.stops.push({ id: 'G', name: '다른 출발 정류장', lat: 37.4005, lng: 127.1 })
    graph.lines.push(line('다른출발첫차', ['G', 'D'], [600]))
  }
  return graph
}

for (const extraOrigin of [false, true]) {
  test(`환승 도보 5분 초과 경로를 빼고 허용되는 대안을 고른다 (다른 출발 ${extraOrigin})`, () => {
    const route = createRouter(walkingAlternatives(extraOrigin))
    const found = route(destination, 30)
    assert.equal(rankApartment(apartment, destination, found.stops, 30)?.seconds, 1040)
    const result = route.rank(apartment, destination)!
    assert.equal(result.seconds, 1040)
    assert.equal(result.transfers, 1)
    assert.deepEqual(result.legs.filter(leg => leg.mode === 'rail').map(leg => leg.line), ['적게걷는첫차', '적게걷는둘째차'])
  })
}

test('환승 도보는 5분까지 허용하며 다른 도보와 합산해 제한하지 않는다', () => {
  const graph = walkingAlternatives()
  graph.transfers[0].seconds = 300
  const route = createRouter(graph)
  route(destination, 30)
  const result = route.rank(apartment, destination)!
  assert.equal(result.transfers, 1)
  assert.equal(result.seconds, 921)
  assert.equal(result.legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0), 481)
})

test('5분 초과로 지정된 버스 환승을 짧은 자동 도보 연결로 대체하지 않는다', () => {
  const graph = walkingAlternatives()
  graph.lines.forEach(line => { line.mode = 'bus' })
  const route = createRouter(graph)
  route(destination, 30)
  assert.equal(route.rank(apartment, destination)?.seconds, 1040)
})

test('여러 환승 구간이 각각 5분 이하면 전체 도보 5분을 넘어도 포함한다', () => {
  const graph = network([line('첫차', ['A', 'B'], [100]), line('둘째차', ['E', 'D'], [100]), line('셋째차', ['F', 'C'], [100])])
  graph.stops = [...stops, { id: 'E', name: '첫 환승 승강장', lat: 37.4001, lng: 127.13 },
    { id: 'F', name: '둘째 환승 승강장', lat: 37.4501, lng: 127.1 }]
  graph.transfers = [{ from: 'B', to: 'E', seconds: 180 }, { from: 'D', to: 'F', seconds: 180 }]
  const route = createRouter(graph)
  route(destination, 30)
  const result = route.rank(apartment, destination)!
  assert.ok(result)
  assert.equal(result.transfers, 2)
  assert.equal(result.legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0), 360)
})

test('도보만 이어지는 이동을 정류장에서 나눠 5분 제한을 우회하지 않는다', () => {
  const graph = network()
  graph.stops = [...stops, { id: 'E', name: '도보 중간 정류장', lat: 37.402, lng: 127.16 }]
  const route = createRouter(graph)
  route(destination, 30)
  assert.equal(route.rank({ ...apartment, lat: 37.404, lng: 127.16 }, destination), null)
})

test('출발 정류장에서 목적지로 걸을 수 있어도 실제 탑승 대안을 지우지 않는다', () => {
  const graph = network([line('첫차', ['E', 'D'], [300]), line('둘째차', ['D', 'C'], [300])])
  graph.stops = [...stops, { id: 'E', name: '목적지 근처 출발 정류장', lat: 37.402, lng: 127.16 }]
  const route = createRouter(graph)
  const found = route(destination, 30)
  assert.ok(found.stops.some(stop => stop.id === 'E' && stop.boardings === 2))
  const result = route.rank({ ...apartment, lat: 37.404, lng: 127.16 }, destination)!
  assert.ok(result)
  assert.equal(result.transfers, 1)
  assert.equal(result.legs[0].seconds, 241)
})
