import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { MapInstance, MapsSdk } from '../lib/kakaoMaps'
import type { ApartmentResult } from '../search/types'

interface Props {
  context: { maps: MapsSdk; map: MapInstance }
  apartment: ApartmentResult
  container: HTMLElement
  onClose(): void
  onSelect(id: string): void
}

export default function ApartmentTooltip({ context, apartment, container, onClose, onSelect }: Props) {
  const content = useMemo(() => document.createElement('div'), [])
  useEffect(() => {
    const { maps, map } = context
    const bounds = map.getBounds(), sw = bounds.getSouthWest(), ne = bounds.getNorthEast()
    const x = (apartment.lng - sw.getLng()) / (ne.getLng() - sw.getLng())
    const y = (apartment.lat - sw.getLat()) / (ne.getLat() - sw.getLat())
    const mobile = window.matchMedia('(max-width: 767px)')
    let overlay: InstanceType<MapsSdk['CustomOverlay']> | undefined
    const mount = () => {
      overlay?.setMap(null); content.remove()
      content.className = `apartment-tooltip-anchor${mobile.matches ? ' apartment-tooltip-mobile' : ''}`
      content.dataset.placement = y > .55 ? 'below' : 'above'
      if (mobile.matches) container.parentElement?.append(content)
      else {
        overlay = new maps.CustomOverlay({ position: new maps.LatLng(apartment.lat, apartment.lng), content,
          xAnchor: x < .3 ? 0 : x > .7 ? 1 : .5, yAnchor: y > .55 ? 0 : 1, zIndex: 10 })
        overlay.setMap(map)
      }
    }
    mount(); mobile.addEventListener('change', mount)
    return () => { mobile.removeEventListener('change', mount); overlay?.setMap(null); content.remove() }
  }, [context, apartment, container, content])
  return createPortal(
    <aside className="apartment-tooltip" role="dialog" aria-label={`${apartment.name} 정보`}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <button className="apartment-tooltip-close" type="button" aria-label="아파트 정보 닫기" onClick={onClose}>×</button>
      <strong>{apartment.name}</strong>
      <p>{apartment.address}</p>
      <p>약 {Math.ceil(apartment.seconds / 60)}분 · 환승 {apartment.transfers}회</p>
      <small>교통 자료 추정 · 대기시간 제외</small>
      <button className="apartment-tooltip-route" type="button" onClick={() => { onClose(); onSelect(apartment.id) }}>경로 보기</button>
    </aside>, content)
}
