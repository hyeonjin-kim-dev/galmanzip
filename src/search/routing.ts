import type { ApartmentResult, Place, Point, Reachability, ReachableStop, RouteLeg, TransitNetwork } from './types.ts'
import { Edges } from './edges.ts'

export const MAX_WALK_SECONDS = 300
export const ACCESS_RADIUS = MAX_WALK_SECONDS * 1.2 / 1.3
export const DESTINATION_RADIUS = ACCESS_RADIUS
export const TRANSFER_RADIUS = 250

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

// 차량을 타기 전까지 이어지는 도보를 한 구간으로 검사한다. 대기는 도보 구간을 나누지 않는다.
function walkingFits(legs: RouteLeg[], initialSeconds = 0): boolean {
  let seconds = initialSeconds
  if (seconds > MAX_WALK_SECONDS) return false
  for (const leg of legs) {
    if (leg.mode === 'walk') {
      seconds += leg.seconds
      if (seconds > MAX_WALK_SECONDS) return false
    } else if (leg.mode === 'bus' || leg.mode === 'rail') seconds = 0
  }
  return true
}

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
      || (line.dwellSeconds !== undefined && (!Array.isArray(line.dwellSeconds) || line.dwellSeconds.length !== line.stops.length
        || line.dwellSeconds.some(time => !Number.isFinite(time) || time < 0)))
      || [line.pickup, line.dropoff].some(values => values !== undefined && (!Array.isArray(values)
        || values.length !== line.stops.length || values.some(value => typeof value !== 'boolean')))) throw new Error('노선 자료가 올바르지 않습니다.')
    lines.add(line.id)
  }
  for (const transfer of data.transfers) {
    if (!ids.has(transfer.from) || !ids.has(transfer.to) || !Number.isFinite(transfer.seconds) || transfer.seconds < 0) {
      throw new Error('환승 자료가 올바르지 않습니다.')
    }
  }
  return data
}

