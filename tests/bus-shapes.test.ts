import assert from 'node:assert/strict'
import test from 'node:test'
import { gzipSync } from 'node:zlib'
import { createBusShapeLoader, validateBusShape } from '../src/search/busShapes.ts'
import { createRouteGeometry } from '../src/search/geometry.ts'
import type { ApartmentResult, BusRoadShape, Place, TransitNetwork } from '../src/search/types.ts'

// 실제 자료와 분리해, 정류장 직선 사이에 도로 굴곡이 있는 노선을 검사한다.
const points = [{ lat: 37.4, lng: 127.1 }, { lat: 37.401, lng: 127.105 }, { lat: 37.4, lng: 127.12 },
  { lat: 37.402, lng: 127.13 }, { lat: 37.4, lng: 127.14 }]
const line = { id: '검증 버스', name: '102번', mode: 'bus' as const, stops: ['A', 'B', 'C'], seconds: [300, 300], waitSeconds: 120 }
const network: TransitNetwork = { version: 1, status: 'ready', lines: [line], transfers: [], coverage: '검증',
  source: { name: '검증', date: '검증', url: 'https://example.org', license: '검증' },
  stops: ['A', 'B', 'C'].map((id, index) => ({ id, name: id, ...points[index * 2] })) }
const destination: Place = { id: '도착', name: '목적지', address: '', url: '', ...points[4] }
const apartment: ApartmentResult = { id: '집', name: '검증 집', address: '', url: '', ...points[2], seconds: 300, transfers: 0, startStop: 'B',
  legs: [{ mode: 'bus', from: 'B', to: 'C', line: '102번', lineId: line.id, fromStopId: 'B', toStopId: 'C', fromIndex: 1, toIndex: 2, seconds: 300 }] }
const shape: BusRoadShape = { version: 1, lineId: line.id, stopIds: line.stops, stopIndexes: [0, 2, 4], points,
  source: { name: '검증용 GBIS 좌표', url: 'https://www.data.go.kr/data/15080662/openapi.do', date: '2026-11-02', license: '검증 전용' } }
const asset = 'shape-123456abcdef.json.gz'

test('탑승 구간과 연한 전체 노선은 동일한 도로 좌표를 잘라 사용한다', () => {
  const geometry = createRouteGeometry(network)(apartment, destination, new Map([[line.id, validateBusShape(shape, line, network)]]))
  assert.deepEqual(geometry.busLines[0].points, points)
  assert.deepEqual(geometry.segments[0].points, points.slice(2))
  assert.deepEqual(geometry.roadBusLines, [line.id])
  assert.deepEqual(geometry.sources, [shape.source])
})

test('다른 운행 순서·역방향·멀리 떨어진 정류장·잘못된 출처의 선형은 사용하지 않는다', () => {
  const values = [
    { ...shape, lineId: '다른 버스' }, { ...shape, stopIds: ['A', 'C', 'B'] },
    { ...shape, stopIndexes: [4, 2, 0] }, { ...shape, points: points.map(point => ({ ...point, lat: point.lat + .01 })) },
    { ...shape, source: { ...shape.source, url: 'https://example.org' } },
  ]
  for (const value of values) assert.throws(() => validateBusShape(value, line, network), /좌표|순서/)
})

test('선택한 버스의 좌표만 준비하고 재선택은 메모리에서 재사용한다', async t => {
  const calls: { url: string; options?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: URL, options?: RequestInit) => {
    calls.push({ url: String(url), options })
    return calls.length === 1 ? Response.json({ version: 1, patterns: { [line.id]: asset } })
      : new Response(Uint8Array.from(gzipSync(JSON.stringify(shape))).buffer)
  })
  const load = createBusShapeLoader(network, 'https://example.org/galmanzip/data/transit.json')
  assert.deepEqual(await load({ ...apartment, legs: [{ ...apartment.legs[0], mode: 'rail', lineId: '철도' }] }), new Map())
  assert.equal(calls.length, 0)
  assert.deepEqual((await load(apartment)).get(line.id), shape)
  assert.deepEqual((await load(apartment)).get(line.id), shape)
  assert.deepEqual(calls.map(call => call.url), ['https://example.org/galmanzip/data/bus-shapes/index.json', `https://example.org/galmanzip/data/bus-shapes/${asset}`])
  assert.equal(calls[0].options?.cache, 'no-cache')
})

test('좌표 준비 실패는 검색 결과를 지우거나 가상의 도로 굴곡을 만들지 않는다', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  const shapes = await createBusShapeLoader(network, 'https://example.org/data/transit.json')(apartment)
  const geometry = createRouteGeometry(network)(apartment, destination, shapes)
  assert.deepEqual(geometry.segments[0].points, [points[2], points[4]])
  assert.deepEqual(geometry.roadBusLines, [])
})

test('색인에 외부 URL이 있으면 호출하지 않는다', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ version: 1, patterns: { [line.id]: 'https://example.org/잘못된선형' } })
  })
  assert.equal((await createBusShapeLoader(network, 'https://example.org/data/transit.json')(apartment)).size, 0)
  assert.equal(calls, 1)
})
