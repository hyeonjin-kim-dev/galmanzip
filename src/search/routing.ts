import type { ApartmentResult, Place, Point, Reachability, ReachableStop, RouteLeg, TransitNetwork } from './types.ts'

export const ACCESS_RADIUS = 600
export const DESTINATION_RADIUS = 1000
export const TRANSFER_RADIUS = 250

export function searchZones(stops: Point[]): (Point & { radius: number })[] {
  const grid = 0.01
  const zones = new Map<string, Point & { radius: number }>()
  for (const stop of stops) {
    const y = Math.floor(stop.lat / grid), x = Math.floor(stop.lng / grid)
    const key = `${y},${x}`
    const zone = zones.get(key) ?? { lat: (y + 0.5) * grid, lng: (x + 0.5) * grid, radius: 0 }
    // 한 격자에 속한 모든 정류장의 접근 반경을 포함해 중복 API 호출을 줄인다.
    zone.radius = Math.max(zone.radius, Math.ceil(distance(zone, stop) + ACCESS_RADIUS))
    zones.set(key, zone)
  }
  return [...zones.values()]
}

export function indexStops(stops: ReachableStop[]) {
  const grid = 0.01
  const cells = new Map<string, ReachableStop[]>()
  for (const stop of stops) {
    const key = `${Math.floor(stop.lat / grid)},${Math.floor(stop.lng / grid)}`
    const cell = cells.get(key) ?? []
    cell.push(stop)
    cells.set(key, cell)
  }
  return (point: Point) => {
    const lat = ACCESS_RADIUS / 110000, lng = lat / Math.cos(point.lat * Math.PI / 180)
    const nearby: ReachableStop[] = []
    for (let y = Math.floor((point.lat - lat) / grid); y <= Math.floor((point.lat + lat) / grid); y++) {
      for (let x = Math.floor((point.lng - lng) / grid); x <= Math.floor((point.lng + lng) / grid); x++) {
        nearby.push(...(cells.get(`${y},${x}`) ?? []))
      }
    }
    return nearby
  }
}

export function distance(a: Point, b: Point): number {
  const radians = Math.PI / 180
  const lat = (b.lat - a.lat) * radians
  const lng = (b.lng - a.lng) * radians
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(lng / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// 도로망이 없는 구간의 보행 추정치이며 실제 도보 경로를 보장하지 않는다.
export function walkingSeconds(metres: number): number {
  return Math.ceil(metres * 1.3 / 1.2)
}

interface Edge { from: number; to: number; seconds: number; boardings: number; leg?: RouteLeg }
type QueueItem = { node: number; seconds: number; boardings: number }
const precedes = (a: QueueItem, b: QueueItem) => a.seconds < b.seconds || (a.seconds === b.seconds && a.boardings < b.boardings)

class Queue {
  items: QueueItem[] = []
  push(item: QueueItem) {
    const items = this.items
    let index = items.length
    items.push(item)
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (!precedes(item, items[parent])) break
      items[index] = items[parent]
      index = parent
    }
    items[index] = item
  }
  pop(): QueueItem | undefined {
    const items = this.items
    const result = items[0]
    const tail = items.pop()
    if (!items.length || !tail) return result
    let index = 0
    while (index * 2 + 1 < items.length) {
      let child = index * 2 + 1
      if (child + 1 < items.length && precedes(items[child + 1], items[child])) child++
      if (!precedes(items[child], tail)) break
      items[index] = items[child]
      index = child
    }
    items[index] = tail
    return result
  }
}

export function validateNetwork(value: unknown): TransitNetwork {
  if (!value || typeof value !== 'object') throw new Error('교통 자료 형식이 올바르지 않습니다.')
  const data = value as TransitNetwork
  if (data.status !== 'ready') throw new Error('교통 자료가 아직 준비되지 않아 경로 검색을 시작할 수 없습니다.')
  if (data.version !== 1 || !Array.isArray(data.stops) || !Array.isArray(data.lines) || !Array.isArray(data.transfers)
    || !data.source?.name || !data.source.date || !data.source.license || !/^https:\/\//.test(data.source.url) || !data.coverage
    || !data.stops.length || !data.lines.length) throw new Error('교통 자료의 필수 항목이 누락되었습니다.')
  const ids = new Set<string>()
  for (const stop of data.stops) {
    if (!stop.id || !stop.name || ids.has(stop.id) || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)
      || Math.abs(stop.lat) > 90 || Math.abs(stop.lng) > 180) throw new Error('정류장 자료가 올바르지 않습니다.')
    ids.add(stop.id)
  }
  const lines = new Set<string>()
  for (const line of data.lines) {
    if (!line.id || !line.name || lines.has(line.id) || !['bus', 'rail'].includes(line.mode)
      || !Array.isArray(line.stops) || line.stops.length < 2 || !line.stops.every(id => ids.has(id))
      || !Array.isArray(line.seconds) || line.seconds.length !== line.stops.length - 1
      || line.seconds.some(time => !Number.isFinite(time) || time <= 0)
      || !Number.isFinite(line.waitSeconds) || line.waitSeconds < 0
      || [line.pickup, line.dropoff].some(values => values !== undefined && (!Array.isArray(values)
        || values.length !== line.stops.length || values.some(value => typeof value !== 'boolean')))) throw new Error('노선 자료가 올바르지 않습니다.')
    lines.add(line.id)
  }
  for (const transfer of data.transfers) {
    // 같은 정류장의 노선별 환승 제약은 공용 승하차 노드로 표현할 수 없다.
    if (transfer.from === transfer.to && transfer.seconds > 0) throw new Error('동일 정류장 환승 제약을 표현할 수 있도록 교통 자료를 보완해야 합니다.')
    if (!ids.has(transfer.from) || !ids.has(transfer.to) || !Number.isFinite(transfer.seconds) || transfer.seconds < 0) {
      throw new Error('환승 자료가 올바르지 않습니다.')
    }
  }
  return data
}