// 목적지와 무관한 교통망 연결은 한 번 준비하고 탐색 배열만 초기화한다.
export function createRouter(network: TransitNetwork) {
  const stops = network.stops
  const indices = new Map(stops.map((stop, index) => [stop.id, index]))
  const n = stops.length
  const positions = network.lines.reduce((sum, line) => sum + line.stops.length, 0)
  const nodes = n * 2 + positions * 2
  const edges = new Edges(nodes, positions * 4 + n * 8)
  const WALK = 0, WAIT = 1, RIDE = 2, ALIGHT = 3, DWELL = 4
  const nodeStop = new Int32Array(nodes)
  const nodeLine = new Int32Array(nodes).fill(-1)
  const railStops = new Set<number>()
  const lineOffsets: number[] = []
  let offset = n * 2
  stops.forEach((_, index) => { nodeStop[index] = index; nodeStop[n + index] = index })
  network.lines.forEach((line, lineIndex) => {
    lineOffsets.push(offset)
    line.stops.forEach((id, index) => {
      const stopIndex = indices.get(id)!
      const arrival = offset + index * 2, departure = arrival + 1
      nodeStop[arrival] = nodeStop[departure] = stopIndex
      nodeLine[arrival] = nodeLine[departure] = lineIndex
      if (line.mode === 'rail') railStops.add(stopIndex)
      if (line.dropoff?.[index] !== false) edges.add(arrival, n + stopIndex, 0, ALIGHT)
      if (index + 1 < line.stops.length) {
        if (line.pickup?.[index] !== false) edges.add(stopIndex, departure, line.waitSeconds, WAIT)
        edges.add(arrival, departure, line.dwellSeconds?.[index] ?? 0, DWELL)
        edges.add(departure, arrival + 2, line.seconds[index], RIDE)
      }
    })
    offset += line.stops.length * 2
  })
  const specified = new Map(network.transfers.map(transfer => [`${transfer.from}\0${transfer.to}`, transfer.seconds]))
  for (const transfer of network.transfers) {
    // 5분 초과 환승을 빼도 원본 지정은 남겨 가까운 정류장 간 자동 도보로 우회하지 못하게 한다.
    if (transfer.seconds <= MAX_WALK_SECONDS) edges.add(n + indices.get(transfer.from)!, indices.get(transfer.to)!, transfer.seconds, WALK)
  }
  for (let index = 0; index < n; index++) {
    if (!specified.has(`${stops[index].id}\0${stops[index].id}`)) edges.add(n + index, index, 0, WALK)
  }
  // 작은 격자로 이웃 정류장만 비교해 전체 정류장 쌍의 비교를 피한다.
  const cells = new Map<string, number[]>()
  stops.forEach((stop, index) => {
    const key = `${Math.floor(stop.lat / 0.005)},${Math.floor(stop.lng / 0.005)}`
    const cell = cells.get(key) ?? []
    cell.push(index)
    cells.set(key, cell)
  })
  stops.forEach((stop, from) => {
    const y = Math.floor(stop.lat / 0.005), x = Math.floor(stop.lng / 0.005)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const to of cells.get(`${y + dy},${x + dx}`) ?? []) {
        if (to === from || (railStops.has(from) && railStops.has(to)) || specified.has(`${stop.id}\0${stops[to].id}`)) continue
        const metres = distance(stop, stops[to])
        if (metres <= TRANSFER_RADIUS) {
          const seconds = walkingSeconds(metres)
          edges.add(n + from, to, seconds, WALK)
        }
      }
    }
  })
  const seconds = new Float64Array(nodes)
  const boards = new Int32Array(nodes)
  const next = new Int32Array(nodes)
  const tails = new Float64Array(n)
  let last: { destination: Point; minutes: number; nearby: ReturnType<typeof indexStops> } | undefined
  const route = (destination: Point, maxMinutes: number): Reachability => {
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 180) throw new Error('소요시간을 확인해 주세요.')
    if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng) || Math.abs(destination.lat) > 90 || Math.abs(destination.lng) > 180) {
      throw new Error('목적지 좌표를 확인해 주세요.')
    }
    // 최단시간 탐색에서 밀려나지 않도록 무환승을 먼저 확인한다.
    const direct = directStops(network, destination, maxMinutes)
    seconds.fill(Infinity)
    boards.fill(0x7fffffff)
    next.fill(-1)
    tails.fill(Infinity)
    const queue = new Queue()
    stops.forEach((stop, index) => {
      const metres = distance(stop, destination)
      if (metres > DESTINATION_RADIUS) return
      const time = walkingSeconds(metres)
      if (time > MAX_WALK_SECONDS) return
      seconds[n + index] = time
      boards[n + index] = 0
      tails[index] = time
      queue.push({ node: n + index, seconds: time, boardings: 0 })
    })
    let current: QueueItem | undefined
    while ((current = queue.pop())) {
      if (current.seconds !== seconds[current.node] || current.boardings !== boards[current.node]) continue
      if (current.seconds > maxMinutes * 60) continue
      for (let edge = edges.heads[current.node]; edge >= 0; edge = edges.next[edge]) {
        const from = edges.from[edge]
        const time = current.seconds + edges.seconds[edge], boardings = current.boardings + (edges.kind[edge] === WAIT ? 1 : 0)
        if (time > maxMinutes * 60 || time > seconds[from] || (time === seconds[from] && boardings >= boards[from])) continue
        seconds[from] = time
        boards[from] = boardings
        next[from] = edge
        queue.push({ node: from, seconds: time, boardings })
      }
    }
    const reachable: ReachableStop[] = []
    stops.forEach((stop, index) => {
      // 도보만으로는 5분을 넘는 집도 여기서 승차할 수 있으므로 탑승 대안을 함께 보존한다.
      if (tails[index] <= maxMinutes * 60) {
        reachable.push({ ...stop, seconds: tails[index], boardings: 0,
          legs: [{ mode: 'walk', from: stop.name, to: '목적지', seconds: tails[index], fromStopId: stop.id }] })
      }
      if (seconds[index] > maxMinutes * 60) return
      const legs: RouteLeg[] = []
      let node = index
      while (next[node] >= 0) {
        const edge = next[node], to = edges.to[edge], kind = edges.kind[edge]
        const fromName = stops[nodeStop[node]].name, toName = stops[nodeStop[to]].name
        let leg: RouteLeg | undefined
        const endpoints = { fromStopId: stops[nodeStop[node]].id, toStopId: stops[nodeStop[to]].id }
        if (kind === WALK) leg = { mode: 'walk', from: fromName, to: toName, seconds: edges.seconds[edge], ...endpoints }
        else if (kind !== ALIGHT) {
          const lineIndex = nodeLine[kind === WAIT ? to : node]
          const line = network.lines[lineIndex]
          leg = { mode: kind === WAIT ? 'wait' : line.mode, from: fromName, to: toName,
            seconds: edges.seconds[edge], line: line.name, lineId: line.id, ...endpoints,
            ...(kind === WAIT ? {} : { fromIndex: Math.floor((node - lineOffsets[lineIndex]) / 2),
              toIndex: Math.floor((to - lineOffsets[lineIndex]) / 2) }) }
        }
        if (leg) {
          const previous = legs.at(-1)
          if (previous && ['bus', 'rail'].includes(leg.mode) && previous.lineId === leg.lineId && previous.mode === leg.mode) {
            previous.to = leg.to
            previous.seconds += leg.seconds
            previous.toStopId = leg.toStopId
            previous.toIndex = leg.toIndex
          } else legs.push(leg)
        }
        node = to
      }
      const lastStop = nodeStop[node]
      legs.push({ mode: 'walk', from: stops[lastStop].name, to: '목적지', seconds: tails[lastStop], fromStopId: stops[lastStop].id })
      reachable.push({ ...stop, seconds: seconds[index], boardings: boards[index], legs })
    })
    // 최단시간 탐색에서 밀려난 무환승 경로를 별도로 보존한다.
    const fastest = new Map(reachable.map(stop => [stop.id, stop]))
    for (const route of direct) {
      const other = fastest.get(route.id)
      if (!other || other.boardings > 1 || route.seconds < other.seconds) reachable.push(route)
    }
    const result = { stops: reachable.sort((a, b) => a.seconds - b.seconds || a.boardings - b.boardings), source: network.source, coverage: network.coverage }
    last = { destination, minutes: maxMinutes, nearby: indexStops(result.stops) }
    return result
  }
  return Object.assign(route, { rank: (place: Place, destination: Place, minMinutes = 0) => {
    if (!last || last.destination.lat !== destination.lat || last.destination.lng !== destination.lng) throw new Error('검색 조건을 다시 확인해 주세요.')
    return rankApartment(place, destination, last.nearby(place), last.minutes, minMinutes)
  } })
}

