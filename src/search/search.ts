import { DESTINATION_RADIUS, indexStops, rankApartment, searchZones, sortApartments } from './routing'
import { inServiceArea, queryPlaces, toPlace } from './places'
import type { ApartmentResult, Place, Reachability, SearchSnapshot } from './types'

function reachability(destination: Place, minutes: number, signal: AbortSignal): Promise<Reachability> {
  signal.throwIfAborted()
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
      else resolve(result!)
    }
    const abort = () => finish(new DOMException('검색을 취소했습니다.', 'AbortError'))
    const timer = window.setTimeout(() => finish(new Error('교통 자료 처리 시간이 초과되었습니다. 다시 시도해 주세요.')), 90000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : undefined, event.data.result)
    worker.onerror = () => finish(new Error('경로 계산을 실행하지 못했습니다. 페이지를 새로고침해 주세요.'))
    worker.postMessage({ destination, minutes, url: new URL(`${import.meta.env.BASE_URL}data/transit.json`, location.href).href })
  })
}

export async function searchApartments(destination: Place, minMinutes: number, maxMinutes: number, signal: AbortSignal, update: (snapshot: SearchSnapshot) => void) {
  if (!Number.isFinite(minMinutes) || minMinutes < 0 || minMinutes > maxMinutes) throw new Error('최소·최대 소요 시간을 확인해 주세요.')
  const graph = await reachability(destination, maxMinutes, signal)
  signal.throwIfAborted()
  if (!graph.stops.length) throw new Error('목적지 주변에서 지원하는 정류장을 찾지 못했습니다. 다른 목적지를 선택해 주세요.')
  const zones = searchZones(graph.stops)
  const allZones = [{ ...destination, radius: DESTINATION_RADIUS }, ...zones]
  const loadingMessage = allZones.length > 500
    ? '조회 범위가 넓어 시간이 걸립니다. 확인한 아파트부터 표시하며 언제든 중단할 수 있습니다.'
    : '도달 가능한 정류장 주변 아파트를 조회하고 있습니다.'
  const nearbyStops = indexStops(graph.stops)
  const places = new Map<string, ApartmentResult | null>()
  let completed = 0, limited = false
  const emit = (status: SearchSnapshot['status'], message: string) => update({ status, message,
    completed, total: allZones.length, limited, results: sortApartments([...places.values()].filter((value): value is ApartmentResult => value !== null)),
    source: graph.source, coverage: graph.coverage })
  emit('loading', loadingMessage)
  try {
    // 검색 범위를 생략하지 않고 순차 조회하며 API 호출 간격을 둔다.
    for (const zone of allZones) {
      signal.throwIfAborted()
      let received = 0
      for (let page = 1; page <= 45; page++) {
        const response = await queryPlaces('아파트', signal, zone, zone.radius, page)
        signal.throwIfAborted()
        received += response.data.length
        for (const data of response.data) {
          if (!/아파트\s*$/.test(data.category_name) || !inServiceArea(data.address_name) || places.has(data.id)) continue
          const place = toPlace(data)
          if (place) places.set(place.id, rankApartment(place, destination, nearbyStops(place), maxMinutes, minMinutes))
        }
        if (!response.more || page === 45) {
          if (response.more || response.total > received) limited = true
          break
        }
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      completed++
      emit('loading', loadingMessage)
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    signal.throwIfAborted()
    emit('complete', '검색을 완료했습니다.')
  } catch (error) {
    if (signal.aborted) throw error
    emit('error', error instanceof Error ? error.message : '아파트 조회를 완료하지 못했습니다.')
  }
}
