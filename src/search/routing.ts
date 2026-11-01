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

type QueueItem = { node: number; seconds: number; boardings: number; priority?: number }
type WalkLabel = QueueItem & { walked: number; edge: number; previous?: WalkLabel; active: boolean }
const precedes = (a: QueueItem, b: QueueItem) => (a.priority ?? a.seconds) < (b.priority ?? b.seconds)
  || ((a.priority ?? a.seconds) === (b.priority ?? b.seconds) && (a.seconds < b.seconds || (a.seconds === b.seconds && a.boardings < b.boardings)))

class Queue<T extends QueueItem = QueueItem> {
  items: T[] = []
  push(item: T) {
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
  pop(): T | undefined {
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
  let offset = n * 2
  stops.forEach((_, index) => { nodeStop[index] = index; nodeStop[n + index] = index })
  network.lines.forEach((line, lineIndex) => {
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
    edges.add(n + indices.get(transfer.from)!, indices.get(transfer.to)!, transfer.seconds, WALK)
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
  const outgoing = new Int32Array(nodes).fill(-1), following = new Int32Array(edges.count)
  for (let edge = 0; edge < edges.count; edge++) {
    following[edge] = outgoing[edges.from[edge]]
    outgoing[edges.from[edge]] = edge
  }
  const appendLeg = (legs: RouteLeg[], edge: number) => {
    const from = edges.from[edge], to = edges.to[edge], kind = edges.kind[edge]
    const fromName = stops[nodeStop[from]].name, toName = stops[nodeStop[to]].name
    let leg: RouteLeg | undefined
    if (kind === WALK) leg = { mode: 'walk', from: fromName, to: toName, seconds: edges.seconds[edge] }
    else if (kind !== ALIGHT) {
      const line = network.lines[nodeLine[kind === WAIT ? to : from]]
      leg = { mode: kind === WAIT ? 'wait' : line.mode, from: fromName, to: toName,
        seconds: edges.seconds[edge], line: line.name, lineId: line.id }
    }
    if (leg) {
      const previous = legs.at(-1)
      if (previous && ['bus', 'rail'].includes(leg.mode) && previous.lineId === leg.lineId && previous.mode === leg.mode) {
        previous.to = leg.to
        previous.seconds += leg.seconds
      } else legs.push(leg)
    }
  }
  const seconds = new Float64Array(nodes)
  const boards = new Int32Array(nodes)
  const next = new Int32Array(nodes)
  const tails = new Float64Array(n)
  let last: { destination: Point; minutes: number; stops: ReachableStop[]; nearby: ReturnType<typeof indexStops> } | undefined
  let minimumWalk: Float64Array | undefined
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
      // 도보만으로 도착하는 후보는 별도로 비교해 환승 도보를 연쇄 적용하지 않는다.
      if (tails[index] <= seconds[index] && tails[index] <= maxMinutes * 60) {
        reachable.push({ ...stop, seconds: tails[index], walkSeconds: tails[index], boardings: 0,
          legs: [{ mode: 'walk', from: stop.name, to: '목적지', seconds: tails[index] }] })
        return
      }
      if (seconds[index] > maxMinutes * 60) return
      const legs: RouteLeg[] = []
      let node = index
      while (next[node] >= 0) {
        const edge = next[node], to = edges.to[edge], kind = edges.kind[edge]
        appendLeg(legs, edge)
        node = to
      }
      const lastStop = nodeStop[node]
      legs.push({ mode: 'walk', from: stops[lastStop].name, to: '목적지', seconds: tails[lastStop] })
      reachable.push({ ...stop, seconds: seconds[index], walkSeconds: legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0), boardings: boards[index], legs })
    })
    const key = (stop: ReachableStop) => `${stop.id}/${stop.seconds}/${stop.boardings}/${stop.walkSeconds}`
    const known = new Set(reachable.map(key))
    for (const option of direct) if (!known.has(key(option))) reachable.push(option)
    if (last?.destination.lat !== destination.lat || last?.destination.lng !== destination.lng) minimumWalk = undefined
    last = { destination, minutes: maxMinutes, stops: reachable, nearby: indexStops(reachable) }
    return { stops: reachable, source: network.source, coverage: network.coverage }
  }

