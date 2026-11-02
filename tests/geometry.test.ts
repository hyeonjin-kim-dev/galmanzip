import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouteGeometry } from '../src/search/geometry.ts'
import { createRouter } from '../src/search/routing.ts'
import type { Place, TransitLine, TransitNetwork } from '../src/search/types.ts'

const stops = [
  { id: 'A', name: '같은 이름', lat: 37.4, lng: 127.1 },
  { id: 'B', name: '같은 이름', lat: 37.42, lng: 127.13 },
  { id: 'C', name: '도착역', lat: 37.4, lng: 127.16 },
  { id: 'D', name: '환승 승강장', lat: 37.4201, lng: 127.1301 },
]
const place = (index: number): Place => ({ ...stops[index], address: '', url: '' })
const line = (id: string, ids: string[], seconds: number[]): TransitLine => ({ id, name: id, mode: 'rail', stops: ids, seconds, waitSeconds: 120 })
const network = (lines = [line('완행', ['A', 'B', 'C'], [300, 300])]): TransitNetwork => ({ version: 1, status: 'ready', stops, lines,
  transfers: [], source: { name: '검증', url: 'https://example.org', date: '검증', license: '검증' }, coverage: '검증용 교통망' })
const points = (ids: string[]) => ids.map(id => { const stop = stops.find(stop => stop.id === id)!; return { lat: stop.lat, lng: stop.lng } })

test('출발·도착만 잇지 않고 이름이 같은 경유 정류장도 순서대로 보존한다', () => {
  const graph = network(), router = createRouter(graph)
  router(place(2), 30)
  const result = router.rank(place(0), place(2))!
  const before = structuredClone(result)
  const geometry = createRouteGeometry(graph)(result, place(2))
  assert.deepEqual(geometry.segments.map(segment => segment.points), [points(['A', 'B', 'C'])])
  assert.deepEqual(geometry.busLines, [])
  assert.equal(result.legs.find(leg => leg.mode === 'rail')!.toIndex! - result.legs.find(leg => leg.mode === 'rail')!.fromIndex!, 2)
  assert.deepEqual(result, before)
})

test('순환 노선의 같은 정류장 재등장에서는 선택한 승차 위치부터 그린다', () => {
  const graph = network([line('순환', ['A', 'B', 'A', 'C'], [100, 100, 300])]), router = createRouter(graph)
  router(place(2), 30)
  const result = router.rank(place(0), place(2))!
  const ride = result.legs.find(leg => leg.mode === 'rail')!
  assert.equal(ride.fromIndex, 2)
  assert.equal(ride.toIndex, 3)
  assert.deepEqual(createRouteGeometry(graph)(result, place(2)).segments[0].points, points(['A', 'C']))
})

test('환승 경로의 차량 구간과 승강장 간 도보를 따로 잇는다', () => {
  const graph = network([line('첫차', ['A', 'B'], [300]), line('둘째차', ['D', 'C'], [300])])
  graph.transfers = [{ from: 'B', to: 'D', seconds: 120 }]
  const router = createRouter(graph)
  router(place(2), 30)
  const result = router.rank(place(0), place(2))!
  assert.equal(result.transfers, 1)
  const geometry = createRouteGeometry(graph)(result, place(2))
  assert.deepEqual(geometry.segments.map(segment => result.legs[segment.legIndex].mode), ['rail', 'walk', 'rail'])
  assert.deepEqual(geometry.segments.map(segment => segment.points), [points(['A', 'B']), points(['B', 'D']), points(['D', 'C'])])
})

test('출발·도착 도보 좌표는 실제 아파트와 목적지까지 연결한다', () => {
  const graph = network(), router = createRouter(graph)
  const home = { ...place(0), lat: 37.4005 }, end = { ...place(2), lat: 37.4005 }
  router(end, 30)
  const result = router.rank(home, end)!
  const segments = createRouteGeometry(graph)(result, end).segments
  assert.deepEqual(segments[0].points[0], { lat: home.lat, lng: home.lng })
  assert.deepEqual(segments.at(-1)!.points.at(-1), { lat: end.lat, lng: end.lng })
})

