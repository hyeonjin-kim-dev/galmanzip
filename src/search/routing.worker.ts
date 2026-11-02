import { createRouter } from './routing.ts'
import { loadNetwork } from './data.ts'
import { createRouteGeometry } from './geometry.ts'
import type { Reachability, RoutingTask } from './types.ts'

let ready: ReturnType<typeof loadNetwork> | undefined
let route: ReturnType<typeof createRouter> | undefined
let geometry: ReturnType<typeof createRouteGeometry> | undefined
let current: { key: string; result: Reachability } | undefined

type Request = RoutingTask & { id: number; url: string }

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const task = event.data
    const network = await (ready ??= loadNetwork(task.url).catch(error => { ready = undefined; throw error }))
    if (task.kind === 'geometry') {
      geometry ??= createRouteGeometry(network)
      self.postMessage({ id: task.id, result: geometry(task.apartment, task.destination) })
      return
    }
    route ??= createRouter(network)
    const key = `${task.destination.lat},${task.destination.lng},${task.minutes}`
    if (current?.key !== key) current = { key, result: route(task.destination, task.minutes) }
    // 지도 영역 조회에는 전체 정류장의 상세 경로를 복제하지 않는다.
    const result = task.kind === 'reach' ? { ...current.result,
      stops: current.result.stops.map(({ id, lat, lng, seconds, boardings }) => ({ id, lat, lng, seconds, boardings })) }
      : task.places.map(place => route!.rank(place, task.destination, task.minMinutes))
    self.postMessage({ id: task.id, result })
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : '경로 계산 중 오류가 발생했습니다.' })
  }
}
