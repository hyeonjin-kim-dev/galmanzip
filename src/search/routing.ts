import type { ApartmentResult, Place, Point, Reachability, ReachableStop, RouteLeg, TransitNetwork } from './types.ts'
import { Edges } from './edges.ts'
import { compareResultGroups } from './resultOrder.ts'

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

// 차량을 타기 전까지 이어지는 도보를 한 구간으로 검사한다.
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
      || (line.color !== undefined && (typeof line.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(line.color)))
      || (line.typeName !== undefined && (typeof line.typeName !== 'string' || !line.typeName.trim()))
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
  const nodes = n * 2 + positions * 3
  const edges = new Edges(nodes, positions * 9 + n * 8)
  const WALK = 0, BOARD = 1, RIDE = 2, ALIGHT = 3, DWELL = 4, TRANSFER = 5, LINK = 6
  const nodeStop = new Int32Array(nodes)
  const nodeLine = new Int32Array(nodes).fill(-1)
  const railStops = new Set<number>()
  const lineOffsets: number[] = []
  const arrivals = Array.from({ length: n }, () => [] as number[])
  const departures = Array.from({ length: n }, () => [] as number[])
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
      if (line.dropoff?.[index] !== false) {
        edges.add(arrival, n + stopIndex, 0, ALIGHT)
        arrivals[stopIndex].push(arrival)
      }
      if (index + 1 < line.stops.length) {
        // 승차 전 대기는 제외하되 승차 연결을 남겨 환승 횟수를 계산한다.
        if (line.pickup?.[index] !== false) {
          edges.add(stopIndex, departure, 0, BOARD)
          departures[stopIndex].push(departure)
        }
        edges.add(arrival, departure, line.dwellSeconds?.[index] ?? 0, DWELL)
        edges.add(departure, arrival + 2, line.seconds[index], RIDE)
      }
    })
    offset += line.stops.length * 2
  })
  const specified = new Map(network.transfers.map(transfer => [`${transfer.from}\0${transfer.to}`, transfer.seconds]))
  for (const transfer of network.transfers) {
    // 5분 초과 환승을 빼도 원본 지정은 남겨 가까운 정류장 간 자동 도보로 우회하지 못하게 한다.
    if (transfer.from !== transfer.to && transfer.seconds <= MAX_WALK_SECONDS) edges.add(n + indices.get(transfer.from)!, indices.get(transfer.to)!, transfer.seconds, WALK)
  }
  for (let index = 0; index < n; index++) {
    const seconds = specified.get(`${stops[index].id}\0${stops[index].id}`) ?? 0
    const options = departures[index]
    if (seconds > MAX_WALK_SECONDS || !options.length || !arrivals[index].length) continue
    type Group = { node: number; start: number; end: number; left?: Group; right?: Group }
    // 승차 위치의 구간을 공유해 노선이 많은 정류장에서도 모든 환승 쌍을 만들지 않는다.
    const group = (start: number, end: number): Group => {
      if (end - start === 1) return { node: options[start], start, end }
      const node = offset++, middle = (start + end) >> 1
      nodeStop[node] = index
      const left = group(start, middle), right = group(middle, end)
      for (const child of [left, right]) edges.add(node, child.node, 0, child.end - child.start === 1 ? BOARD : LINK)
      return { node, start, end, left, right }
    }
    const root = group(0, options.length)
    const positions = new Map(options.map((node, index) => [node, index]))
    const connect = (arrival: number, blocked: number | undefined, target: Group) => {
      if (blocked === undefined || blocked < target.start || blocked >= target.end) {
        edges.add(arrival, target.node, seconds, target.end - target.start === 1 ? TRANSFER : WALK)
      } else if (target.left && target.right) {
        connect(arrival, blocked, target.left); connect(arrival, blocked, target.right)
      }
    }
    for (const arrival of arrivals[index]) {
      // 같은 정차 위치에 다시 타서 차량의 정차시간을 건너뛰는 우회만 제외한다.
      connect(arrival, positions.get(arrival + 1), root)
    }
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
  const layers: { seconds: Float64Array; next: Int32Array }[] = []
  const tails = new Float64Array(n)
  let last: { destination: Point; minutes: number; maxTransfers: number; nearby: ReturnType<typeof indexStops> } | undefined
  const route = (destination: Point, maxMinutes: number, maxTransfers = 3): Reachability => {
    if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 180) throw new Error('소요시간을 확인해 주세요.')
    if (!Number.isInteger(maxTransfers) || maxTransfers < 0 || maxTransfers > 3) throw new Error('최대 환승 횟수는 0~3회로 선택해 주세요.')
    if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng) || Math.abs(destination.lat) > 90 || Math.abs(destination.lng) > 180) {
      throw new Error('목적지 좌표를 확인해 주세요.')
    }
    // 최단시간 탐색에서 밀려나지 않도록 무환승을 먼저 확인한다.
    const direct = directStops(network, destination, maxMinutes)
    const maxBoardings = maxTransfers + 1
    // 승차 횟수별 비용을 보존해, 빠른 다환승 경로가 허용 범위의 대안을 지우지 않게 한다.
    for (let count = 0; count <= maxBoardings; count++) {
      const layer = layers[count] ??= { seconds: new Float64Array(offset), next: new Int32Array(offset) }
      layer.seconds.fill(Infinity)
      layer.next.fill(-1)
    }
    const dominated = (node: number, seconds: number, boardings: number) => {
      for (let count = 0; count < boardings; count++) if (layers[count].seconds[node] <= seconds) return true
      return false
    }
    tails.fill(Infinity)
    const queue = new Queue()
    stops.forEach((stop, index) => {
      const metres = distance(stop, destination)
      if (metres > DESTINATION_RADIUS) return
      const time = walkingSeconds(metres)
      if (time > MAX_WALK_SECONDS) return
      layers[0].seconds[n + index] = time
      tails[index] = time
      queue.push({ node: n + index, seconds: time, boardings: 0 })
    })
    let current: QueueItem | undefined
    while ((current = queue.pop())) {
      if (current.seconds !== layers[current.boardings].seconds[current.node]
        || dominated(current.node, current.seconds, current.boardings)) continue
      if (current.seconds > maxMinutes * 60) continue
      for (let edge = edges.heads[current.node]; edge >= 0; edge = edges.next[edge]) {
        const from = edges.from[edge]
        const time = current.seconds + edges.seconds[edge], boardings = current.boardings + (edges.kind[edge] === BOARD || edges.kind[edge] === TRANSFER ? 1 : 0)
        if (boardings > maxBoardings || time > maxMinutes * 60 || time >= layers[boardings].seconds[from]
          || dominated(from, time, boardings)) continue
        layers[boardings].seconds[from] = time
        layers[boardings].next[from] = edge
        // 출발 정류장의 마지막 승차 비용까지만 필요하다. 더 거슬러 가려면 상한을 넘겨 다시 승차해야 한다.
        if (boardings < maxBoardings) queue.push({ node: from, seconds: time, boardings })
      }
    }
    const reachable: ReachableStop[] = []
    stops.forEach((stop, index) => {
      // 도보만으로는 5분을 넘는 집도 여기서 승차할 수 있으므로 탑승 대안을 함께 보존한다.
      if (tails[index] <= maxMinutes * 60) {
        reachable.push({ ...stop, seconds: tails[index], boardings: 0,
          legs: [{ mode: 'walk', from: stop.name, to: '목적지', seconds: tails[index], fromStopId: stop.id }] })
      }
      let boardings = 1
      for (let count = 2; count <= maxBoardings; count++) {
        if (layers[count].seconds[index] < layers[boardings].seconds[index]) boardings = count
      }
      const seconds = layers[boardings].seconds[index]
      if (seconds > maxMinutes * 60) return
      const legs: RouteLeg[] = []
      let node = index, remainingBoardings = boardings
      while (layers[remainingBoardings].next[node] >= 0) {
        const edge = layers[remainingBoardings].next[node], to = edges.to[edge], kind = edges.kind[edge]
        const fromName = stops[nodeStop[node]].name, toName = stops[nodeStop[to]].name
        let leg: RouteLeg | undefined
        const endpoints = { fromStopId: stops[nodeStop[node]].id, toStopId: stops[nodeStop[to]].id }
        if (kind === WALK || kind === TRANSFER) leg = { mode: 'walk', from: fromName, to: toName, seconds: edges.seconds[edge], ...endpoints }
        else if (kind !== ALIGHT && kind !== BOARD && kind !== LINK) {
          const lineIndex = nodeLine[node]
          const line = network.lines[lineIndex]
          leg = { mode: line.mode, from: fromName, to: toName,
            seconds: edges.seconds[edge], line: line.name, lineId: line.id, typeName: line.typeName, color: line.color, ...endpoints,
            fromIndex: Math.floor((node - lineOffsets[lineIndex]) / 2),
            toIndex: Math.floor((to - lineOffsets[lineIndex]) / 2) }
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
        if (kind === BOARD || kind === TRANSFER) remainingBoardings--
        node = to
      }
      const lastStop = nodeStop[node]
      legs.push({ mode: 'walk', from: stops[lastStop].name, to: '목적지', seconds: tails[lastStop], fromStopId: stops[lastStop].id })
      reachable.push({ ...stop, seconds, boardings, legs })
    })
    // 최단시간 탐색에서 밀려난 무환승 경로를 별도로 보존한다.
    const fastest = new Map(reachable.map(stop => [stop.id, stop]))
    for (const route of direct) {
      const other = fastest.get(route.id)
      if (!other || other.boardings > 1 || route.seconds < other.seconds) reachable.push(route)
    }
    const result = { stops: reachable.sort((a, b) => a.seconds - b.seconds || a.boardings - b.boardings), source: network.source, coverage: network.coverage }
    last = { destination, minutes: maxMinutes, maxTransfers, nearby: indexStops(result.stops) }
    return result
  }
  return Object.assign(route, { rank: (place: Place, destination: Place, minMinutes = 0) => {
    if (!last || last.destination.lat !== destination.lat || last.destination.lng !== destination.lng) throw new Error('검색 조건을 다시 확인해 주세요.')
    return rankApartment(place, destination, last.nearby(place), last.minutes, minMinutes, last.maxTransfers)
  } })
}

