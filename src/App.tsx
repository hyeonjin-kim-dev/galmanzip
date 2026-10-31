import { useState } from 'react'
import type { CSSProperties } from 'react'
import KakaoMap from './components/KakaoMap'
import MapPanel from './components/MapPanel'

export default function App() {
  const [sheetHeight, setSheetHeight] = useState('42%')

  return (
    <main
      className="map-page"
      style={{ '--sheet-height': sheetHeight } as CSSProperties}
    >
      <h1 className="visually-hidden">갈만한 거리의 집</h1>
      <MapPanel onHeightChange={setSheetHeight} />
      <section className="map-viewport" aria-label="지도 영역">
        <KakaoMap />
      </section>
    </main>
  )
}
