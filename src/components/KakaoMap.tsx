import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { loadKakaoMaps } from '../lib/kakaoMaps'
import type { MapCluster, MapInstance, MapMarker, MapsSdk } from '../lib/kakaoMaps'
import type { Bounds } from '../search/bounds'
import { destinationLevel } from '../search/bounds'
import type { ApartmentResult, Place } from '../search/types'
import { routeAppearance } from '../lib/routePresentation'
import { useRouteGeometry } from './useRouteGeometry'

const appKey = import.meta.env.VITE_KAKAO_MAP_KEY?.trim()

type MapStatus = 'loading' | 'ready' | 'missing-key' | 'error'

interface KakaoMapProps {
  results: ApartmentResult[]
  destination: Place | null
  selection: { id: string } | null
  allResults: ApartmentResult[]
  searchVersion: number
  maxMinutes: number
  onViewport(bounds: Bounds): void
  onSelect(id: string): void
}

export default function KakaoMap({ results, destination, selection, allResults, searchVersion, maxMinutes, onViewport, onSelect }: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<MapStatus>(appKey ? 'loading' : 'missing-key')
  const [context, setContext] = useState<{ maps: MapsSdk; map: MapInstance } | null>(null)
  const clustererRef = useRef<InstanceType<MapsSdk['MarkerClusterer']> | null>(null)
  const markerIdsRef = useRef(new Map<MapMarker, string>())
  const markersRef = useRef(new Map<string, MapMarker>())
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const cancelledFocusRef = useRef<typeof selection>(null)
  const selected = allResults.find(result => result.id === selection?.id)
  const routeView = useRouteGeometry(selection, destination, allResults, searchVersion)
  const resolvedRoute = routeView.status === 'ready' || routeView.status === 'error' ? routeView : undefined
  const geometry = routeView.status === 'ready' ? routeView.geometry : undefined

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
        const interacted = () => { cancelledFocusRef.current = selectionRef.current }
        maps.event.addListener(map, 'dragstart', interacted)
        maps.event.addListener(map, 'zoom_start', interacted)
        stopListening = () => {
          window.clearTimeout(timer)
          maps.event.removeListener(map, 'idle', changed)
          maps.event.removeListener(map, 'dragstart', interacted)
          maps.event.removeListener(map, 'zoom_start', interacted)
        }
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
      cancelledFocusRef.current = selectionRef.current
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
    const overlay = new maps.CustomOverlay({ position, content, yAnchor: 1.5, zIndex: 7 })
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
    cancelledFocusRef.current = selectionRef.current
    context.map.setLevel(destinationLevel(maxMinutes))
    context.map.setCenter(new context.maps.LatLng(destination.lat, destination.lng))
    onViewport(readBounds(context.map))
  }
  useLayoutEffect(() => { focusDestination() }, [context, destination, searchVersion, maxMinutes, onViewport])

  // 결과 갱신과 구분해, 같은 항목을 다시 누른 경우에도 사용자 선택마다 이동한다.
  useEffect(() => {
    if (!context || !selection || !destination || !resolvedRoute) return
    const apartment = allResults.find(result => result.id === selection.id)
    if (!apartment) return
    const mobile = window.matchMedia('(max-width: 767px)').matches
    const timer = window.setTimeout(() => {
      const container = containerRef.current
      if (!container || cancelledFocusRef.current === selection) return
      const page = container.closest('.map-page')
      const frame = container.getBoundingClientRect()
      const search = page?.querySelector('.destination-search')?.getBoundingClientRect()
      const controls = page?.querySelector('.map-controls')?.getBoundingClientRect()
      const information = page?.querySelector('.map-route-info')?.getBoundingClientRect()
      const top = Math.max(64, mobile && search ? search.bottom - frame.top + 48 : 0,
        information ? information.bottom - frame.top + 48 : 0)
      const right = Math.max(48, (controls?.width ?? 0) + 24)
      const bounds = new context.maps.LatLngBounds()
      bounds.extend(new context.maps.LatLng(apartment.lat, apartment.lng))
      bounds.extend(new context.maps.LatLng(destination.lat, destination.lng))
      for (const segment of resolvedRoute.geometry?.segments ?? []) for (const point of segment.points) {
        bounds.extend(new context.maps.LatLng(point.lat, point.lng))
      }
      context.map.relayout()
      context.map.setBounds(bounds, Math.min(top, frame.height * 0.6), Math.min(right, frame.width * 0.45), 48, 48)
    }, mobile ? 220 : 0)
    // 모바일 패널이 줄어드는 전환이 끝난 뒤 실제 지도 크기에 맞춘다.
    return () => window.clearTimeout(timer)
  }, [context, selection, destination, resolvedRoute])

  useEffect(() => {
    if (!context || !selected) return
    const content = document.createElement('span')
    content.className = 'selected-apartment-marker'
    content.textContent = selected.name
    const overlay = new context.maps.CustomOverlay({ position: new context.maps.LatLng(selected.lat, selected.lng), content, yAnchor: 1.6, zIndex: 8 })
    overlay.setMap(context.map)
    return () => overlay.setMap(null)
  }, [context, selected])

  useEffect(() => {
    if (!context || !selected || !geometry) return
    const { maps, map } = context
    const appearances = routeAppearance(selected.legs)
    const overlays: { setMap(map: MapInstance | null): void }[] = []
    for (const busLine of geometry.busLines) {
      const line = new maps.Polyline({ path: busLine.points.map(point => new maps.LatLng(point.lat, point.lng)),
        strokeWeight: 5, strokeColor: appearances[busLine.legIndex].color, strokeOpacity: .22,
        strokeStyle: 'solid', endArrow: false, zIndex: 1 })
      line.setMap(map)
      overlays.push(line)
    }
    for (const segment of geometry.segments) {
      const leg = selected.legs[segment.legIndex], appearance = appearances[segment.legIndex]
      const path = segment.points.map(point => new maps.LatLng(point.lat, point.lng))
      const walking = leg.mode === 'walk'
      const background = new maps.Polyline({ path, strokeWeight: walking ? 7 : 10, strokeColor: '#ffffff', strokeOpacity: .9, strokeStyle: 'solid', zIndex: 3 })
      const line = new maps.Polyline({ path, strokeWeight: walking ? 4 : 6, strokeColor: appearance.color, strokeOpacity: 1,
        strokeStyle: walking ? 'shortdash' : 'solid', endArrow: false, zIndex: 4 })
      background.setMap(map); line.setMap(map)
      overlays.push(background, line)
      if (!walking) for (const [position, name, action] of [[path[0], leg.from, '승차'], [path.at(-1)!, leg.to, '하차']] as const) {
        const content = document.createElement('span')
        content.className = 'route-stop-marker'
        content.style.borderColor = appearance.color
        content.title = `${name} · ${action}`
        content.setAttribute('role', 'img')
        content.setAttribute('aria-label', content.title)
        const marker = new maps.CustomOverlay({ position, content, zIndex: 5 })
        marker.setMap(map)
        overlays.push(marker)
      }
    }
    return () => overlays.forEach(overlay => overlay.setMap(null))
  }, [context, selected, geometry])

  const showAll = () => {
    if (!context || !allResults.length) return
    cancelledFocusRef.current = selectionRef.current
    const bounds = new context.maps.LatLngBounds()
    for (const result of allResults) bounds.extend(new context.maps.LatLng(result.lat, result.lng))
    if (destination) bounds.extend(new context.maps.LatLng(destination.lat, destination.lng))
    context.map.setBounds(bounds, 48, 48, 48, 48)
  }

  const changeLevel = (difference: number) => {
    if (!context) return
    cancelledFocusRef.current = selectionRef.current
    context.map.setLevel(Math.max(1, Math.min(14, context.map.getLevel() + difference)))
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
      {status === 'ready' && selected && <aside className="map-route-info" aria-label="선택한 예상 경로">
        <strong title={`${selected.name} → 목적지`}>{selected.name} → 목적지</strong>
        {routeView.status === 'error' ? <>
          <p role="alert">{routeView.message}</p>
          <button type="button" onClick={() => onSelect(selected.id)}>경로 다시 표시</button>
        </> : <>
          <p role="status">{routeView.status === 'loading' ? '경로를 표시하고 있어요.' : geometry?.roadBusLines.length ? '버스 도로 경로' : '정류장 연결 경로'}</p>
          <div className="map-route-legend">
            <span className="map-route-walk">점선: 도보</span><span>진한 실선: 탑승 구간</span>
            {!!geometry?.busLines.length && <span className="map-route-context">연한 실선: 버스 전체 노선</span>}
          </div>
          <small>{geometry?.roadBusLines.length
            ? selected.legs.some(leg => leg.mode === 'bus' && !geometry.roadBusLines.includes(leg.lineId!))
              ? '일부 버스는 정류장 연결선이에요. 도보·지하철도 실제 경로와 다를 수 있어요.'
              : '도보·지하철은 실제 경로와 다를 수 있어요.'
            : '실제 도로·보행 경로와 다를 수 있어요.'}</small>
          {geometry?.sources.map(source => <small key={`${source.url}:${source.date}`}>
            버스 경로: <a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a> · {source.date}
          </small>)}
        </>}
      </aside>}
      {status === 'ready' && <div className="map-controls" role="group" aria-label="지도 조작">
        <div className="map-zoom-controls">
          <button type="button" aria-label="지도 확대" onClick={() => changeLevel(-1)}>＋</button>
          <button type="button" aria-label="지도 축소" onClick={() => changeLevel(1)}>−</button>
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
