import { nextZoneIndex, partitionZone, searchZones, splitZone } from './zones.ts'
import type { SearchZone } from './zones.ts'
import type { Bounds } from './bounds.ts'
import type { AreaPage, Point, ReachabilitySummary, SearchArea, SearchProgress } from './types.ts'

type Task = { zone: SearchZone; page: number; received: number }
const boundsOf = ({ south, west, north, east }: Bounds): Bounds => ({ south, west, north, east })

// 분할에 쓰는 정류장 영역은 Worker 안에 두고 화면에는 작은 조회 영역만 전달한다.
export function createSearchPlanner(graph: ReachabilitySummary, destination: Point, minutes: number, initialBounds: Bounds | null) {
  const pending: Task[] = []
  const active = new Map<number, Task>()
  let sequence = 0, completed = 0, limited = false
  const foreground: SearchZone[] = []
  for (const root of searchZones(graph.stops, destination, minutes)) {
    if (initialBounds) {
      const parts = partitionZone(root, initialBounds)
      if (parts.inside) foreground.push(parts.inside)
      pending.push(...parts.outside.map(zone => ({ zone, page: 1, received: 0 })))
    } else pending.push({ zone: root, page: 1, received: 0 })
  }
  const activate = (task: Task): SearchArea => {
    const id = ++sequence
    active.set(id, task)
    return { id, bounds: boundsOf(task.zone), page: task.page }
  }
  const initialArea = initialBounds && foreground.length ? activate({
    zone: { ...initialBounds, depth: 0, priority: 0, coverage: foreground.flatMap(zone => zone.coverage) },
    page: 1, received: 0,
  }) : undefined
  let total = pending.length + active.size

  return {
    initialArea,
    progress(): SearchProgress {
      return { completed, total, limited, pendingAreas: [...pending, ...active.values()].map(task => boundsOf(task.zone)) }
    },
    next(view: Bounds | null): SearchArea | undefined {
      if (!pending.length) return
      const index = nextZoneIndex(pending.map(task => task.zone), view, destination)
      const task = pending.splice(index, 1)[0]
      if (view && task.page === 1) {
        const parts = partitionZone(task.zone, view)
        if (parts.inside) {
          task.zone = parts.inside
          pending.push(...parts.outside.map(zone => ({ zone, page: 1, received: 0 })))
          total += parts.outside.length
        }
      }
      return activate(task)
    },
    accept(id: number, response: AreaPage) {
      const task = active.get(id)
      if (!task) throw new Error('이미 처리했거나 종료된 조회 영역입니다.')
      active.delete(id)
      const received = task.received + response.count
      const capped = response.total >= 45 || response.total > received
      if (!response.count && response.more) {
        limited = true
        completed++
      } else if ((task.page === 1 && response.total >= 45) || !response.more || task.page === 45) {
        const children = capped || response.more ? splitZone(task.zone) : []
        if (children.length) {
          pending.push(...children.map(zone => ({ zone, page: 1, received: 0 })))
          total += children.length
        } else if (capped || response.more) limited = true
        completed++
      } else pending.push({ zone: task.zone, page: task.page + 1, received })
    },
  }
}
