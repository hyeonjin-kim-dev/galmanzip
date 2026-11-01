import type { Point } from './types.ts'

export const KAKAO_TRANSIT_URL = 'https://apis-navi.kakaomobility.com/affiliate/publictransit/v1/multimodal/directions'

export interface KakaoJourney {
  seconds: number
  transfers: number
  sections: unknown[]
}

// 제휴 승인 후 결정할 인증 계층을 주입한다. 브라우저 번들에 REST API 키를 넣지 않는다.
export type TransitTransport = (url: URL, signal: AbortSignal) => Promise<Response>

export function transitUrl(origin: Point, destination: Point, dayType: 'Weekday' | 'Saturday' | 'Holiday') {
  for (const point of [origin, destination]) {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
      throw new Error('길찾기 좌표를 확인해 주세요.')
    }
  }
  const url = new URL(KAKAO_TRANSIT_URL)
  url.search = new URLSearchParams({ start: `${origin.lng},${origin.lat}`, goal: `${destination.lng},${destination.lat}`,
    route_type: 'All', day_type: dayType }).toString()
  return url
}

export function readJourneys(value: unknown): KakaoJourney[] {
  if (!value || typeof value !== 'object') throw new Error('카카오 길찾기 응답 형식이 올바르지 않습니다.')
  const data = value as { result_code?: unknown; journeys?: unknown }
  if (data.result_code !== 0) throw new Error('카카오 길찾기에서 경로를 조회하지 못했습니다.')
  if (!Array.isArray(data.journeys) || !data.journeys.length) throw new Error('카카오 길찾기 응답에 경로가 없습니다.')
  return data.journeys.map(value => {
    const summary = value?.summary
    if (!Number.isInteger(summary?.total_time) || summary.total_time < 0
      || !Number.isInteger(summary?.transfer_count) || summary.transfer_count < 0
      || !Array.isArray(value.sections) || !value.sections.length) throw new Error('카카오 길찾기 경로 정보가 올바르지 않습니다.')
    // API가 제공한 총시간·환승 횟수를 그대로 사용한다. 구간을 합산하거나 대기 시간을 덧붙이지 않는다.
    return { seconds: summary.total_time, transfers: summary.transfer_count, sections: value.sections }
  })
}

export function pickJourney(journeys: KakaoJourney[], minMinutes: number, maxMinutes: number) {
  if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes) || minMinutes < 0 || maxMinutes < minMinutes) {
    throw new Error('소요 시간 범위를 확인해 주세요.')
  }
  const best = [...journeys].sort((a, b) => a.seconds - b.seconds || a.transfers - b.transfers)[0]
  return best && best.seconds >= minMinutes * 60 && best.seconds <= maxMinutes * 60 ? best : null
}

export async function requestTransit(origin: Point, destination: Point, dayType: 'Weekday' | 'Saturday' | 'Holiday',
  signal: AbortSignal, transport: TransitTransport) {
  signal.throwIfAborted()
  const url = transitUrl(origin, destination, dayType)
  let response: Response
  try { response = await transport(url, signal) }
  catch {
    signal.throwIfAborted()
    throw new Error('카카오 길찾기에 연결하지 못했습니다.')
  }
  signal.throwIfAborted()
  if ([401, 403].includes(response.status)) throw new Error('카카오 길찾기 인증 또는 사용 승인을 확인해야 합니다.')
  if (response.status === 429) throw new Error('카카오 길찾기 이용 한도에 도달했습니다.')
  if (!response.ok) throw new Error('카카오 길찾기를 불러오지 못했습니다.')
  let data: unknown
  try { data = await response.json() }
  catch { throw new Error('카카오 길찾기 응답을 읽지 못했습니다.') }
  signal.throwIfAborted()
  return readJourneys(data)
}
