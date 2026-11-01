import { loadAppMaps } from '../lib/kakaoMaps'
import type { PlaceData } from '../lib/kakaoMaps'
import type { Place, Point } from './types'

export const inServiceArea = (address: string) => /^(서울(?:특별시)?|경기(?:도)?)\s/.test(address)
export function toPlace(data: PlaceData): Place | null {
  const lat = Number(data.y), lng = Number(data.x)
  if (!data.id || !data.place_name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { id: data.id, name: data.place_name, address: data.road_address_name || data.address_name,
    lat, lng, url: `https://place.map.kakao.com/${encodeURIComponent(data.id)}` }
}

export async function queryPlaces(query: string, signal: AbortSignal, point?: Point, radius?: number, page = 1) {
  signal.throwIfAborted()
  const maps = await loadAppMaps()
  signal.throwIfAborted()
  return new Promise<{ data: PlaceData[]; more: boolean; total: number }>((resolve, reject) => {
    let done = false
    const finish = (error?: Error, result?: { data: PlaceData[]; more: boolean; total: number }) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result!)
    }
    const abort = () => finish(new DOMException('검색을 취소했습니다.', 'AbortError'))
    const timer = window.setTimeout(() => finish(new Error('장소 검색 응답이 늦어지고 있습니다. 다시 시도해 주세요.')), 15000)
    signal.addEventListener('abort', abort, { once: true })
    try {
      new maps.services.Places().keywordSearch(query, (data, status, pagination) => {
        if (status === maps.services.Status.ZERO_RESULT) finish(undefined, { data: [], more: false, total: 0 })
        else if (status !== maps.services.Status.OK) finish(new Error('장소 검색을 완료하지 못했습니다. 이용 한도 또는 연결 상태를 확인해 주세요.'))
        else finish(undefined, { data, more: pagination.hasNextPage, total: pagination.totalCount })
      }, { page, size: 15, ...(point ? { location: new maps.LatLng(point.lat, point.lng), radius, sort: maps.services.SortBy.DISTANCE } : {}) })
    } catch { finish(new Error('장소 검색을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.')) }
  })
}
