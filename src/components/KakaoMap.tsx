import { useEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from '../lib/kakaoMaps'

const appKey = import.meta.env.VITE_KAKAO_MAP_KEY?.trim()

type MapStatus = 'loading' | 'ready' | 'missing-key' | 'error'

export default function KakaoMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<MapStatus>(appKey ? 'loading' : 'missing-key')

  useEffect(() => {
    const container = containerRef.current

    if (!appKey || !container) {
      return
    }

    let active = true
    let observer: ResizeObserver | undefined

    loadKakaoMaps(appKey)
      .then((maps) => {
        if (!active) {
          return
        }

        const map = new maps.Map(container, {
          center: new maps.LatLng(37.5665, 126.978),
          level: 8,
        })

        observer = new ResizeObserver(() => {
          const center = map.getCenter()
          map.relayout()
          map.setCenter(center)
        })
        observer.observe(container)
        setStatus('ready')
      })
      .catch(() => {
        if (active) {
          setStatus('error')
        }
      })

    return () => {
      active = false
      observer?.disconnect()
      container.replaceChildren()
    }
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        className="map-canvas"
        role="region"
        aria-label="서울·경기도 지도"
        aria-busy={status === 'loading'}
      />
      {status !== 'ready' && (
        <div className="map-status" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'loading' && <p>지도를 불러오고 있습니다.</p>}
          {status === 'missing-key' && (
            <>
              <p>지도 연결을 준비하고 있습니다.</p>
              <span>Kakao 지도 연결 설정이 필요합니다.</span>
            </>
          )}
          {status === 'error' && (
            <>
              <p>지도를 불러오지 못했습니다.</p>
              <span>연결 상태를 확인한 뒤 다시 시도해 주세요.</span>
              <button type="button" onClick={() => window.location.reload()}>
                다시 시도
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
