import { useEffect, useRef, useState } from 'react'
import { createSalesLoader, formatAmount } from '../sales/data'
import type { SaleResult } from '../sales/data'
import type { Place } from '../search/types'

const load = createSalesLoader(new URL(`${import.meta.env.BASE_URL}data/sales/`, window.location.origin))
const source = 'https://www.data.go.kr/data/15126468/openapi.do'

export default function ApartmentSalePrice({ apartment }: { apartment: Place }) {
  const ref = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<SaleResult | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true, requested = false
    setResult(null)
    const start = () => {
      if (requested) return
      requested = true
      void load(apartment, attempt > 0).then(value => { if (active) setResult(value) })
    }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { start(); observer.disconnect() } }, { rootMargin: '200px' })
    if (ref.current) observer.observe(ref.current)
    return () => { active = false; observer.disconnect() }
  }, [apartment, attempt])
  const matched = result?.status === 'matched' ? result.apartment : undefined
  const transactions = matched?.transactions ?? []
  const amounts = transactions.map(row => row[0]), low = Math.min(...amounts), high = Math.max(...amounts)
  return <div ref={ref} className="apartment-sale" aria-label="최근 매매 실거래가" data-status={result?.status ?? 'loading'}>
    <div className="apartment-sale-main">
      <span>최근 매매</span>
      <strong>{matched ? low === high ? formatAmount(low) : `${formatAmount(low)} ~ ${formatAmount(high)}`
        : !result ? '확인 중' : result.status === 'unavailable' ? '자료를 불러오지 못했어요'
          : result.status === 'ambiguous' ? '단지 확인 필요' : '일치하는 거래 정보 없음'}</strong>
    </div>
    <p className="apartment-sale-meta">{matched ? `${matched.date.replaceAll('-', '.')} 계약${transactions.length === 1 ? ` · 전용 ${transactions[0][1]}㎡ · ${transactions[0][2]}층` : ' · 같은 날 여러 거래'}`
      : result && result.status !== 'unavailable' ? '최근 12개월 · 주소 대조 기준' : '\u00a0'}</p>
    <div className="apartment-sale-source">
      {result && 'index' in result ? <>
        <a href={source} target="_blank" rel="noopener noreferrer">국토교통부</a>
        <span>{result.index.collectedOn.replaceAll('-', '.')} 수집 · 호가 아님</span>
      </> : result?.status === 'unavailable'
        ? <button type="button" onClick={() => setAttempt(value => value + 1)}>다시 확인</button> : <span aria-hidden="true">&nbsp;</span>}
    </div>
    {transactions.length > 1 && <details className="sale-transactions"><summary>면적·층별 거래 보기</summary>
      <ul>{transactions.map(([amount, area, floor], index) => <li key={`${amount}:${area}:${floor}:${index}`}>
        <span>전용 {area}㎡ · {floor}층</span><strong>{formatAmount(amount)}</strong>
      </li>)}</ul>
    </details>}
  </div>
}
