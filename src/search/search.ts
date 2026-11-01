import { DESTINATION_RADIUS, indexStops, rankApartment, searchZones, sortApartments } from './routing'
import { inServiceArea, queryPlaces, toPlace } from './places'
import type { ApartmentResult, Place, Reachability, SearchSnapshot } from './types'

let cached: { key: string; expires: number; result: Reachability } | undefined
let cacheTimer: number | undefined

function reachability(destination: Place, minutes: number, signal: AbortSignal): Promise<Reachability> {
  signal.throwIfAborted()
  const key = `${destination.lat},${destination.lng},${minutes}`
  if (cached?.key === key && cached.expires > Date.now()) return Promise.resolve(cached.result)
  cached = undefined
  window.clearTimeout(cacheTimer)
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' })
    let done = false
    const finish = (error?: Error, result?: Reachability) => {
      if (done) return
      done = true
      worker.terminate()
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else {
        // 자체 계산 결과 하나만 메모리에 유지하며 외부 장소 API 응답은 재사용하지 않는다.
        cached = { key, result: result!, expires: Date.now() + 2 * 3600000 }
        cacheTimer = window.setTimeout(() => { cached = undefined }, 2 * 3600000)
        resolve(result!)
      }
    }
    const abort = () => finish(new DOMException('검색을 취소했습니다.', 'AbortError'))
    const timer = window.setTimeout(() => finish(new Error('교통 자료 처리 시간이 초과되었습니다. 다시 시도해 주세요.')), 90000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : undefined, event.data.result)
    worker.onerror = () => finish(new Error('후보 구역을 찾지 못했습니다. 페이지를 새로고침해 주세요.'))
    worker.postMessage({ destination, minutes, url: new URL(`${import.meta.env.BASE_URL}data/transit.json`, location.href).href })
  })
}

export async function searchApartments(destination: Place, minMinutes: number, maxMinutes: number, signal: AbortSignal,
  update: (snapshot: SearchSnapshot) => void) {
  if (!Number.isFinite(minMinutes) || minMinutes < 0 || minMinutes > maxMinutes) throw new Error('소요 시간을 확인해 주세요.')
  const graph = await reachability(destination, maxMinutes, signal)
  signal.throwIfAborted()
  if (!graph.stops.length) throw new Error('목적지 주변에서 자료에 포함된 정류장을 찾지 못했습니다.')
  const zones = [{ ...destination, radius: DESTINATION_RADIUS }, ...searchZones(graph.stops)]
  const nearbyStops = indexStops(graph.stops)
  const places = new Map<string, ApartmentResult | null>()
  let completed = 0, limited = false, lastEmission = 0
  const notice = '교통 자료로 추정한 결과입니다. 환승 없는 경로를 우선하며 실제 운행은 외부 길찾기에서 확인해 주세요.'
  const emit = (status: SearchSnapshot['status'], message: string) => {
    lastEmission = performance.now()
    update({ status, message, completed, total: zones.length, limited, notice,
      results: sortApartments([...places.values()].filter((value): value is ApartmentResult => value !== null)),
      source: graph.source, coverage: graph.coverage })
  }
  const loading = zones.length > 500 ? '조회 범위가 넓어 시간이 걸립니다. 결과는 확인되는 대로 표시되며 언제든 중단할 수 있습니다.' : '정류장 주변 아파트와 도착 경로를 조회하고 있습니다.'
  emit('loading', loading)
  try {
    for (const zone of zones) {
      signal.throwIfAborted()
      let received = 0
      for (let page = 1; page <= 45; page++) {
        const response = await queryPlaces('아파트', signal, zone, zone.radius, page)
        signal.throwIfAborted()
        received += response.data.length
        for (const data of response.data) {
          if (!/아파트\s*$/.test(data.category_name) || !inServiceArea(data.address_name) || places.has(data.id)) continue
          const place = toPlace(data)
          if (!place) continue
          const result = rankApartment(place, destination, nearbyStops(place), maxMinutes, minMinutes)
          places.set(place.id, result)
          if (performance.now() - lastEmission >= 250) emit('loading', loading)
        }
        if (!response.more || page === 45) {
          if (response.more || response.total > received) limited = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      completed++
      emit('loading', loading)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    signal.throwIfAborted()
    emit('complete', '검색을 완료했습니다.')
  } catch (error) {
    if (signal.aborted) throw error
    emit('error', error instanceof Error ? error.message : '아파트 조회를 완료하지 못했습니다.')
  }
}
