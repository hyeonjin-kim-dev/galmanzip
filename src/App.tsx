import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import KakaoMap from './components/KakaoMap'
import MapPanel from './components/MapPanel'
import DestinationSearch from './components/DestinationSearch'
import ApartmentResults from './components/ApartmentResults'
import { searchApartments } from './search/search'
import type { Place, SearchSnapshot } from './search/types'

const emptySearch: SearchSnapshot = { status: 'idle', results: [], message: '', completed: 0, total: 0, limited: false }

export default function App() {
  const [sheetHeight, setSheetHeight] = useState('42%')
  const [snapshot, setSnapshot] = useState<SearchSnapshot>(emptySearch)
  const [destination, setDestination] = useState<Place | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchVersion, setSearchVersion] = useState(0)
  const searchRef = useRef<AbortController | null>(null)

  useEffect(() => () => searchRef.current?.abort(), [])

  const reset = () => {
    searchRef.current?.abort()
    setSnapshot(emptySearch)
    setDestination(null)
    setSelectedId(null)
  }

  const search = async (place: Place, minutes: number) => {
    searchRef.current?.abort()
    const controller = new AbortController()
    searchRef.current = controller
    setDestination(place)
    setSelectedId(null)
    setSearchVersion(version => version + 1)
    setSnapshot({ ...emptySearch, status: 'loading', message: '목적지까지 도달 가능한 경로를 계산하고 있습니다.' })
    try {
      await searchApartments(place, minutes, controller.signal, next => {
        if (!controller.signal.aborted) setSnapshot(next)
      })
    } catch (error) {
      if (!controller.signal.aborted) setSnapshot(current => ({ ...current, status: 'error',
        message: error instanceof Error ? error.message : '검색을 완료하지 못했습니다.' }))
    }
  }

  const cancel = () => {
    searchRef.current?.abort()
    setSnapshot(current => ({ ...current, status: 'cancelled', message: '검색을 중단했습니다.' }))
  }

  return (
    <main
      className="map-page"
      style={{ '--sheet-height': sheetHeight } as CSSProperties}
    >
      <h1 className="visually-hidden">갈만한 거리의 집</h1>
      <MapPanel onHeightChange={setSheetHeight} searchVersion={searchVersion}
        search={<DestinationSearch busy={snapshot.status === 'loading'} onSearch={search} onReset={reset} onCancel={cancel} />}>
        <ApartmentResults key={searchVersion} snapshot={snapshot} destination={destination} selectedId={selectedId} onSelect={setSelectedId} />
      </MapPanel>
      <section className="map-viewport" aria-label="지도 영역">
        <KakaoMap results={snapshot.results} destination={destination} selectedId={selectedId}
          fitResults={snapshot.status !== 'loading' && selectedId === null} onSelect={setSelectedId} />
      </section>
    </main>
  )
}
