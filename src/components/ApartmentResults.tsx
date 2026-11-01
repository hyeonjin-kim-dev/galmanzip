import { memo, useEffect, useRef, useState } from 'react'
import type { ApartmentResult, Place, RouteLeg, SearchSnapshot } from '../search/types'

interface ApartmentResultsProps {
  snapshot: SearchSnapshot
  destination: Place | null
  selectedId: string | null
  onSelect(id: string): void
}

const minutes = (seconds: number) => Math.ceil(seconds / 60)
const describeLeg = (leg: RouteLeg) => {
  if (leg.mode === 'wait') return `${leg.line} 대기`
  if (leg.mode === 'walk') return `도보 · ${leg.from} → ${leg.to}`
  return `${leg.line} · ${leg.from} → ${leg.to}`
}

const ApartmentCard = memo(function ApartmentCard({ apartment, destination, selected, onSelect }: {
  apartment: ApartmentResult
  destination: Place
  selected: boolean
  onSelect(id: string): void
}) {
  const [copyMessage, setCopyMessage] = useState('')
  const routeUrl = `https://map.kakao.com/link/by/traffic/${encodeURIComponent(apartment.name)},${apartment.lat},${apartment.lng}/${encodeURIComponent(destination.name)},${destination.lat},${destination.lng}`
  return (
    <li className="apartment-card" data-selected={selected} data-place-id={apartment.id}>
      <button className="apartment-heading" type="button" aria-pressed={selected} onClick={() => onSelect(apartment.id)}>
        <strong>{apartment.name}</strong>
        <span className="apartment-time">약 {minutes(apartment.seconds)}분 <span>· 환승 {apartment.transfers}회</span></span>
        <span className="visually-hidden">지도에서 보기</span>
      </button>
      <p className="apartment-provider">교통 자료 추정</p>
      <p className="apartment-address">{apartment.address}</p>
      <p className="apartment-stop">{apartment.startStop === '도보 이동' ? '목적지까지 도보 이동' : `출발 정류장 · ${apartment.startStop}`}</p>
      <details className="route-details">
        <summary>예상 경로</summary>
        <ol>{apartment.legs.filter(leg => leg.seconds > 0).map((leg, index) => (
          <li key={index}><span>{describeLeg(leg)}</span><span>약 {minutes(leg.seconds)}분</span></li>
        ))}</ol>
      </details>
      <div className="apartment-links">
        <a href={routeUrl} target="_blank" rel="noopener noreferrer">카카오맵 길찾기 ↗</a>
        <a href="https://land.naver.com/" target="_blank" rel="noopener noreferrer">네이버 부동산 ↗</a>
        <button type="button" onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${apartment.name} ${apartment.address}`)
            setCopyMessage('단지명과 주소를 복사했습니다.')
          } catch { setCopyMessage('복사하지 못했습니다. 단지명을 직접 선택해 복사해 주세요.') }
        }}>단지명·주소 복사</button>
      </div>
      {copyMessage && <p className="copy-message" role="status">{copyMessage}</p>}
    </li>
  )
})

export default function ApartmentResults({ snapshot, destination, selectedId, onSelect }: ApartmentResultsProps) {
  const [visibleCount, setVisibleCount] = useState(50)
  const listRef = useRef<HTMLOListElement>(null)
  const selectedIndex = snapshot.results.findIndex(result => result.id === selectedId)
  const shown = Math.max(visibleCount, selectedIndex + 1)

  useEffect(() => {
    if (selectedIndex >= 0) listRef.current?.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, selectedIndex])

  if (snapshot.status === 'idle') return <div className="results-empty">
    <p>어디까지 갈 수 있는 집일까요?</p>
    <span>목적지를 목록에서 선택하고 소요 시간을 정해 주세요.</span>
  </div>

  return (
    <section className="apartment-results" aria-label="아파트 검색 결과" aria-busy={snapshot.status === 'loading'}>
      <div className="results-summary">
        <h2>{snapshot.results.length || snapshot.status === 'complete' ? `아파트 ${snapshot.results.length.toLocaleString('ko-KR')}곳` : '아파트 검색'}</h2>
        <p>환승 없는 경로 우선 · 소요시간순</p>
        {snapshot.source && <p className="results-basis">교통 자료: {snapshot.source.date}{snapshot.source.reference && <> · {snapshot.source.reference}</>}</p>}
        <p className="search-message" role={snapshot.status === 'error' ? 'alert' : 'status'}>{snapshot.message}</p>
        {snapshot.status === 'loading' && snapshot.total > 0 && <>
          <progress aria-label="주변 아파트 조회 진행률" value={snapshot.completed} max={snapshot.total} />
          <span className="search-progress">{snapshot.completed} / {snapshot.total}개 지역 확인</span>
        </>}
        {snapshot.status === 'complete' && !snapshot.results.length && <p>선택한 시간 안에 도착할 것으로 예상되는 아파트를 찾지 못했습니다.</p>}
        {(snapshot.status === 'cancelled' || (snapshot.status === 'error' && snapshot.results.length > 0)) && <p>중단 전까지 확인한 일부 결과입니다.</p>}
        {snapshot.notice && <p>{snapshot.notice}</p>}
        {snapshot.limited && <p>장소 검색 제공 한도로 일부 아파트가 누락될 수 있습니다.</p>}
        {snapshot.source && <details className="results-notice">
          <summary>조회 기준과 주의사항</summary>
          <p>출발·환승·도착의 도보 합계가 5분 이하이고 선택한 최대 시간 내인 경로에서 환승 없는 경로를 우선합니다. 자료에 없는 노선 주변 아파트는 누락될 수 있습니다.</p>
          <p>도보·대기·탑승·환승을 합한 추정 시간입니다. 운행일·시간대, 교통 상황과 실제 보행 경로에 따라 달라집니다. 10분 이상 여유를 두고 카카오맵 길찾기에서 확인해 주세요. 오차가 10분 이내임을 보장하지 않습니다.</p>
          <p>아파트 위치 정보이며 현재 매물이나 실거래 가격이 아닙니다. 네이버 부동산에서 복사한 단지명으로 매매·전세·월세를 확인하세요. 장소 검색에 등록되지 않은 아파트는 제외됩니다.</p>
          <p>경로·후보 구역 자료: <a href={snapshot.source.url} target="_blank" rel="noopener noreferrer">{snapshot.source.name}</a> · {snapshot.source.date}</p>
          <p>{snapshot.coverage}</p><p>{snapshot.source.license}</p>
        </details>}
      </div>
      {destination && <ol className="apartment-list" ref={listRef}>
        {snapshot.results.slice(0, shown).map(apartment => <ApartmentCard key={apartment.id} apartment={apartment}
          destination={destination} selected={selectedId === apartment.id} onSelect={onSelect} />)}
      </ol>}
      {shown < snapshot.results.length && <button className="results-more" type="button" onClick={() => setVisibleCount(shown + 50)}>아파트 더 보기</button>}
    </section>
  )
}