export function findReachableStops(network: TransitNetwork, destination: Point, maxMinutes: number, maxTransfers = 3): Reachability {
  return createRouter(network)(destination, maxMinutes, maxTransfers)
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
      const seconds = running
      if (exit > i && line.pickup?.[i] !== false && seconds <= maxMinutes * 60 && seconds < (best.get(stop.id)?.seconds ?? Infinity)) {
        const end = byId.get(line.stops[exit])!
        const tail = tails.get(end.id)!
        best.set(stop.id, { ...stop, seconds, boardings: 1, legs: [
          { mode: line.mode, from: stop.name, to: end.name, seconds: running - tail, line: line.name, lineId: line.id, typeName: line.typeName, color: line.color,
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

export function rankApartment(place: Place, destination: Place, stops: ReachableStop[], maxMinutes: number, minMinutes = 0, maxTransfers = 3): ApartmentResult | null {
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
    if (transfers > maxTransfers || seconds > maxMinutes * 60 || !walkingFits(stop.legs, walk)) continue
    if (best && compareRoutes(best, { seconds, transfers }) <= 0) continue
    best = { ...place, seconds, transfers, startStop: stop.boardings ? stop.name : '도보 이동',
      legs: [{ mode: 'walk', from: place.name, to: stop.name, seconds: walk, toStopId: stop.id }, ...stop.legs] }
  }
  return best && best.seconds >= minMinutes * 60 ? best : null
}

export const sortApartments = (results: ApartmentResult[]) => results.sort((a, b) =>
  compareResultGroups(a, b) || compareRoutes(a, b) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
