import { sortApartments } from './routing'
import { nextZoneIndex, partitionZone, searchZones, splitZone } from './zones'
import type { SearchZone } from './zones'
import type { Bounds } from './bounds'
import { inServiceArea, queryPlaces, toPlace } from './places'
import type { ApartmentResult, Place, Reachability, SearchSnapshot } from './types'

let cached: { key: string; expires: number; result: Reachability } | undefined
let cacheTimer: number | undefined
let routingWorker: Worker | undefined
let workerExpires = 0
let workerTimer: number | undefined

type RoutingTask = { kind: 'reach' | 'rank'; destination: Place; minutes: number; places?: Place[]; minMinutes?: number }

function routingTask<T>(task: RoutingTask, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  window.clearTimeout(workerTimer)
  return new Promise((resolve, reject) => {
    if (!routingWorker || workerExpires <= Date.now()) {
      routingWorker?.terminate()
      routingWorker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' })
      workerExpires = Date.now() + 2 * 3600000
    }
    const worker = routingWorker
    const release = () => {
      worker.terminate()
      if (routingWorker === worker) routingWorker = undefined
    }
    let done = false
    const finish = (error?: Error, result?: T) => {
      if (done) return
      done = true
      worker.onmessage = worker.onerror = null
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) { release(); reject(error) }
      else {
        workerTimer = window.setTimeout(release, 30000)
        resolve(result!)
      }
    }
    const abort = () => finish(new DOMException('검색을 취소했습니다.', 'AbortError'))
    const timer = window.setTimeout(() => finish(new Error('교통 자료 처리 시간이 초과되었습니다. 다시 시도해 주세요.')), 90000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : undefined, event.data.result)
    worker.onerror = () => finish(new Error('경로를 계산하지 못했습니다. 페이지를 새로고침해 주세요.'))
    worker.postMessage({ ...task, url: new URL(`${import.meta.env.BASE_URL}data/transit.json`, location.href).href })
  })
}

async function reachability(destination: Place, minutes: number, signal: AbortSignal): Promise<Reachability> {
  signal.throwIfAborted()
  const key = `${destination.lat},${destination.lng},${minutes}`
  if (cached?.key === key && cached.expires > Date.now()) return cached.result
  cached = undefined
  window.clearTimeout(cacheTimer)
  const result = await routingTask<Reachability>({ kind: 'reach', destination, minutes }, signal)
  // 자체 계산 결과만 보관하며 장소 API 응답은 반복 검색에 재사용하지 않는다.
  cached = { key, result, expires: Date.now() + 2 * 3600000 }
  cacheTimer = window.setTimeout(() => { cached = undefined }, 2 * 3600000)
  return result
}

type PlaceResponse = Awaited<ReturnType<typeof queryPlaces>>
type ResponseOutcome = { response: PlaceResponse; error?: never } | { response?: never; error: unknown }
type AreaTask = { zone: SearchZone; page: number; received: number; response?: Promise<ResponseOutcome> }

