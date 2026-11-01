import { createRouter } from './routing.ts'
import { loadNetwork } from './data.ts'
import type { Point } from './types.ts'

let ready: Promise<ReturnType<typeof createRouter>> | undefined

self.onmessage = async (event: MessageEvent<{ destination: Point; minutes: number; url: string }>) => {
  try {
    const route = await (ready ??= loadNetwork(event.data.url).then(createRouter))
    const result = route(event.data.destination, event.data.minutes)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '경로 계산 중 오류가 발생했습니다.' })
  }
}
