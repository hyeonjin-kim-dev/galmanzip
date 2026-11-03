import { contains, intersects, sameBounds } from './bounds.ts'
import type { Bounds } from './bounds.ts'
import { sortApartments } from './routing.ts'
import { compareResultGroups } from './resultOrder.ts'
import type { ApartmentResult, SearchSnapshot } from './types.ts'

export const emptySearch: SearchSnapshot = { status: 'idle', results: [], message: '', completed: 0, total: 0, limited: false }
export interface SearchView { snapshot: SearchSnapshot; bounds: Bounds | null; results: ApartmentResult[] }
export const initialView: SearchView = { snapshot: emptySearch, bounds: null, results: [] }
type Action = { type: 'snapshot'; snapshot: SearchSnapshot } | { type: 'bounds'; bounds: Bounds }
  | { type: 'begin'; bounds: Bounds } | { type: 'reset' } | { type: 'sort' } | { type: 'cancel' }

function appendVisible(previous: ApartmentResult[], all: ApartmentResult[], bounds: Bounds | null) {
  // 한 번 목록에 표시한 집은 지도 밖으로 나가도 유지한다. 검색 초기화 때만 목록을 비운다.
  const available = new Map(all.filter(result => bounds && contains(bounds, result)).map(result => [result.id, result]))
  const ids = new Set(previous.map(result => result.id))
  const added = [...available.values()].filter(result => !ids.has(result.id))
  if (!added.length) return previous
  return [...previous, ...sortApartments(added)].sort(compareResultGroups)
}

export function viewReducer(view: SearchView, action: Action): SearchView {
  switch (action.type) {
    case 'snapshot': return { ...view, snapshot: action.snapshot,
      results: action.snapshot.results === view.snapshot.results ? view.results
        : appendVisible(view.results, action.snapshot.results, view.bounds) }
    case 'bounds': return sameBounds(view.bounds, action.bounds) ? view : { ...view, bounds: action.bounds,
      results: appendVisible(view.results, view.snapshot.results, action.bounds) }
    case 'sort': return { ...view, results: sortApartments([...view.results]) }
    case 'begin': return { bounds: action.bounds, results: [], snapshot: { ...emptySearch, status: 'loading', message: '지도 주변의 집을 찾고 있어요.' } }
    case 'reset': return { ...initialView, bounds: view.bounds }
    case 'cancel': return { ...view, snapshot: { ...view.snapshot, status: 'cancelled', message: '검색을 중단했습니다.' } }
  }
}

export const isViewLoading = (view: SearchView) => view.snapshot.status === 'loading'
  && (!view.bounds || !view.snapshot.pendingAreas || view.snapshot.pendingAreas.some(area => intersects(area, view.bounds!)))