export function findReachableStops(network: TransitNetwork, destination: Point, maxMinutes: number): Reachability {
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 180) throw new Error('소요시간을 확인해 주세요.')
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng) || Math.abs(destination.lat) > 90 || Math.abs(destination.lng) > 180) {
    throw new Error('목적지 좌표를 확인해 주세요.')
  }
  const stops = network.stops
  const indices = new Map(stops.map((stop, index) => [stop.id, index]))
  const reverse: Edge[][] = stops.map(() => [])
  const add = (edge: Edge) => reverse[edge.to].push(edge)
  for (const line of network.lines) {
    const offset = reverse.length
    line.stops.forEach(() => reverse.push([]))
    line.stops.forEach((id, index) => {
      const stopIndex = indices.get(id)!
      const name = stops[stopIndex].name
      if (line.pickup?.[index] !== false) add({ from: stopIndex, to: offset + index, seconds: line.waitSeconds, boardings: 1,
        leg: { mode: 'wait', from: name, to: name, seconds: line.waitSeconds, line: line.name, lineId: line.id } })
      if (line.dropoff?.[index] !== false) add({ from: offset + index, to: stopIndex, seconds: 0, boardings: 0 })
      if (index + 1 < line.stops.length) {
        add({ from: offset + index, to: offset + index + 1, seconds: line.seconds[index], boardings: 0,
          leg: { mode: line.mode, from: name, to: stops[indices.get(line.stops[index + 1])!].name,
            seconds: line.seconds[index], line: line.name, lineId: line.id } })
      }
    })
  }
  const specified = new Map(network.transfers.map(transfer => [`${transfer.from}\0${transfer.to}`, transfer.seconds]))
  for (const transfer of network.transfers) {
    add({ from: indices.get(transfer.from)!, to: indices.get(transfer.to)!, seconds: transfer.seconds, boardings: 0,
      leg: { mode: 'walk', from: stops[indices.get(transfer.from)!].name, to: stops[indices.get(transfer.to)!].name, seconds: transfer.seconds } })
  }
  // 작은 격자로 이웃 정류장만 비교해 전체 정류장 쌍의 비교를 피한다.
  const cells = new Map<string, number[]>()
  stops.forEach((stop, index) => {
    const key = `${Math.floor(stop.lat / 0.005)},${Math.floor(stop.lng / 0.005)}`
    cells.set(key, [...(cells.get(key) ?? []), index])
  })
  stops.forEach((stop, from) => {
    const y = Math.floor(stop.lat / 0.005), x = Math.floor(stop.lng / 0.005)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const to of cells.get(`${y + dy},${x + dx}`) ?? []) {
        if (to === from || specified.has(`${stop.id}\0${stops[to].id}`)) continue
        const metres = distance(stop, stops[to])
        if (metres <= TRANSFER_RADIUS) {
          const seconds = walkingSeconds(metres)
          add({ from, to, seconds, boardings: 0, leg: { mode: 'walk', from: stop.name, to: stops[to].name, seconds } })
        }
      }
    }
  })
  const seconds = new Float64Array(reverse.length).fill(Infinity)
  const boards = new Float64Array(reverse.length).fill(Infinity)
  const next: (Edge | undefined)[] = new Array(reverse.length)
  const tails = new Map<number, RouteLeg>()
  const queue = new Queue()
  stops.forEach((stop, index) => {
    const metres = distance(stop, destination)
    if (metres > DESTINATION_RADIUS) return
    const time = walkingSeconds(metres)
    seconds[index] = time
    boards[index] = 0
    tails.set(index, { mode: 'walk', from: stop.name, to: '목적지', seconds: time })
    queue.push({ node: index, seconds: time, boardings: 0 })
  })
  let current: QueueItem | undefined
  while ((current = queue.pop())) {
    if (current.seconds !== seconds[current.node] || current.boardings !== boards[current.node]) continue
    if (current.seconds > maxMinutes * 60) continue
    for (const edge of reverse[current.node]) {
      const time = current.seconds + edge.seconds, boardings = current.boardings + edge.boardings
      if (time > maxMinutes * 60 || time > seconds[edge.from] || (time === seconds[edge.from] && boardings >= boards[edge.from])) continue
      seconds[edge.from] = time
      boards[edge.from] = boardings
      next[edge.from] = edge
      queue.push({ node: edge.from, seconds: time, boardings })
    }
  }
  const reachable: ReachableStop[] = []
  stops.forEach((stop, index) => {
    if (seconds[index] > maxMinutes * 60) return
    const legs: RouteLeg[] = []
    let node = index
    while (next[node]) {
      const edge = next[node]!
      if (edge.leg) {
        const previous = legs.at(-1)
        if (previous && ['bus', 'rail'].includes(edge.leg.mode) && previous.lineId === edge.leg.lineId && previous.mode === edge.leg.mode) {
          previous.to = edge.leg.to
          previous.seconds += edge.leg.seconds
        } else legs.push({ ...edge.leg })
      }
      node = edge.to
    }
    if (tails.has(node)) legs.push(tails.get(node)!)
    reachable.push({ ...stop, seconds: seconds[index], boardings: boards[index], legs })
  })
  return { stops: reachable.sort((a, b) => a.seconds - b.seconds || a.boardings - b.boardings), source: network.source, coverage: network.coverage }
}

