import type { ApartmentResult } from './types.ts'

export const resultGroups = [
  { key: 'rail', label: '환승 0회 · 지하철' },
  { key: 'express', label: '환승 0회 · 빨간 좌석버스' },
  { key: 'bus', label: '환승 0회 · 기타 버스' },
  { key: 'walk', label: '도보' },
  { key: 'transfer', label: '환승 1회 이상' },
] as const
export type ResultGroup = typeof resultGroups[number]['key']

export function resultGroup(result: ApartmentResult): ResultGroup {
  if (result.transfers > 0) return 'transfer'
  const vehicle = result.legs.find(leg => leg.mode !== 'walk')
  if (!vehicle) return 'walk'
  if (vehicle.mode === 'rail') return 'rail'
  // 노선 번호나 임의의 색 추측 대신 원본 교통 자료의 버스 분류를 사용한다.
  return vehicle.typeName === '직행좌석' || vehicle.typeName === '광역' ? 'express' : 'bus'
}

const priorities = Object.fromEntries(resultGroups.map(({ key }, index) => [key, index])) as Record<ResultGroup, number>
export const compareResultGroups = (a: ApartmentResult, b: ApartmentResult) => priorities[resultGroup(a)] - priorities[resultGroup(b)]