export async function searchApartments(destination: Place, minMinutes: number, maxMinutes: number, signal: AbortSignal,
  update: (snapshot: SearchSnapshot) => void, getViewport: () => Bounds | null = () => null) {
  if (!Number.isFinite(minMinutes) || minMinutes < 0 || minMinutes > maxMinutes) throw new Error('소요 시간을 확인해 주세요.')
  signal.throwIfAborted()
  const initialBounds = getViewport()
  const started = performance.now()
  // 현재 화면의 장소 응답을 교통망 준비와 겹쳐 기다린다. 경로 검증 전에는 결과로 표시하지 않는다.
  const early = initialBounds ? queryPlaces('아파트', signal, initialBounds).then<ResponseOutcome, ResponseOutcome>(
    response => ({ response }), error => ({ error })) : undefined
  const graph = await reachability(destination, maxMinutes, signal)
  signal.throwIfAborted()
  if (!graph.stops.length) throw new Error('목적지 주변에서 자료에 포함된 정류장을 찾지 못했습니다.')
  let pending: AreaTask[] = []
  const roots = searchZones(graph.stops, destination, maxMinutes)
  const foreground: SearchZone[] = []
  for (const root of roots) {
    if (initialBounds && early) {
      const parts = partitionZone(root, initialBounds)
      if (parts.inside) foreground.push(parts.inside)
      pending.push(...parts.outside.map(zone => ({ zone, page: 1, received: 0 })))
    } else pending.push({ zone: root, page: 1, received: 0 })
  }
  if (initialBounds && early && foreground.length) pending.push({
    zone: { ...initialBounds, depth: 0, priority: 0, coverage: foreground.flatMap(zone => zone.coverage) },
    page: 1, received: 0, response: early,
  })
  const places = new Set<string>()
  let completed = 0, total = pending.length, limited = false, active: SearchZone | undefined
  let results: ApartmentResult[] = []
  let added: ApartmentResult[] = []
  const notice = '각 도보 구간이 5분 이하인 경로에서 환승 없는 경로를 우선합니다. 교통 자료로 추정한 결과이며 실제 운행은 외부 길찾기에서 확인해 주세요.'
  const emit = (status: SearchSnapshot['status'], message: string) => {
    if (added.length) {
      results = [...results, ...sortApartments(added)]
      added = []
    }
    const areas = pending.map(task => task.zone)
    if (active) areas.push(active)
    update({ status, message, completed, total, limited, notice, results,
      pendingAreas: areas.map(({ south, west, north, east }) => ({ south, west, north, east })),
      source: graph.source, coverage: graph.coverage })
  }
  const loading = '집을 계속 찾고 있어요.'
  emit('loading', loading)
  let nextRequest = early ? started + 200 : 0
  try {
    while (pending.length) {
      signal.throwIfAborted()
      const view = getViewport()
      const index = nextZoneIndex(pending.map(task => task.zone), view, destination)
      const remaining = nextRequest - performance.now()
      if (!pending[index].response && remaining > 0) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => { window.clearTimeout(timer); reject(signal.reason) }
          const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, remaining)
          signal.addEventListener('abort', abort, { once: true })
        })
        // 대기 중 바뀐 지도도 실제 요청 직전에 다시 반영한다.
        continue
      }
      const task = pending.splice(index, 1)[0]
      // 페이지를 읽는 중 지도가 바뀌어도 다음 요청부터 새 영역을 먼저 확인한다.
      if (view && task.page === 1 && !task.response) {
        const parts = partitionZone(task.zone, view)
        if (parts.inside) {
          task.zone = parts.inside
          pending.push(...parts.outside.map(zone => ({ zone, page: 1, received: 0 })))
          total += parts.outside.length
        }
      }
      active = task.zone
      let response: PlaceResponse
      if (task.response) {
        const outcome = await task.response
        if ('error' in outcome) throw outcome.error
        response = outcome.response!
      } else {
        signal.throwIfAborted()
        nextRequest = performance.now() + 200
        response = await queryPlaces('아파트', signal, task.zone, task.page)
      }
      signal.throwIfAborted()
      const received = task.received + response.data.length
      const batch: Place[] = []
      for (const data of response.data) {
        if (!/아파트\s*$/.test(data.category_name) || !inServiceArea(data.address_name) || places.has(data.id)) continue
        const place = toPlace(data)
        if (!place) continue
        places.add(place.id)
        batch.push(place)
      }
      if (batch.length) {
        const ranked = await routingTask<(ApartmentResult | null)[]>({ kind: 'rank', destination, minutes: maxMinutes, minMinutes, places: batch }, signal)
        signal.throwIfAborted()
        added.push(...ranked.filter((value): value is ApartmentResult => value !== null))
      }
      const capped = response.total >= 45 || response.total > received
      if (!response.data.length && response.more) {
        limited = true
        completed++
      } else if ((task.page === 1 && response.total >= 45) || !response.more || task.page === 45) {
        const children = capped || response.more ? splitZone(task.zone) : []
        if (children.length) {
          pending.push(...children.map(zone => ({ zone, page: 1, received: 0 })))
          total += children.length
        } else if (capped || response.more) limited = true
        completed++
      } else pending.push({ zone: task.zone, page: task.page + 1, received })
      active = undefined
      emit('loading', loading)
    }
    signal.throwIfAborted()
    emit('complete', '검색을 완료했습니다.')
  } catch (error) {
    if (signal.aborted) throw error
    emit('error', error instanceof Error ? error.message : '아파트 조회를 완료하지 못했습니다.')
  }
}
