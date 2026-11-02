import { ACCESS_RADIUS, DESTINATION_RADIUS } from './routing.ts'
import type { Point, ReachabilitySummary } from './types.ts'
import { intersects } from './bounds.ts'
import type { Bounds } from './bounds.ts'

export type { Bounds } from './bounds.ts'
interface Coverage extends Bounds { priority: number }
export interface SearchZone extends Bounds { coverage: Coverage[]; depth: number; priority: number }

function circle(point: Point, radius: number, priority: number): Coverage {
  const angle = Math.max(1, radius) / 6371000
  const lat = angle * 180 / Math.PI
  const lng = Math.asin(Math.min(1, Math.sin(angle) / Math.cos(point.lat * Math.PI / 180))) * 180 / Math.PI
  return { south: point.lat - lat, north: point.lat + lat, west: point.lng - lng, east: point.lng + lng, priority }
}

function zone(bounds: Bounds, coverage: Coverage[], depth: number): SearchZone {
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity, priority = Infinity
  for (const area of coverage) {
    south = Math.min(south, area.south); north = Math.max(north, area.north)
    west = Math.min(west, area.west); east = Math.max(east, area.east)
    priority = Math.min(priority, area.priority)
  }
  return { south: Math.max(bounds.south, south), north: Math.min(bounds.north, north),
    west: Math.max(bounds.west, west), east: Math.min(bounds.east, east), coverage, depth, priority }
}

export function searchZones(stops: ReachabilitySummary['stops'], destination: Point, maxMinutes: number): SearchZone[] {
  const grid = 0.08
  const coverage = new Map<string, Coverage>()
  for (const stop of stops) {
    // 남은 시간으로 실제 접근할 수 있는 범위만 조회한다. 환승 경로의 더 넓은 범위도 보존한다.
    const radius = Math.min(ACCESS_RADIUS, Math.max(0, maxMinutes * 60 - stop.seconds) * 1.2 / 1.3)
    const priority = Number(stop.boardings > 1) * 100000 + stop.seconds
    const area = circle(stop, radius, priority)
    const previous = coverage.get(stop.id)
    if (!previous) coverage.set(stop.id, area)
    else coverage.set(stop.id, { south: Math.min(previous.south, area.south), north: Math.max(previous.north, area.north),
      west: Math.min(previous.west, area.west), east: Math.max(previous.east, area.east), priority: Math.min(previous.priority, priority) })
  }
  const areas = [circle(destination, Math.min(DESTINATION_RADIUS, maxMinutes * 60 * 1.2 / 1.3), 0), ...coverage.values()]
  const roots = new Map<string, { bounds: Bounds; coverage: Coverage[] }>()
  for (const area of areas) {
    for (let y = Math.floor(area.south / grid); y <= Math.floor(area.north / grid); y++) {
      for (let x = Math.floor(area.west / grid); x <= Math.floor(area.east / grid); x++) {
        const key = `${y},${x}`
        const root = roots.get(key) ?? { bounds: { south: y * grid, north: (y + 1) * grid, west: x * grid, east: (x + 1) * grid }, coverage: [] }
        root.coverage.push(area)
        roots.set(key, root)
      }
    }
  }
  return [...roots.values()].map(root => zone(root.bounds, root.coverage, 0)).sort((a, b) => a.priority - b.priority)
}

export function splitZone(parent: SearchZone): SearchZone[] {
  // 같은 좌표에서는 분할해도 건수가 줄지 않으므로 세분화에 하한을 둔다.
  if (parent.depth >= 8 || Math.max(parent.north - parent.south, parent.east - parent.west) <= 0.0005) return []
  const lat = (parent.south + parent.north) / 2, lng = (parent.west + parent.east) / 2
  return [
    { south: parent.south, north: lat, west: parent.west, east: lng },
    { south: parent.south, north: lat, west: lng, east: parent.east },
    { south: lat, north: parent.north, west: parent.west, east: lng },
    { south: lat, north: parent.north, west: lng, east: parent.east },
  ].flatMap(bounds => {
    const coverage = parent.coverage.filter(area => intersects(bounds, area))
    return coverage.length ? [zone(bounds, coverage, parent.depth + 1)] : []
  }).sort((a, b) => a.priority - b.priority)
}

// 지도 안쪽을 먼저 조회해도 바깥쪽 후보 영역은 빠뜨리지 않는다.
export function partitionZone(parent: SearchZone, view: Bounds): { inside?: SearchZone; outside: SearchZone[] } {
  if (!intersects(parent, view)) return { outside: [parent] }
  const inside = { south: Math.max(parent.south, view.south), north: Math.min(parent.north, view.north),
    west: Math.max(parent.west, view.west), east: Math.min(parent.east, view.east) }
  const clip = (bounds: Bounds) => {
    const coverage = parent.coverage.filter(area => intersects(bounds, area))
    return bounds.south < bounds.north && bounds.west < bounds.east && coverage.length ? [zone(bounds, coverage, parent.depth)] : []
  }
  return { inside: clip(inside)[0], outside: [
    { ...parent, north: inside.south }, { ...parent, south: inside.north },
    { ...inside, west: parent.west, east: inside.west }, { ...inside, west: inside.east, east: parent.east },
  ].flatMap(clip) }
}

export function nextZoneIndex(zones: SearchZone[], view: Bounds | null, destination: Point): number {
  const center = view ? { lat: (view.south + view.north) / 2, lng: (view.west + view.east) / 2 } : destination
  let best = -1, score = Infinity
  zones.forEach((area, index) => {
    const lat = (area.south + area.north) / 2, lng = (area.west + area.east) / 2
    const candidate = (view && intersects(area, view) ? 0 : 1000)
      + (lat - center.lat) ** 2 + (lng - center.lng) ** 2 + area.priority * 1e-12
    if (candidate < score) { best = index; score = candidate }
  })
  return best
}
