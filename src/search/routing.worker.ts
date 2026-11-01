import { createRouter } from './routing.ts'
import { loadNetwork } from './data.ts'
import type { Place, Reachability } from './types.ts'

let ready: Promise<ReturnType<typeof createRouter>> | undefined
let current: { key: string; result: Reachability } | undefined

type Request = { kind: 'reach' | 'rank'; destination: Place; minutes: number; url: string; places?: Place[]; minMinutes?: number }

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const task = event.data
    const route = await (ready ??= loadNetwork(task.url).then(createRouter))
    const key = `${task.destination.lat},${task.destination.lng},${task.minutes}`
    if (current?.key !== key) current = { key, result: route(task.destination, task.minutes) }
    const result = task.kind === 'reach' ? current.result
      : (task.places ?? []).map(place => route.rank(place, task.destination, task.minMinutes))
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '경로 계산 중 오류가 발생했습니다.' })
  }
}
