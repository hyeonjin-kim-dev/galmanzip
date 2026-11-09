import { distance, MAX_WALK_SECONDS } from './routing.ts'
import type { Point } from './types.ts'

export interface WalkingTile { version: 1; nodes: [number, number, number][]; edges: [number, number, number][] }
export type WalkingPath = { status: 'matched'; points: Point[]; metres: number; offsets: [number, number] }
  | { status: 'unavailable' | 'disconnected' | 'too-far' }
const MAX_METRES = MAX_WALK_SECONDS * 1.2
const MAX_SNAP_METRES = 60

export function validateWalkingTile(value: unknown): WalkingTile {
  const tile = value as WalkingTile | undefined
  if (!tile || tile.version !== 1 || !Array.isArray(tile.nodes) || !Array.isArray(tile.edges)
    || tile.nodes.length > 100000 || tile.edges.length > 150000) throw new Error('보행망 자료 형식이 올바르지 않습니다.')
  const ids = new Set<number>()
  for (const node of tile.nodes) {
    if (!Array.isArray(node) || node.length !== 3 || !node.every(Number.isSafeInteger) || node[0] <= 0 || ids.has(node[0])
      || node[1] < 36e7 || node[1] > 39e7 || node[2] < 125e7 || node[2] > 129e7) throw new Error('보행망 좌표를 확인하지 못했습니다.')
    ids.add(node[0])
  }
  for (const edge of tile.edges) if (!Array.isArray(edge) || edge.length !== 3 || !ids.has(edge[0]) || !ids.has(edge[1])
    || edge[0] === edge[1] || ![-1, 0, 1].includes(edge[2])) throw new Error('보행망 연결을 확인하지 못했습니다.')
  return tile
}

type Edge = { a: number; b: number; directions: number }
type Snap = { edge: Edge; t: number; point: Point; offset: number }
type Neighbor = { id: number; metres: number }

function project(point: Point, a: Point, b: Point) {
  const scale = Math.cos(point.lat * Math.PI / 180)
  const x = (b.lng - a.lng) * scale, y = b.lat - a.lat
  const t = Math.max(0, Math.min(1, ((point.lng - a.lng) * scale * x + (point.lat - a.lat) * y) / (x * x + y * y || 1)))
  const projected = { lat: a.lat + t * y, lng: a.lng + t * (b.lng - a.lng) }
  return { t, point: projected, offset: distance(point, projected) }
}

// 좌표가 가까운 교차로나 입체 도로를 임의로 연결하지 않고 원본 노드 식별자를 따른다.
export function routeWalking(tiles: WalkingTile[], from: Point, to: Point): WalkingPath {
  if (distance(from, to) > MAX_METRES) return { status: 'too-far' }
  const nodes = new Map<number, Point>(), edges = new Map<string, Edge>()
  for (const tile of tiles) {
    for (const [id, lat, lng] of tile.nodes) nodes.set(id, { lat: lat / 1e7, lng: lng / 1e7 })
    for (const [start, end, direction] of tile.edges) {
      const a = Math.min(start, end), b = Math.max(start, end), key = `${a}:${b}`
      const forward = start === a ? direction : -direction
      const flags = forward === 0 ? 3 : forward > 0 ? 1 : 2
      const edge = edges.get(key)
      if (edge) edge.directions |= flags
      else edges.set(key, { a, b, directions: flags })
    }
  }
  const nearest = (point: Point) => {
    let best: Snap | undefined
    for (const edge of edges.values()) {
      const snap = project(point, nodes.get(edge.a)!, nodes.get(edge.b)!)
      if (snap.offset <= MAX_SNAP_METRES && (!best || snap.offset < best.offset)) best = { edge, ...snap }
    }
    return best
  }
  // 최대 도보 거리 밖의 지역은 탐색에 참여할 수 없으므로 큰 타일에서도 가까운 연결만 남긴다.
  const latitude = MAX_METRES / 110000, longitude = latitude / Math.cos(from.lat * Math.PI / 180)
  for (const [key, edge] of edges) {
    const a = nodes.get(edge.a)!, b = nodes.get(edge.b)!
    if (Math.max(a.lat, b.lat) < from.lat - latitude || Math.min(a.lat, b.lat) > from.lat + latitude
      || Math.max(a.lng, b.lng) < from.lng - longitude || Math.min(a.lng, b.lng) > from.lng + longitude) edges.delete(key)
  }
  const start = nearest(from), end = nearest(to)
  if (!start || !end) return { status: 'unavailable' }
  const limit = MAX_METRES - start.offset - end.offset
  if (limit <= 0) return { status: 'too-far' }
  const graph = new Map<number, Neighbor[]>()
  const connect = (a: number, b: number, metres: number) => {
    const neighbors = graph.get(a)
    if (neighbors) neighbors.push({ id: b, metres })
    else graph.set(a, [{ id: b, metres }])
  }
  nodes.set(-1, start.point); nodes.set(-2, end.point)
  for (const edge of edges.values()) {
    const split = [{ id: edge.a, t: 0 }, { id: edge.b, t: 1 }]
    if (edge === start.edge) split.push({ id: -1, t: start.t })
    if (edge === end.edge) split.push({ id: -2, t: end.t })
    split.sort((a, b) => a.t - b.t)
    for (let i = 1; i < split.length; i++) {
      const a = split[i - 1].id, b = split[i].id, metres = distance(nodes.get(a)!, nodes.get(b)!)
      if ((edge.directions & 1) || metres < .001) connect(a, b, metres)
      if ((edge.directions & 2) || metres < .001) connect(b, a, metres)
    }
  }
  const costs = new Map<number, number>([[-1, 0]]), previous = new Map<number, number>()
  const heap: { id: number; cost: number; score: number }[] = []
  const push = (id: number, cost: number) => {
    const item = { id, cost, score: cost + distance(nodes.get(id)!, end.point) }
    let i = heap.length
    heap.push(item)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (heap[parent].score <= item.score) break
      heap[i] = heap[parent]; i = parent
    }
    heap[i] = item
  }
  const pop = () => {
    const first = heap[0], last = heap.pop()!
    if (heap.length) {
      let i = 0
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1
        if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++
        if (heap[child].score >= last.score) break
        heap[i] = heap[child]; i = child
      }
      heap[i] = last
    }
    return first
  }
  push(-1, 0)
  let limited = false
  while (heap.length) {
    const current = pop()
    if (current.cost !== costs.get(current.id)) continue
    if (current.id === -2) {
      const points: Point[] = []
      for (let id: number | undefined = -2; id !== undefined; id = previous.get(id)) points.push(nodes.get(id)!)
      points.reverse()
      return { status: 'matched', points: points.filter((p, i) => !i || distance(p, points[i - 1]) > .001),
        metres: current.cost, offsets: [start.offset, end.offset] }
    }
    for (const next of graph.get(current.id) ?? []) {
      const cost = current.cost + next.metres
      if (cost > limit + .001) { limited = true; continue }
      if (cost < (costs.get(next.id) ?? Infinity)) {
        costs.set(next.id, cost); previous.set(next.id, current.id); push(next.id, cost)
      }
    }
  }
  return { status: limited ? 'too-far' : 'disconnected' }
}