export function rankApartment(place: Place, destination: Place, stops: ReachableStop[], maxMinutes: number): ApartmentResult | null {
  let best: ApartmentResult | null = null
  const direct = distance(place, destination)
  if (direct <= DESTINATION_RADIUS && walkingSeconds(direct) <= maxMinutes * 60) {
    best = { ...place, seconds: walkingSeconds(direct), transfers: 0, startStop: '도보 이동',
      legs: [{ mode: 'walk', from: place.name, to: destination.name, seconds: walkingSeconds(direct) }] }
  }
  for (const stop of stops) {
    const metres = distance(place, stop)
    if (metres > ACCESS_RADIUS) continue
    const walk = walkingSeconds(metres), seconds = walk + stop.seconds, transfers = Math.max(0, stop.boardings - 1)
    if (seconds > maxMinutes * 60) continue
    if (best && (best.seconds < seconds || (best.seconds === seconds && best.transfers <= transfers))) continue
    best = { ...place, seconds, transfers, startStop: stop.name,
      legs: [{ mode: 'walk', from: place.name, to: stop.name, seconds: walk }, ...stop.legs] }
  }
  return best
}

export const sortApartments = (results: ApartmentResult[]) => results.sort((a, b) =>
  a.seconds - b.seconds || a.transfers - b.transfers || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
