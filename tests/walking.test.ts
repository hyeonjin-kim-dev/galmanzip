import assert from 'node:assert/strict'
import test from 'node:test'
import { routeWalking, validateWalkingTile } from '../src/search/walking.ts'
import type { WalkingTile } from '../src/search/walking.ts'
import { createWalkingLoader, walkingTileKeys } from '../src/search/walkingLoader.ts'
import type { ApartmentResult, RouteGeometry } from '../src/search/types.ts'

const point = (lat: number, lng: number) => ({ lat, lng })
const a = point(37.4, 127.1), bend = point(37.401, 127.1), b = point(37.401, 127.101)
const tile = (points = [a, bend, b], edges = [[1, 2, 0], [2, 3, 0]]): WalkingTile => ({ version: 1,
  nodes: points.map((p, i) => [i + 1, Math.round(p.lat * 1e7), Math.round(p.lng * 1e7)]), edges: edges as WalkingTile['edges'] })

test('보행 경로는 직선 대신 원본의 꺾인 길을 따라간다', () => {
  const result = routeWalking([tile()], a, b)
  assert.equal(result.status, 'matched')
  if (result.status !== 'matched') return
  assert.deepEqual(result.points, [a, bend, b])
  assert.ok(result.metres > 190 && result.metres < 205)
  assert.deepEqual(result.offsets, [0, 0])
})

test('도로 중간으로 연결하되 출입구까지 미확인 직선을 덧붙이지 않는다', () => {
  const from = point(37.4003, 127.0999), to = point(37.4011, 127.1007)
  const result = routeWalking([tile()], from, to)
  assert.equal(result.status, 'matched')
  if (result.status !== 'matched') return
  assert.equal(result.points[0].lng, 127.1)
  assert.equal(result.points.at(-1)!.lat, 37.401)
  assert.ok(result.offsets.every(value => value > 8))
  assert.deepEqual(result.points[1], bend)
})

test('같은 도로 위 두 지점은 보행 일방통행 방향을 지킨다', () => {
  const data = tile([a, b], [[1, 2, 1]])
  const start = point(37.4002, 127.1002), end = point(37.4008, 127.1008)
  assert.equal(routeWalking([data], start, end).status, 'matched')
  assert.notEqual(routeWalking([data], end, start).status, 'matched')
  assert.equal(routeWalking([tile([a, b], [[1, 2, -1]])], end, start).status, 'matched')
})

test('교차 좌표가 같아도 노드가 다르면 입체 교차를 연결하지 않는다', () => {
  const other = point(37.402, 127.1)
  assert.notEqual(routeWalking([tile([a, bend, bend, other], [[1, 2, 0], [3, 4, 0]])], a, other).status, 'matched')
})

test('보행망이 없거나 너무 먼 연결은 그리지 않는다', () => {
  assert.equal(routeWalking([], a, b).status, 'unavailable')
  assert.equal(routeWalking([tile()], point(37.398, 127.1), point(37.398, 127.101)).status, 'unavailable')
  const detour = tile([a, point(37.4025, 127.1), point(37.4025, 127.102), point(37.4, 127.102)], [[1, 2, 0], [2, 3, 0], [3, 4, 0]])
  assert.equal(routeWalking([detour], a, point(37.4, 127.102)).status, 'too-far')
})

test('5분 경계 바로 아래는 포함하고 바로 위는 제외한다', () => {
  const inside = point(37.4032375, 127.1), outside = point(37.4032376, 127.1)
  assert.equal(routeWalking([tile([a, inside], [[1, 2, 0]])], a, inside).status, 'matched')
  assert.equal(routeWalking([tile([a, outside], [[1, 2, 0]])], a, outside).status, 'too-far')
})

test('타일 경계의 중복 연결은 같은 노드로 이어지고 거리도 중복하지 않는다', () => {
  const first = tile([a, bend], [[1, 2, 0]])
  const second: WalkingTile = { version: 1, nodes: [[2, 374010000, 1271000000], [3, 374010000, 1271010000]], edges: [[2, 3, 0]] }
  assert.deepEqual(routeWalking([first, second, first], a, b), routeWalking([tile()], a, b))
})

test('누락 노드·방향·좌표 오류를 거절한다', () => {
  assert.deepEqual(validateWalkingTile(tile()), tile())
  assert.throws(() => validateWalkingTile(tile([a, b], [[1, 9, 0]])))
  assert.throws(() => validateWalkingTile(tile([a, b], [[1, 2, 4]])))
  assert.throws(() => validateWalkingTile(tile([point(0, 0), b])))
})

test('선택 구간 주변 파일만 읽고 같은 자료는 재사용하며 미확인 직선을 제거한다', async () => {
  const original = globalThis.fetch, calls: string[] = []
  const keys = walkingTileKeys(a, b, .02), asset = 'walk-123456abcdef.json.gz'
  globalThis.fetch = async input => {
    const url = String(input); calls.push(url)
    return Response.json(url.endsWith('index.json')
      ? { version: 1, cell: .02, tiles: Object.fromEntries([...keys.map(key => [key, asset]), ['1900-6400', 'walk-abcdef123456.json.gz']]), source: { timestamp: '2026-11-02T21:21:26Z' } }
      : tile())
  }
  try {
    const loader = createWalkingLoader('https://example.org/galmanzip/data/transit.json')
    const apartment = { legs: [{ mode: 'walk' }, { mode: 'bus' }] } as ApartmentResult
    const geometry: RouteGeometry = { segments: [{ legIndex: 0, points: [a, b] }, { legIndex: 1, points: [b, a] }], busLines: [], roadBusLines: [], sources: [] }
    const result = await loader(geometry, apartment)
    assert.deepEqual(result.segments[0].points, [a, bend, b])
    assert.deepEqual(result.walking?.matched, [0])
    assert.equal(result.walking?.date, '2026-11-02')
    await loader(geometry, apartment)
    assert.equal(calls.length, 2)
    assert.ok(calls.every(url => !url.includes('walk-abcdef123456')))
    const missing = await loader({ ...geometry, segments: [{ legIndex: 0, points: [point(37.398, 127.1), point(37.398, 127.101)] }, geometry.segments[1]] }, apartment)
    assert.equal(missing.segments.length, 1)
    assert.equal(missing.segments[0].legIndex, 1)
    assert.equal(missing.walking?.missing[0].reason, 'unavailable')
  } finally { globalThis.fetch = original }
})

test('보행 파일 다운로드 실패도 기존 대중교통 경로를 유지하고 재시도한다', async () => {
  const original = globalThis.fetch
  let fail = true
  globalThis.fetch = async input => {
    if (fail) throw new Error('검증용 통신 실패')
    return Response.json(String(input).endsWith('index.json')
      ? { version: 1, cell: .02, tiles: Object.fromEntries(walkingTileKeys(a, b, .02).map(key => [key, 'walk-123456abcdef.json.gz'])), source: { timestamp: '2026-11-02' } }
      : tile())
  }
  try {
    const loader = createWalkingLoader('https://example.org/data/transit.json')
    const apartment = { legs: [{ mode: 'walk' }] } as ApartmentResult
    const geometry: RouteGeometry = { segments: [{ legIndex: 0, points: [a, b] }], busLines: [], roadBusLines: [], sources: [] }
    const missing = await loader(geometry, apartment)
    assert.equal(missing.segments.length, 0)
    assert.equal(missing.walking?.missing.length, 1)
    fail = false
    assert.equal((await loader(geometry, apartment)).walking?.matched.length, 1)
  } finally { globalThis.fetch = original }
})
