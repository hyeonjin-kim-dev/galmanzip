import type { Place, SearchSnapshot } from './types'

export const TRANSIT_SEARCH_READY = false
export const TRANSIT_SETUP_MESSAGE = '카카오 대중교통 길찾기 연동을 준비하고 있습니다. 경로 검색은 현재 이용할 수 없습니다.'

// 제휴 승인·무료 이용 조건·인증 경로 확인 전에는 자체 계산으로 대체하지 않는다.
export async function searchApartments(_destination: Place, _minMinutes: number, _maxMinutes: number,
  signal: AbortSignal, _update: (snapshot: SearchSnapshot) => void): Promise<void> {
  signal.throwIfAborted()
  throw new Error(TRANSIT_SETUP_MESSAGE)
}