  const rank = (place: Place, destination: Place, minMinutes = 0): ApartmentResult | null => {
    if (!last || last.destination.lat !== destination.lat || last.destination.lng !== destination.lng) throw new Error('검색 조건을 다시 확인해 주세요.')
    const nearby = last.nearby(place)
    let best = rankApartment(place, destination, nearby, last.minutes)
    const limit = last.minutes * 60
    // 무환승이 있거나 가장 빠른 후보가 이미 보행 제한을 지키면 추가 탐색이 필요 없다.
    const uncertain = !best || best.transfers > 0
    const origins = new Map<string, ReachableStop>()
    for (const stop of nearby) if (!origins.has(stop.id) || stop.seconds < origins.get(stop.id)!.seconds) origins.set(stop.id, stop)
    const needsSearch = uncertain && [...origins.values()].some(stop => {
      const walk = walkingSeconds(distance(place, stop))
      return walk <= MAX_WALK_SECONDS && walk + stop.seconds <= Math.min(limit, best?.seconds ?? Infinity)
        && walk + (stop.walkSeconds ?? 0) > MAX_WALK_SECONDS
    })
    if (!needsSearch) return best && best.seconds >= minMinutes * 60 ? best : null

    if (!minimumWalk) {
      // 시간을 제외한 최소 보행량으로 도보 제한을 만족할 수 없는 후보를 먼저 제외한다.
      minimumWalk = new Float64Array(nodes).fill(Infinity)
      const queue = new Queue()
      for (let i = 0; i < n; i++) if (tails[i] <= MAX_WALK_SECONDS) {
        minimumWalk[n + i] = tails[i]
        queue.push({ node: n + i, seconds: tails[i], boardings: 0 })
      }
      let current: QueueItem | undefined
      while ((current = queue.pop())) {
        if (current.seconds !== minimumWalk[current.node]) continue
        for (let edge = edges.heads[current.node]; edge >= 0; edge = edges.next[edge]) {
          const from = edges.from[edge], walk = current.seconds + (edges.kind[edge] === WALK ? edges.seconds[edge] : 0)
          if (walk > MAX_WALK_SECONDS || walk >= minimumWalk[from]) continue
          minimumWalk[from] = walk
          queue.push({ node: from, seconds: walk, boardings: 0 })
        }
      }
    }
    const queue = new Queue<WalkLabel>()
    const states = new Map<number, WalkLabel[]>()
    const offer = (item: WalkLabel) => {
      const priority = item.seconds + seconds[item.node]
      if (item.walked + minimumWalk![item.node] > MAX_WALK_SECONDS || priority > Math.min(limit, best?.seconds ?? Infinity)) return
      const previous = states.get(item.node) ?? []
      const dominates = (a: WalkLabel, b: WalkLabel) => a.walked <= b.walked && a.seconds <= b.seconds
        && (a.seconds < b.seconds || a.boardings <= b.boardings)
      if (previous.some(other => dominates(other, item))) return
      const kept: WalkLabel[] = []
      for (const other of previous) {
        if (dominates(item, other)) other.active = false
        else kept.push(other)
      }
      kept.push(item)
      states.set(item.node, kept)
      item.priority = priority
      queue.push(item)
    }
    for (const stop of origins.values()) {
      const walk = walkingSeconds(distance(place, stop))
      if (walk <= MAX_WALK_SECONDS) offer({ node: indices.get(stop.id)!, seconds: walk, walked: walk,
        boardings: 0, edge: -1, active: true })
    }
    let current: WalkLabel | undefined
    while ((current = queue.pop())) {
      if (!current.active) continue
      if (current.priority! > Math.min(limit, best?.seconds ?? Infinity)) break
      const tail = current.node >= n && current.node < n * 2 ? tails[current.node - n] : Infinity
      const total = current.seconds + tail
      if (current.walked + tail <= MAX_WALK_SECONDS && total <= limit
        && (!best || compareRoutes({ seconds: total, transfers: Math.max(0, current.boardings - 1) }, best) < 0)) {
        const path: number[] = []
        let first = current
        while (first.previous) { path.push(first.edge); first = first.previous }
        const legs: RouteLeg[] = [{ mode: 'walk', from: place.name, to: stops[nodeStop[first.node]].name, seconds: first.seconds }]
        for (const edge of path.reverse()) appendLeg(legs, edge)
        legs.push({ mode: 'walk', from: stops[nodeStop[current.node]].name, to: destination.name, seconds: tail })
        best = { ...place, seconds: total, transfers: Math.max(0, current.boardings - 1), startStop: stops[nodeStop[first.node]].name, legs }
      }
      for (let edge = outgoing[current.node]; edge >= 0; edge = following[edge]) {
        offer({ node: edges.to[edge], seconds: current.seconds + edges.seconds[edge],
          walked: current.walked + (edges.kind[edge] === WALK ? edges.seconds[edge] : 0),
          boardings: current.boardings + (edges.kind[edge] === WAIT ? 1 : 0), previous: current, edge, active: true })
      }
    }
    return best && best.seconds >= minMinutes * 60 ? best : null
  }
  return Object.assign(route, { rank })
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
  const best = new Map<string, ReachableStop[]>()
  for (const line of network.lines) {
    let exits: { seconds: number; walked: number; index: number }[] = []
    for (let i = line.stops.length - 1; i >= 0; i--) {
      const stop = byId.get(line.stops[i])!
      for (const exit of exits) {
        exit.seconds += line.seconds[i]
        const seconds = line.waitSeconds + exit.seconds
        const options = best.get(stop.id) ?? []
        if (line.pickup?.[i] !== false && seconds <= maxMinutes * 60
          && !options.some(other => other.seconds <= seconds && other.walkSeconds! <= exit.walked)) {
          const end = byId.get(line.stops[exit.index])!
          const route: ReachableStop = { ...stop, seconds, walkSeconds: exit.walked, boardings: 1, legs: [
            { mode: 'wait', from: stop.name, to: stop.name, seconds: line.waitSeconds, line: line.name, lineId: line.id },
            { mode: line.mode, from: stop.name, to: end.name, seconds: exit.seconds - exit.walked, line: line.name, lineId: line.id },
            { mode: 'walk', from: end.name, to: '목적지', seconds: exit.walked },
          ] }
          best.set(stop.id, [...options.filter(other => other.seconds < seconds || other.walkSeconds! < exit.walked), route])
        }
        exit.seconds += line.dwellSeconds?.[i] ?? 0
      }
      exits = exits.filter(exit => exit.seconds + line.waitSeconds <= maxMinutes * 60)
      const tail = line.dropoff?.[i] !== false ? tails.get(stop.id)! : Infinity
      if (tail <= MAX_WALK_SECONDS && !exits.some(exit => exit.seconds <= tail && exit.walked <= tail)) {
        exits = exits.filter(exit => exit.seconds < tail || exit.walked < tail)
        exits.push({ seconds: tail, walked: tail, index: i })
      }
    }
  }
  return [...best.values()].flat()
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
    if (seconds > maxMinutes * 60 || walk + (stop.walkSeconds ?? stop.legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0)) > MAX_WALK_SECONDS) continue
    if (best && compareRoutes(best, { seconds, transfers }) <= 0) continue
    best = { ...place, seconds, transfers, startStop: stop.boardings ? stop.name : '도보 이동',
      legs: [{ mode: 'walk', from: place.name, to: stop.name, seconds: walk }, ...stop.legs] }
  }
  return best && best.seconds >= minMinutes * 60 ? best : null
}

export const sortApartments = (results: ApartmentResult[]) => results.sort((a, b) =>
  compareRoutes(a, b) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
