import test from 'node:test'
import assert from 'node:assert/strict'
import { ACCESS_RADIUS, DESTINATION_RADIUS } from '../src/search/routing.ts'
import { searchZones, splitZone } from '../src/search/zones.ts'
import type { Bounds } from '../src/search/zones.ts'
import type { Point, ReachableStop } from '../src/search/types.ts'

const contains = (bounds: Bounds, point: Point) => point.lat >= bounds.south && point.lat <= bounds.north
  && point.lng >= bounds.west && point.lng <= bounds.east
const stop = (id: string, lat: number, lng: number, seconds = 100, boardings = 1): ReachableStop =>
  ({ id, name: id, lat, lng, seconds, boardings, legs: [] })
const destination = { lat: 37.5, lng: 127.2 }

function offset(point: Point, metres: number, bearing: number): Point {
  const angle = metres / 6371000, direction = bearing * Math.PI / 180
  const lat = point.lat * Math.PI / 180, lng = point.lng * Math.PI / 180
  const endLat = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(direction))
  return { lat: endLat * 180 / Math.PI, lng: (lng + Math.atan2(Math.sin(direction) * Math.sin(angle) * Math.cos(lat),
    Math.cos(angle) - Math.sin(lat) * Math.sin(endLat))) * 180 / Math.PI }
}

test('큰 조회 영역과 분할 영역이 격자 경계의 접근·하차 후 도보를 빠뜨리지 않는다', () => {
  const stops = [stop('A', 37.43999, 127.11999), stop('B', 37.44001, 127.12001), stop('C', 37.36, 127.04)]
  const roots = searchZones(stops, destination, 30)
  const children = roots.flatMap(root => splitZone(root))
  for (const [point, metres] of [...stops.map(point => [point, ACCESS_RADIUS - 0.1] as const), [destination, DESTINATION_RADIUS - 0.1] as const]) {
    for (let bearing = 0; bearing < 360; bearing += 5) {
      const candidate = offset(point, metres, bearing)
      assert.ok(roots.some(root => contains(root, candidate)), `최초 영역: ${bearing}`)
      assert.ok(children.some(child => contains(child, candidate)), `분할 영역: ${bearing}`)
    }
  }
})

test('남은 시간으로 접근할 수 없는 곳을 넓게 조회하지 않는다', () => {
  const origin = stop('A', 37.4, 127.1, 1790)
  const zones = searchZones([origin], destination, 30)
  assert.ok(zones.some(zone => contains(zone, offset(origin, 5, 0))))
  assert.equal(zones.some(zone => contains(zone, offset(origin, 100, 0))), false)
})

test('같은 정류장의 느린 무환승과 빠른 환승을 합쳐도 시간 내 접근 가능한 범위를 보존한다', () => {
  const direct = stop('A', 37.4, 127.1, 1790, 1)
  const transfer = { ...direct, seconds: 500, boardings: 2 }
  for (const values of [[direct, transfer], [transfer, direct]]) {
    const zones = searchZones(values, destination, 30)
    assert.ok(zones.some(zone => contains(zone, offset(direct, ACCESS_RADIUS - 1, 90))))
  }
})

test('같은 좌표의 많은 결과도 영역 분할이 무한히 이어지지 않는다', () => {
  const point = { lat: 37.4, lng: 127.1 }
  const pending = searchZones([stop('A', point.lat, point.lng)], point, 30)
  let count = 0, leaves = 0
  while (pending.length) {
    const parent = pending.pop()!
    const children = splitZone(parent)
    assert.ok(count++ < 1000)
    for (const child of children) {
      assert.ok(child.south >= parent.south && child.north <= parent.north)
      assert.ok(child.west >= parent.west && child.east <= parent.east)
      assert.ok(child.south <= child.north && child.west <= child.east)
    }
    if (!children.length) leaves++
    pending.push(...children.filter(child => contains(child, point)))
  }
  assert.ok(leaves > 0)
})
