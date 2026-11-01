import { findReachableStops } from './routing.ts'
import { loadNetwork } from './data.ts'
import type { Point } from './types.ts'

self.onmessage = async (event: MessageEvent<{ destination: Point; minutes: number; url: string }>) => {
  try {
    const network = await loadNetwork(event.data.url)
    const result = findReachableStops(network, event.data.destination, event.data.minutes)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '경로 계산 중 오류가 발생했습니다.' })
  }
}
