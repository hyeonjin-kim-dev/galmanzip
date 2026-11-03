import { createRouter } from './routing.ts'
import { loadNetwork } from './data.ts'
import { createRouteGeometry } from './geometry.ts'
import { createBusShapeLoader } from './busShapes.ts'
import { createSearchPlanner } from './planner.ts'
import type { Reachability, RoutingTask } from './types.ts'

let ready: ReturnType<typeof loadNetwork> | undefined
let route: ReturnType<typeof createRouter> | undefined
let geometry: ReturnType<typeof createRouteGeometry> | undefined
let busShapes: ReturnType<typeof createBusShapeLoader> | undefined
let current: { key: string; result: Reachability } | undefined
let search: { id: number; destination: Extract<RoutingTask, { kind: 'plan' }>['destination'];
  planner: ReturnType<typeof createSearchPlanner>; seen: Set<string> } | undefined

type Request = RoutingTask & { id: number; url: string }

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const task = event.data
    const network = await (ready ??= loadNetwork(task.url).catch(error => { ready = undefined; throw error }))
    if (task.kind === 'geometry') {
      geometry ??= createRouteGeometry(network)
      busShapes ??= createBusShapeLoader(network, task.url)
      const shapes = await busShapes(task.apartment)
      self.postMessage({ id: task.id, result: geometry(task.apartment, task.destination, shapes) })
      return
    }
    if (task.kind === 'plan') {
      route ??= createRouter(network)
      const key = `${task.destination.lat},${task.destination.lng},${task.minutes},${task.maxTransfers}`
      if (current?.key !== key) current = { key, result: route(task.destination, task.minutes, task.maxTransfers) }
      if (!current.result.stops.length) throw new Error('목적지 주변에서 자료에 포함된 정류장을 찾지 못했습니다.')
      const planner = createSearchPlanner(current.result, task.destination, task.minutes, task.bounds)
      search = { id: task.session, destination: task.destination, planner, seen: new Set() }
      self.postMessage({ id: task.id, result: { ...planner.progress(), initialArea: planner.initialArea,
        source: current.result.source, coverage: current.result.coverage } })
      return
    }
    if (!search || search.id !== task.session) throw new Error('종료된 검색입니다. 다시 검색해 주세요.')
    if (task.kind === 'next') {
      self.postMessage({ id: task.id, result: search.planner.next(task.bounds) })
      return
    }
    search.planner.accept(task.area, task.page)
    const added = []
    for (const place of task.places) {
      if (search.seen.has(place.id)) continue
      search.seen.add(place.id)
      const result = route!.rank(place, search.destination, task.minMinutes)
      if (result) added.push(result)
    }
    const result = { ...search.planner.progress(), added }
    self.postMessage({ id: task.id, result })
  } catch (error) {
    self.postMessage({ id: event.data.id, error: error instanceof Error ? error.message : '경로 계산 중 오류가 발생했습니다.' })
  }
}
