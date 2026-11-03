import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import KakaoMap from './components/KakaoMap'
import MapPanel from './components/MapPanel'
import DestinationSearch from './components/DestinationSearch'
import ApartmentResults from './components/ApartmentResults'
import { searchApartments } from './search/search'
import { around, sameBounds } from './search/bounds'
import type { Bounds } from './search/bounds'
import { initialView, isViewLoading, viewReducer } from './search/view'
import type { Place } from './search/types'

export default function App() {
  const [sheetHeight, setSheetHeight] = useState('42%')
  const [view, dispatch] = useReducer(viewReducer, initialView)
  const snapshot = view.snapshot
  const viewportRef = useRef<Bounds | null>(null)
  const onViewport = useCallback((bounds: Bounds) => {
    if (sameBounds(viewportRef.current, bounds)) return
    viewportRef.current = bounds
    dispatch({ type: 'bounds', bounds })
  }, [])
  const [destination, setDestination] = useState<Place | null>(null)
  const [selection, setSelection] = useState<{ id: string } | null>(null)
  const selectedId = selection?.id ?? null
  const select = useCallback((id: string) => setSelection({ id }), [])
  const [searchVersion, setSearchVersion] = useState(0)
  const [searchMinutes, setSearchMinutes] = useState(20)
  const searchRef = useRef<AbortController | null>(null)

  useEffect(() => () => searchRef.current?.abort(), [])

  const reset = () => {
    searchRef.current?.abort()
    dispatch({ type: 'reset' })
    setDestination(null)
    setSelection(null)
  }

  const search = async (place: Place, minMinutes: number, maxMinutes: number, maxTransfers: number) => {
    searchRef.current?.abort()
    const controller = new AbortController()
    searchRef.current = controller
    setDestination(place)
    setSelection(null)
    setSearchVersion(version => version + 1)
    setSearchMinutes(maxMinutes)
    const bounds = around(place, maxMinutes)
    viewportRef.current = bounds
    dispatch({ type: 'begin', bounds })
    try {
      // 먼저 지도의 목적지 이동과 첫 화면을 반영한 뒤 조회를 시작한다.
      await new Promise(resolve => setTimeout(resolve, 0))
      controller.signal.throwIfAborted()
      await searchApartments(place, minMinutes, maxMinutes, controller.signal, next => {
        if (!controller.signal.aborted) dispatch({ type: 'snapshot', snapshot: next })
      }, () => viewportRef.current, maxTransfers)
    } catch (error) {
      if (!controller.signal.aborted) dispatch({ type: 'snapshot', snapshot: { ...initialView.snapshot, status: 'error',
        message: error instanceof Error ? error.message : '검색을 완료하지 못했습니다.' } })
    }
  }

  const cancel = () => {
    searchRef.current?.abort()
    dispatch({ type: 'cancel' })
  }

  return (
    <main
      className="map-page"
      style={{ '--sheet-height': sheetHeight } as CSSProperties}
    >
      <h1 className="visually-hidden">갈만한 거리의 집</h1>
      <MapPanel onHeightChange={setSheetHeight} searchVersion={searchVersion} selection={selection}
        search={<DestinationSearch busy={snapshot.status === 'loading'} onSearch={search} onReset={reset} onCancel={cancel} />}>
        <ApartmentResults key={searchVersion} snapshot={snapshot} results={view.results} viewLoading={isViewLoading(view)}
          onSort={() => dispatch({ type: 'sort' })} destination={destination} selectedId={selectedId} onSelect={select} />
      </MapPanel>
      <section className="map-viewport" aria-label="지도 영역">
        <KakaoMap results={view.results} allResults={snapshot.results} searchVersion={searchVersion} maxMinutes={searchMinutes} onViewport={onViewport} destination={destination} selection={selection}
          onSelect={select} />
      </section>
    </main>
  )
}
