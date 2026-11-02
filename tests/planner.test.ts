import test from 'node:test'
import assert from 'node:assert/strict'
import { createSearchPlanner } from '../src/search/planner.ts'
import { contains } from '../src/search/bounds.ts'
import type { ReachabilitySummary } from '../src/search/types.ts'

const destination = { lat: 37.4, lng: 127.16 }
const bounds = { south: 37.3, north: 37.6, west: 127, east: 127.4 }
const graph: ReachabilitySummary = { stops: [
  { id: 'A', lat: 37.4, lng: 127.1, seconds: 600, boardings: 1 },
  { id: 'B', lat: 37.5, lng: 127.3, seconds: 600, boardings: 1 },
], source: { name: '검증용', url: 'https://example.org', date: '2025-03-04', license: '검증용' }, coverage: '검증용' }
const empty = { count: 0, total: 0, more: false }

test('서로 다른 구역의 응답 순서가 바뀌어도 미완료 영역과 결과 수집을 보존한다', () => {
  const planner = createSearchPlanner(graph, destination, 30, null)
  const first = planner.next(null)!, second = planner.next(null)!
  assert.notEqual(first.id, second.id)
  planner.accept(second.id, empty)
  assert.ok(planner.progress().pendingAreas.some(area => JSON.stringify(area) === JSON.stringify(first.bounds)))
  let task
  while ((task = planner.next(null))) planner.accept(task.id, empty)
  assert.equal(planner.progress().pendingAreas.length, 1)
  assert.ok(planner.progress().completed < planner.progress().total)
  planner.accept(first.id, empty)
  assert.equal(planner.progress().pendingAreas.length, 0)
  assert.equal(planner.progress().completed, planner.progress().total)
  assert.throws(() => planner.accept(first.id, empty), /이미 처리/)
})

test('조회 중 지도 이동은 이미 보낸 요청과 별개로 다음 구역의 우선순위를 바꾼다', () => {
  const initial = { south: 37.39, north: 37.41, west: 127.15, east: 127.17 }
  const planner = createSearchPlanner(graph, destination, 30, initial)
  assert.ok(planner.initialArea)
  const moved = { south: 37.49, north: 37.51, west: 127.29, east: 127.31 }
  const next = planner.next(moved)!
  assert.ok(contains(next.bounds, graph.stops[1]))
  assert.ok(planner.progress().pendingAreas.some(area => contains(area, destination)))
})

test('같은 영역의 다음 페이지는 이전 응답 후에만 예약하며 완료를 중복 집계하지 않는다', () => {
  const planner = createSearchPlanner(graph, destination, 30, bounds)
  const first = planner.initialArea!
  assert.equal(planner.next(bounds), undefined)
  planner.accept(first.id, { count: 15, total: 20, more: true })
  const second = planner.next(bounds)!
  assert.equal(second.page, 2)
  assert.deepEqual(second.bounds, first.bounds)
  assert.equal(planner.progress().completed, 0)
  planner.accept(second.id, { count: 5, total: 20, more: false })
  assert.deepEqual(planner.progress(), { completed: 1, total: 1, limited: false, pendingAreas: [] })
})

test('노출 한도로 나눈 영역도 도달 가능한 정류장과 목적지를 빠뜨리지 않는다', () => {
  const planner = createSearchPlanner(graph, destination, 30, bounds)
  planner.accept(planner.initialArea!.id, { count: 15, total: 45, more: true })
  for (const point of [...graph.stops, destination]) {
    assert.ok(planner.progress().pendingAreas.some(area => contains(area, point)))
  }
  const areas = []
  let area
  while ((area = planner.next(bounds))) areas.push(area)
  assert.ok(areas.length > 1)
  // 화면으로 복제하는 응답에는 대량의 정류장·분할 근거·상세 경로를 넣지 않는다.
  assert.doesNotMatch(JSON.stringify({ areas, progress: planner.progress() }), /"(?:coverage|stops|legs)":/)
  for (const area of areas.reverse()) planner.accept(area.id, empty)
  assert.equal(planner.progress().completed, planner.progress().total)
})
