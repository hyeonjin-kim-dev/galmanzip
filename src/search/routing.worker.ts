import { findReachableStops, validateNetwork } from './routing.ts'
import type { Point } from './types.ts'

self.onmessage = async (event: MessageEvent<{ destination: Point; minutes: number; url: string }>) => {
  try {
    const response = await fetch(event.data.url)
    if (!response.ok) throw new Error('교통 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    const network = validateNetwork(await response.json())
    const result = findReachableStops(network, event.data.destination, event.data.minutes)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '경로 계산 중 오류가 발생했습니다.' })
  }
}