test('도보 전용은 가상의 버스·지하철 구간 없이 표시한다', () => {
  const graph = network(), router = createRouter(graph)
  const home = { ...place(2), lat: 37.4005 }, end = place(2)
  router(end, 10)
  const result = router.rank(home, end)!
  const geometry = createRouteGeometry(graph)(result, end)
  assert.equal(geometry.segments.length, 1)
  assert.equal(result.legs[geometry.segments[0].legIndex].mode, 'walk')
  assert.deepEqual(geometry.busLines, [])
})

test('버스 전체 노선은 승하차 전후와 순환 정류장을 포함하고 같은 이름의 반대 방향과 구분한다', () => {
  const graph = network([
    { ...line('정방향', ['D', 'A', 'B', 'C', 'D'], [100, 300, 300, 100]), name: '32번', mode: 'bus' },
    { ...line('반대방향', ['D', 'C', 'B', 'A', 'D'], [100, 300, 300, 100]), name: '32번', mode: 'bus' },
  ]), router = createRouter(graph)
  router(place(2), 30)
  const result = router.rank(place(0), place(2))!
  const geometry = createRouteGeometry(graph)(result, place(2))
  const legIndex = result.legs.findIndex(leg => leg.mode === 'bus')
  assert.equal(result.legs[legIndex].lineId, '정방향')
  assert.deepEqual(geometry.segments.map(segment => segment.points), [points(['A', 'B', 'C'])])
  assert.deepEqual(geometry.busLines, [{ legIndex, points: points(['D', 'A', 'B', 'C', 'D']) }])
})

test('버스를 갈아타면 이용한 버스마다 전체 노선과 탑승 구간을 구분한다', () => {
  const graph = network([
    { ...line('첫 버스', ['A', 'B'], [300]), mode: 'bus' },
    { ...line('둘째 버스', ['D', 'C'], [300]), mode: 'bus' },
  ])
  graph.transfers = [{ from: 'B', to: 'D', seconds: 120 }]
  const router = createRouter(graph)
  router(place(2), 30)
  const result = router.rank(place(0), place(2))!
  assert.equal(result.transfers, 1)
  const geometry = createRouteGeometry(graph)(result, place(2))
  assert.deepEqual(geometry.busLines, [
    { legIndex: result.legs.findIndex(leg => leg.lineId === '첫 버스'), points: points(['A', 'B']) },
    { legIndex: result.legs.findIndex(leg => leg.lineId === '둘째 버스'), points: points(['D', 'C']) },
  ])
})

test('같은 버스 운행 패턴에 재승차해도 전체 노선을 겹쳐 그리지 않는다', () => {
  const graph = network([{ ...line('같은 버스', ['A', 'B', 'D', 'C'], [300, 1000, 300]), mode: 'bus' }])
  graph.transfers = [{ from: 'B', to: 'D', seconds: 120 }]
  const router = createRouter(graph)
  router(place(2), 15)
  const result = router.rank(place(0), place(2))!
  assert.equal(result.transfers, 1)
  assert.equal(result.legs.filter(leg => leg.mode === 'bus').length, 2)
  const geometry = createRouteGeometry(graph)(result, place(2))
  assert.deepEqual(geometry.busLines, [{ legIndex: result.legs.findIndex(leg => leg.mode === 'bus'), points: points(['A', 'B', 'D', 'C']) }])
})

test('달라진 운행 패턴을 이름이나 첫 정류장 일치만으로 추측해서 그리지 않는다', () => {
  const graph = network(), router = createRouter(graph)
  router(place(2), 30)
  const result = router.rank(place(0), place(2))!
  const ride = result.legs.find(leg => leg.mode === 'rail')!
  ride.fromIndex = 1
  assert.throws(() => createRouteGeometry(graph)(result, place(2)), /운행 순서/)
})
