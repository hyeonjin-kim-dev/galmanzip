import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from '../lib/kakaoMaps'
import type { MapCluster, MapInstance, MapMarker, MapsSdk } from '../lib/kakaoMaps'
import type { Bounds } from '../search/bounds'
import { destinationLevel } from '../search/bounds'
import type { ApartmentResult, Place } from '../search/types'

const appKey = import.meta.env.VITE_KAKAO_MAP_KEY?.trim()

type MapStatus = 'loading' | 'ready' | 'missing-key' | 'error'

interface KakaoMapProps {
  results: ApartmentResult[]
  destination: Place | null
  selectedId: string | null
  allResults: ApartmentResult[]
  searchVersion: number
  maxMinutes: number
  onViewport(bounds: Bounds): void
  onSelect(id: string): void
}

export default function KakaoMap({ results, destination, selectedId, allResults, searchVersion, maxMinutes, onViewport, onSelect }: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<MapStatus>(appKey ? 'loading' : 'missing-key')
  const [context, setContext] = useState<{ maps: MapsSdk; map: MapInstance } | null>(null)
  const clustererRef = useRef<InstanceType<MapsSdk['MarkerClusterer']> | null>(null)
  const markerIdsRef = useRef(new Map<MapMarker, string>())
  const markersRef = useRef(new Map<string, MapMarker>())

  useEffect(() => {
    const container = containerRef.current

    if (!appKey || !container) {
      return
    }

    let active = true
    let observer: ResizeObserver | undefined
    let stopListening: (() => void) | undefined

    loadKakaoMaps(appKey)
      .then((maps) => {
        if (!active) {
          return
        }

        const map = new maps.Map(container, {
          center: new maps.LatLng(37.3851, 127.1233), // 서현역
          level: 8,
        })

        let timer: number | undefined
        const changed = () => { window.clearTimeout(timer); timer = window.setTimeout(() => onViewport(readBounds(map)), 100) }
        maps.event.addListener(map, 'idle', changed)
        stopListening = () => { window.clearTimeout(timer); maps.event.removeListener(map, 'idle', changed) }
        observer = new ResizeObserver(() => {
          const center = map.getCenter()
          map.relayout()
          map.setCenter(center)
          changed()
        })
        observer.observe(container)
        setContext({ maps, map })
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
      stopListening?.()
      container.replaceChildren()
    }
  }, [onViewport])

  useEffect(() => {
    if (!context) return
    const { maps, map } = context
    const clusterer = new maps.MarkerClusterer({ map, gridSize: 64, averageCenter: true,
      minLevel: 0, minClusterSize: 1, disableClickZoom: true, texts: size => String(size),
      calculator: [Number.MAX_SAFE_INTEGER],
      styles: [{ width: '44px', height: '44px', background: '#000000', color: '#ffffff',
        borderRadius: '50%', textAlign: 'center', lineHeight: '44px', fontSize: '16px',
        fontWeight: '600', cursor: 'pointer' }] })
    clustererRef.current = clusterer
    const click = (cluster: MapCluster) => {
      const markers = cluster.getMarkers()
      if (markers.length === 1) {
        const id = markerIdsRef.current.get(markers[0])
        if (id) onSelect(id)
      } else map.setBounds(cluster.getBounds(), 80, 40, 40, 40)
    }
    maps.event.addListener(clusterer, 'clusterclick', click)
    return () => {
      maps.event.removeListener(clusterer, 'clusterclick', click)
      clusterer.clear()
      clustererRef.current = null
      markerIdsRef.current.clear()
      markersRef.current.clear()
    }
  }, [context, onSelect])

  useEffect(() => {
    if (!context || !destination) return
    const { maps, map } = context
    const position = new maps.LatLng(destination.lat, destination.lng)
    const content = document.createElement('span')
    content.className = 'destination-marker'
    content.textContent = '목적지'
    content.title = destination.name
    const overlay = new maps.CustomOverlay({ position, content, yAnchor: 1.5, zIndex: 2 })
    overlay.setMap(map)
    return () => overlay.setMap(null)
  }, [context, destination])

  useEffect(() => {
    const clusterer = clustererRef.current
    if (!context || !clusterer) return
    const { maps, map } = context
    const ids = new Set(results.map(result => result.id))
    const removed: MapMarker[] = []
    for (const [id, marker] of markersRef.current) if (!ids.has(id)) {
      removed.push(marker)
      markersRef.current.delete(id)
      markerIdsRef.current.delete(marker)
    }
    if (removed.length) clusterer.removeMarkers(removed, true)
    const added: MapMarker[] = []
    for (const result of results) {
      if (markersRef.current.has(result.id)) continue
      const position = new maps.LatLng(result.lat, result.lng)
      const marker = new maps.Marker({ position, title: result.name })
      markerIdsRef.current.set(marker, result.id)
      markersRef.current.set(result.id, marker)
      added.push(marker)
    }
    if (added.length) clusterer.addMarkers(added, true)
    if (added.length || removed.length) clusterer.redraw()
  }, [context, results])

  const focusDestination = () => {
    if (!context || !destination) return
    context.map.setLevel(destinationLevel(maxMinutes))
    context.map.setCenter(new context.maps.LatLng(destination.lat, destination.lng))
    onViewport(readBounds(context.map))
  }
  useLayoutEffect(() => { focusDestination() }, [context, destination, searchVersion, maxMinutes, onViewport])

  const selected = results.find(result => result.id === selectedId)
  useEffect(() => {
    if (!context || !selected) return
    const content = document.createElement('span')
    content.className = 'selected-apartment-marker'
    content.textContent = selected.name
    const overlay = new context.maps.CustomOverlay({ position: new context.maps.LatLng(selected.lat, selected.lng), content, yAnchor: 1.6, zIndex: 3 })
    overlay.setMap(context.map)
    return () => overlay.setMap(null)
  }, [context, selected])

  const showAll = () => {
    if (!context || !allResults.length) return
    const bounds = new context.maps.LatLngBounds()
    for (const result of allResults) bounds.extend(new context.maps.LatLng(result.lat, result.lng))
    if (destination) bounds.extend(new context.maps.LatLng(destination.lat, destination.lng))
    context.map.setBounds(bounds, 48, 48, 48, 48)
  }


  return (
    <>
      <div
        ref={containerRef}
        className="map-canvas"
        role="region"
        aria-label="서울·경기도 지도"
        aria-busy={status === 'loading'}
      />
      {status === 'ready' && <div className="map-controls" role="group" aria-label="지도 조작">
        <div className="map-zoom-controls">
          <button type="button" aria-label="지도 확대" onClick={() => context?.map.setLevel(Math.max(1, context.map.getLevel() - 1))}>＋</button>
          <button type="button" aria-label="지도 축소" onClick={() => context?.map.setLevel(Math.min(14, context.map.getLevel() + 1))}>−</button>
        </div>
        {destination && <button type="button" onClick={focusDestination}>목적지로</button>}
        {allResults.length > 0 && <button type="button" onClick={showAll}>찾은 집 모두 보기</button>}
      </div>}
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

function readBounds(map: MapInstance): Bounds {
  const bounds = map.getBounds(), sw = bounds.getSouthWest(), ne = bounds.getNorthEast()
  return { south: sw.getLat(), west: sw.getLng(), north: ne.getLat(), east: ne.getLng() }
}
