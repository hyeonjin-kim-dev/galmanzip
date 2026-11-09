import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ApartmentResult, Place, RouteLeg, SearchSnapshot } from '../search/types'
import { resultGroup, resultGroups } from '../search/resultOrder'
import type { ResultGroup } from '../search/resultOrder'
import RoutePreview from './RoutePreview'
import ApartmentSalePrice from './ApartmentSalePrice'

interface ApartmentResultsProps {
  snapshot: SearchSnapshot
  results: ApartmentResult[]
  mapCount: number
  viewLoading: boolean
  onSort(): void
  destination: Place | null
  selectedId: string | null
  onSelect(id: string): void
}

const minutes = (seconds: number) => Math.ceil(seconds / 60)
const describeLeg = (leg: RouteLeg) => {
  if (leg.mode === 'walk') return `도보 · ${leg.from} → ${leg.to}`
  return `${leg.mode === 'bus' && leg.typeName ? `${leg.typeName} ` : ''}${leg.line} · ${leg.from} → ${leg.to}`
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
    <li className="apartment-card" data-selected={selected} data-place-id={apartment.id} onClick={event => {
      if (event.target instanceof Element && !event.target.closest('a, button, details')) onSelect(apartment.id)
    }}>
      <button className="apartment-heading" type="button" aria-pressed={selected} onClick={() => onSelect(apartment.id)}>
        <strong>{apartment.name}</strong>
        <span className="apartment-time">약 {minutes(apartment.seconds)}분 <span>· 환승 {apartment.transfers}회</span></span>
        <span className="visually-hidden">지도에서 보기</span>
      </button>
      <p className="apartment-provider">교통 자료 추정 · 대기시간 제외</p>
      <p className="apartment-address">{apartment.address}</p>
      <ApartmentSalePrice apartment={apartment} />
      <p className="apartment-stop">{apartment.startStop === '도보 이동' ? '목적지까지 도보 이동' : `출발 정류장 · ${apartment.startStop}`}</p>
      <RoutePreview legs={apartment.legs} selected={selected} onSelect={() => onSelect(apartment.id)} />
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

export default function ApartmentResults({ snapshot, results, mapCount, viewLoading, onSort, destination, selectedId, onSelect }: ApartmentResultsProps) {
  const [visibleCount, setVisibleCount] = useState<Record<ResultGroup, number>>({ rail: 50, express: 50, bus: 50, walk: 50, transfer: 50 })
  const listRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => resultGroups.map(group => ({ ...group,
    items: results.filter(result => resultGroup(result) === group.key) })), [results])

  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-place-id="${CSS.escape(selectedId)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  if (snapshot.status === 'idle') return <div className="results-empty">
    <p>어디까지 갈 수 있는 집일까요?</p>
    <span>목적지를 목록에서 선택하고 소요 시간을 정해 주세요.</span>
  </div>

  const outsideCount = snapshot.results.length - results.length
  const interrupted = snapshot.status === 'error' || snapshot.status === 'cancelled'
  const message = snapshot.status !== 'loading' ? snapshot.message : viewLoading
    ? results.length ? '다른 집도 계속 찾고 있어요.' : '지도 주변의 집을 찾고 있어요.'
    : '다른 지역의 집도 확인 중이에요.'

  return (
    <section className="apartment-results" aria-label="아파트 검색 결과" aria-busy={viewLoading && !results.length}>
      <div className="results-summary">
        <h2>찾은 아파트 {results.length.toLocaleString('ko-KR')}곳</h2>
        <p>각 도보 구간이 5분 이하 · 직통 경로 우선</p>
        <p className="results-map-count">현재 지도 안 {mapCount.toLocaleString('ko-KR')}곳</p>
        {snapshot.maxTransfers !== undefined && <p>최대 환승 {snapshot.maxTransfers}회</p>}
        <p className="search-message" role={snapshot.status === 'error' ? 'alert' : 'status'} title={message}>{message}</p>
        <div className="results-actions">
          <span>무환승 지하철 → 좌석버스 → 기타 버스</span>
          <button type="button" onClick={onSort} disabled={results.length < 2}>수단·시간순 정렬</button>
        </div>
        <details className="results-notice">
          <summary>조회 기준과 주의사항</summary>
          {snapshot.source && <p className="results-basis">교통 자료: {snapshot.source.date}{snapshot.source.reference && <> · {snapshot.source.reference}</>}</p>}
          {snapshot.notice && <p>{snapshot.notice}</p>}
          <p>출발·각 환승·도착의 도보 구간이 각각 5분 이하이고 선택한 최대 시간 내인 경로에서 환승 없는 경로를 우선합니다. 자료에 없는 노선 주변 아파트는 누락될 수 있습니다.</p>
          <p>도보·탑승·환승 도보를 합한 추정 시간이며 버스·지하철을 기다리는 시간은 제외합니다. 운행일·시간대, 교통 상황과 실제 보행 경로에 따라 달라집니다. 10분 이상 여유를 두고 카카오맵 길찾기에서 확인해 주세요. 오차가 10분 이내임을 보장하지 않습니다.</p>
          <p>최근 매매가는 국토교통부 공개 자료의 최근 12개월 중 해제되지 않은 최신 계약일 기준이며 매물 호가가 아닙니다. 면적·층에 따라 가격이 다르고 신고 지연·정정·해제로 바뀔 수 있습니다. 화면의 수집일을 확인해 주세요. 주소 대조가 되지 않거나 해당 기간 자료가 없으면 가격을 표시하지 않습니다.</p>
          <p>현재 매물은 네이버 부동산에서 복사한 단지명으로 확인하세요. 장소 검색에 등록되지 않은 아파트는 제외됩니다.</p>
          {snapshot.source && <>
            <p>경로·후보 구역 자료: <a href={snapshot.source.url} target="_blank" rel="noopener noreferrer">{snapshot.source.name}</a> · {snapshot.source.date}</p>
            <p>{snapshot.coverage}</p><p>{snapshot.source.license}</p>
          </>}
          {snapshot.limited && <p>장소 검색 제공 한도로 일부 아파트가 누락될 수 있습니다.</p>}
        </details>
      </div>
      {(snapshot.status === 'cancelled' || (snapshot.status === 'error' && snapshot.results.length > 0)) && <p className="results-partial">중단 전까지 확인한 일부 결과입니다.</p>}
      {!results.length && (viewLoading ? <div className="results-skeleton" aria-hidden="true">
        {[0, 1, 2].map(index => <div key={index}><span /><span /><span /></div>)}
      </div> : <div className="results-empty"><p>{interrupted ? '이 지도 영역에서 아직 확인한 결과가 없어요.' : '이 지도 영역에는 조건에 맞는 집이 없어요.'}</p>
        <span>{outsideCount ? `지도 밖에서 찾은 집 ${outsideCount.toLocaleString('ko-KR')}곳은 지도를 축소하면 볼 수 있어요.` : interrupted ? '다시 검색해서 이 영역의 집을 확인해 주세요.' : '지도를 움직이거나 축소해서 다른 지역도 확인해 보세요.'}</span>
      </div>)}
      {destination && <div ref={listRef} className="apartment-groups">
        {groups.map(group => {
          if (!group.items.length) return null
          const shown = Math.max(visibleCount[group.key], group.items.findIndex(result => result.id === selectedId) + 1)
          return <section key={group.key} className="apartment-group" aria-label={`${group.label} 아파트`}>
            <h3>{group.label}<span>{group.items.length.toLocaleString('ko-KR')}곳</span></h3>
            <ol className="apartment-list">
              {group.items.slice(0, shown).map(apartment => <ApartmentCard key={apartment.id} apartment={apartment}
                destination={destination} selected={selectedId === apartment.id} onSelect={onSelect} />)}
            </ol>
            {shown < group.items.length && <button className="results-more" type="button"
              onClick={() => setVisibleCount(current => ({ ...current, [group.key]: shown + 50 }))}>{group.label} 더 보기</button>}
          </section>
        })}
      </div>}
    </section>
  )
}
