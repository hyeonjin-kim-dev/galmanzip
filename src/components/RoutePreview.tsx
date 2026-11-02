import type { CSSProperties } from 'react'
import type { RouteLeg } from '../search/types'
import { modeName, routeAppearance, routeTime } from '../lib/routePresentation'

export function RouteIcon({ mode }: { mode: RouteLeg['mode'] }) {
  return <svg className="route-mode-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {mode === 'walk' ? <><circle cx="13" cy="4" r="2" /><path d="m11 8-3 5-4 1m7-6 4 4 4 1M11 8l2 6-4 7m4-7 4 6" /></>
      : <><rect x="5" y="3" width="14" height="16" rx={mode === 'bus' ? 3 : 5} /><path d="M5 11h14M8 19l-1 2m9-2 1 2" /><circle cx="8.5" cy="15.5" r=".7" /><circle cx="15.5" cy="15.5" r=".7" />{mode === 'rail' && <path d="M9 3V1h6v2" />}</>}
  </svg>
}

export default function RoutePreview({ legs, selected, onSelect }: { legs: RouteLeg[]; selected: boolean; onSelect(): void }) {
  const styles = routeAppearance(legs)
  const timed = legs.map((leg, index) => ({ leg, index })).filter(({ leg }) => leg.seconds > 0)
  const rides = timed.filter(({ leg }) => leg.mode === 'bus' || leg.mode === 'rail')
  const walking = legs.filter(leg => leg.mode === 'walk').reduce((sum, leg) => sum + leg.seconds, 0)
  const description = timed.map(({ leg }) => `${modeName[leg.mode]} ${leg.line ?? ''} ${routeTime(leg.seconds)}`).join(', ')
  return <div className="route-preview">
    <button className="route-gauge-button" type="button" aria-pressed={selected} onClick={onSelect}
      aria-label={`예상 경로 지도에서 보기: ${description || '바로 도착'}`}>
      <span className="route-gauge" role="img" aria-label={description || '바로 도착'}>
        {timed.map(({ leg, index }) => <span key={index} className="route-gauge-segment" data-mode={leg.mode}
          style={{ flexGrow: leg.seconds, background: styles[index].color, color: styles[index].ink }}
          title={`${modeName[leg.mode]} ${leg.line ?? ''} · ${routeTime(leg.seconds)}`} aria-hidden="true">
          <RouteIcon mode={leg.mode} /><span>{routeTime(leg.seconds)}</span>
        </span>)}
      </span>
      <span className="route-gauge-caption"><span>도보 {routeTime(walking)}</span><span>지도에서 보기</span></span>
    </button>
    {rides.length ? <ol className="route-transit-stops">
      {rides.map(({ leg, index }) => {
        const count = leg.fromIndex !== undefined && leg.toIndex !== undefined ? leg.toIndex - leg.fromIndex : undefined
        return <li key={index} style={{ '--route-color': styles[index].color } as CSSProperties}>
          <div className="route-vehicle"><RouteIcon mode={leg.mode} /><span>{modeName[leg.mode]}</span><strong title={leg.line}>{leg.line}</strong>
            <small>{routeTime(leg.seconds)}{count !== undefined && <> · {count}개 {leg.mode === 'bus' ? '정류장' : '역'}</>}</small></div>
          <div className="route-stop-row"><span>승차</span><span title={leg.from}>{leg.from}</span></div>
          <div className="route-stop-row"><span>하차</span><span title={leg.to}>{leg.to}</span></div>
        </li>
      })}
    </ol> : <p className="route-walk-only">도보로 목적지까지 이동</p>}
  </div>
}
