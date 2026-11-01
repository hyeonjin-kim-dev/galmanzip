import { sortApartments } from './routing'
import { searchZones, splitZone } from './zones'
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

export async function searchApartments(destination: Place, minMinutes: number, maxMinutes: number, signal: AbortSignal,
  update: (snapshot: SearchSnapshot) => void) {
  if (!Number.isFinite(minMinutes) || minMinutes < 0 || minMinutes > maxMinutes) throw new Error('소요 시간을 확인해 주세요.')
  const graph = await reachability(destination, maxMinutes, signal)
  signal.throwIfAborted()
  if (!graph.stops.length) throw new Error('목적지 주변에서 자료에 포함된 정류장을 찾지 못했습니다.')
  const zones = searchZones(graph.stops, destination, maxMinutes)
  const pending = [...zones].reverse()
  const places = new Map<string, ApartmentResult | null>()
  let completed = 0, total = zones.length, limited = false, lastEmission = 0, dirty = false
  let results: ApartmentResult[] = []
  const notice = '도보 합계 5분 이하인 경로에서 환승 없는 경로를 우선합니다. 교통 자료로 추정한 결과이며 실제 운행은 외부 길찾기에서 확인해 주세요.'
  const emit = (status: SearchSnapshot['status'], message: string, force = false) => {
    if (!force && status === 'loading' && performance.now() - lastEmission < 250) return
    lastEmission = performance.now()
    if (dirty) {
      results = sortApartments([...places.values()].filter((value): value is ApartmentResult => value !== null))
      dirty = false
    }
    update({ status, message, completed, total, limited, notice, results,
      source: graph.source, coverage: graph.coverage })
  }
  const loading = graph.stops.length > 10000 ? '조회 범위가 넓어 시간이 걸립니다. 결과는 확인되는 대로 표시되며 언제든 중단할 수 있습니다.' : '정류장 주변 아파트와 도착 경로를 조회하고 있습니다.'
  emit('loading', loading, true)
  let nextRequest = 0
  try {
    while (pending.length) {
      signal.throwIfAborted()
      const zone = pending.pop()!
      let received = 0
      for (let page = 1; page <= 45; page++) {
        // 응답 대기와 중복 휴지를 겹치지 않되, 조회 시작 간격은 유지한다.
        const remaining = nextRequest - performance.now()
        if (remaining > 0) await new Promise<void>((resolve, reject) => {
          const abort = () => { window.clearTimeout(timer); reject(signal.reason) }
          const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, remaining)
          signal.addEventListener('abort', abort, { once: true })
        })
        signal.throwIfAborted()
        nextRequest = performance.now() + 200
        const response = await queryPlaces('아파트', signal, zone, page)
        signal.throwIfAborted()
        received += response.data.length
        const batch: Place[] = []
        for (const data of response.data) {
          if (!/아파트\s*$/.test(data.category_name) || !inServiceArea(data.address_name) || places.has(data.id)) continue
          const place = toPlace(data)
          if (!place) continue
          places.set(place.id, null)
          batch.push(place)
        }
        if (batch.length) {
          const ranked = await routingTask<(ApartmentResult | null)[]>({ kind: 'rank', destination, minutes: maxMinutes, minMinutes, places: batch }, signal)
          signal.throwIfAborted()
          batch.forEach((place, index) => {
            const result = ranked[index]
            places.set(place.id, result)
            if (result) dirty = true
          })
        }
        emit('loading', loading, dirty && results.length === 0)
        // 총건수가 노출 한도에 잘릴 수도 있으므로 한도에 도달한 지역부터 세분화한다.
        if (page === 1 && response.total >= 45) {
          const children = splitZone(zone)
          if (children.length) { pending.push(...children.reverse()); total += children.length; break }
        }
        if (!response.more || page === 45) {
          if (response.more || response.total > received || response.total >= 45) {
            const children = splitZone(zone)
            if (children.length) { pending.push(...children.reverse()); total += children.length }
            else limited = true
          }
          break
        }
        if (!response.data.length) { limited = true; break }
      }
      completed++
      emit('loading', loading)
    }
    signal.throwIfAborted()
    emit('complete', '검색을 완료했습니다.')
  } catch (error) {
    if (signal.aborted) throw error
    emit('error', error instanceof Error ? error.message : '아파트 조회를 완료하지 못했습니다.')
  }
}