export function findReachableStops(network: TransitNetwork, destination: Point, maxMinutes: number): Reachability {
  return createRouter(network)(destination, maxMinutes)
}

export function directStops(network: TransitNetwork, destination: Point, maxMinutes: number): ReachableStop[] {
  const byId = new Map(network.stops.map(stop => [stop.id, stop]))
  const tails = new Map(network.stops.map(stop => {
    const metres = distance(stop, destination)
    return [stop.id, metres <= DESTINATION_RADIUS ? walkingSeconds(metres) : Infinity]
  }))
  const best = new Map<string, ReachableStop>()
  for (const line of network.lines) {
    let onward = Infinity, exit = -1
    for (let i = line.stops.length - 1; i >= 0; i--) {
      const stop = byId.get(line.stops[i])!
      const running = i + 1 < line.stops.length ? line.seconds[i] + onward : Infinity
      const seconds = line.waitSeconds + running
      if (exit > i && line.pickup?.[i] !== false && seconds <= maxMinutes * 60 && seconds < (best.get(stop.id)?.seconds ?? Infinity)) {
        const end = byId.get(line.stops[exit])!
        const tail = tails.get(end.id)!
        best.set(stop.id, { ...stop, seconds, boardings: 1, legs: [
          { mode: 'wait', from: stop.name, to: stop.name, seconds: line.waitSeconds, line: line.name, lineId: line.id,
            fromStopId: stop.id, toStopId: stop.id },
          { mode: line.mode, from: stop.name, to: end.name, seconds: running - tail, line: line.name, lineId: line.id,
            fromStopId: stop.id, toStopId: end.id, fromIndex: i, toIndex: exit },
          { mode: 'walk', from: end.name, to: '목적지', seconds: tail, fromStopId: end.id },
        ] })
      }
      const exitTime = line.dropoff?.[i] !== false ? tails.get(stop.id)! : Infinity
      const throughTime = running + (line.dwellSeconds?.[i] ?? 0)
      if (exitTime <= throughTime) { onward = exitTime; exit = i }
      else onward = throughTime
    }
  }
  return [...best.values()]
}

export function compareRoutes(a: { seconds: number; transfers: number }, b: { seconds: number; transfers: number }) {
  return Number(a.transfers > 0) - Number(b.transfers > 0) || a.seconds - b.seconds || a.transfers - b.transfers
}

export function rankApartment(place: Place, destination: Place, stops: ReachableStop[], maxMinutes: number, minMinutes = 0): ApartmentResult | null {
  let best: ApartmentResult | null = null
  const direct = distance(place, destination)
  if (direct <= DESTINATION_RADIUS && walkingSeconds(direct) <= Math.min(maxMinutes * 60, MAX_WALK_SECONDS)) {
    best = { ...place, seconds: walkingSeconds(direct), transfers: 0, startStop: '도보 이동',
      legs: [{ mode: 'walk', from: place.name, to: destination.name, seconds: walkingSeconds(direct) }] }
  }
  for (const stop of stops) {
    const metres = distance(place, stop)
    if (metres > ACCESS_RADIUS) continue
    const walk = walkingSeconds(metres), seconds = walk + stop.seconds, transfers = Math.max(0, stop.boardings - 1)
    if (seconds > maxMinutes * 60 || !walkingFits(stop.legs, walk)) continue
    if (best && compareRoutes(best, { seconds, transfers }) <= 0) continue
    best = { ...place, seconds, transfers, startStop: stop.boardings ? stop.name : '도보 이동',
      legs: [{ mode: 'walk', from: place.name, to: stop.name, seconds: walk, toStopId: stop.id }, ...stop.legs] }
  }
  return best && best.seconds >= minMinutes * 60 ? best : null
}

export const sortApartments = (results: ApartmentResult[]) => results.sort((a, b) =>
  compareRoutes(a, b) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
