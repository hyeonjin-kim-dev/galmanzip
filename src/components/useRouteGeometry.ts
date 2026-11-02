import { useEffect, useRef, useState } from 'react'
import type { ApartmentResult, Place, RouteGeometry } from '../search/types'
import { routingTask } from '../search/workerClient'

export type Selection = { id: string }
type RouteView = { selection: Selection | null; status: 'idle' | 'loading' | 'ready' | 'error'; geometry?: RouteGeometry; message?: string }

export function useRouteGeometry(selection: Selection | null, destination: Place | null, apartments: ApartmentResult[], searchVersion: number) {
  const cache = useRef(new Map<string, { geometry: RouteGeometry; expires: number }>())
  const [view, setView] = useState<RouteView>({ selection: null, status: 'idle' })
  useEffect(() => { cache.current.clear() }, [destination, searchVersion])
  // 같은 검색의 선택 경로만 메모리에 보관하며 결과가 추가됐다는 이유로 다시 요청하지 않는다.
  useEffect(() => {
    const apartment = apartments.find(apartment => apartment.id === selection?.id)
    if (!selection || !destination || !apartment) { setView({ selection: null, status: 'idle' }); return }
    const cached = cache.current.get(apartment.id)
    if (cached && cached.expires > Date.now()) { setView({ selection, status: 'ready', geometry: cached.geometry }); return }
    const controller = new AbortController()
    setView({ selection, status: 'loading' })
    routingTask<RouteGeometry>({ kind: 'geometry', apartment, destination }, controller.signal).then(geometry => {
      if (controller.signal.aborted) return
      cache.current.set(apartment.id, { geometry, expires: Date.now() + 2 * 3600000 })
      if (cache.current.size > 16) cache.current.delete(cache.current.keys().next().value!)
      setView({ selection, status: 'ready', geometry })
    }).catch(error => {
      if (!controller.signal.aborted) setView({ selection, status: 'error', message: error instanceof Error ? error.message : '경로 선을 표시하지 못했습니다.' })
    })
    return () => controller.abort()
  }, [selection, destination, searchVersion])
  return view.selection === selection ? view : { selection, status: 'loading' as const }
}
