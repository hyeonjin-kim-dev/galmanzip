import { decodeJson } from '../search/data.ts'
import type { Place } from '../search/types.ts'

export interface SaleApartment {
  id: string
  names: string[]
  roadAddresses: string[]
  lotAddresses: string[]
  date: string
  transactions: [number, number, number][]
}
export interface SalesIndex {
  version: 1
  status: 'ready'
  collectedOn: string
  months: string[]
  districts: { code: string; name: string; asset: string }[]
}
interface Catalog { addresses: Map<string, SaleApartment[]> }
export type SaleResult = { status: 'matched'; apartment: SaleApartment; index: SalesIndex }
  | { status: 'unmatched' | 'ambiguous'; index: SalesIndex }
  | { status: 'unavailable' }
const source = 'https://www.data.go.kr/data/15126468/openapi.do'
const datePattern = /^20\d{2}-\d{2}-\d{2}$/

export function normalizeAddress(value: string) {
  return value.normalize('NFKC').replace(/\([^)]*\)/g, '').trim()
    .replace(/^서울특별시\s+/, '서울 ').replace(/^경기도\s+/, '경기 ')
    .replace(/산\s+(\d)/g, '산$1').replace(/\s+/g, ' ')
}

export function normalizeName(value: string) {
  // 차수·단지 번호를 남겨 같은 주소의 서로 다른 단지를 합치지 않는다.
  return value.normalize('NFKC').toLowerCase().replace(/아파트|apartment|\bapt\b/g, '')
    .replace(/[\s()\[\]·.,_-]/g, '')
}

export function validateSalesIndex(value: unknown): SalesIndex {
  const data = value as SalesIndex & { source?: { url: string } }
  if (!data || data.version !== 1 || data.status !== 'ready' || !datePattern.test(data.collectedOn)
    || data.source?.url !== source || !Array.isArray(data.months) || data.months.length !== 12
    || data.months.some(month => !/^20\d{2}(0[1-9]|1[0-2])$/.test(month))
    || !Array.isArray(data.districts) || !data.districts.length || data.districts.length > 100
    || data.districts.some(item => !item || !/^(11|41)\d{3}$/.test(item.code) || typeof item.name !== 'string'
      || !new RegExp(`^sales-${item.code}-[a-f0-9]{12}\\.json\\.gz$`).test(item.asset))) {
    throw new Error('매매 실거래가 자료를 준비하고 있습니다.')
  }
  return data
}

export function createCatalog(value: unknown, district: string, index: SalesIndex): Catalog {
  const data = value as { version: number; district: string; apartments: SaleApartment[] }
  if (!data || data.version !== 1 || data.district !== district || !Array.isArray(data.apartments) || data.apartments.length > 20000) {
    throw new Error('매매 실거래가 파일 형식이 올바르지 않습니다.')
  }
  const addresses = new Map<string, SaleApartment[]>()
  const ids = new Set<string>()
  for (const apartment of data.apartments) {
    const strings = (items: unknown): items is string[] => Array.isArray(items) && items.length > 0
      && items.every(item => typeof item === 'string' && item.trim().length > 0 && item.length < 300)
    if (!apartment || typeof apartment.id !== 'string' || !apartment.id || ids.has(apartment.id) || !strings(apartment.names)
      || !Array.isArray(apartment.roadAddresses) || !Array.isArray(apartment.lotAddresses)
      || !strings([...apartment.roadAddresses, ...apartment.lotAddresses]) || !datePattern.test(apartment.date)
      || !index.months.includes(apartment.date.slice(0, 7).replace('-', '')) || apartment.date > index.collectedOn
      || !Array.isArray(apartment.transactions) || !apartment.transactions.length
      || apartment.transactions.some(row => !Array.isArray(row) || row.length !== 3
        || !Number.isSafeInteger(row[0]) || row[0] <= 0 || row[0] > 1_000_000_000
        || !Number.isFinite(row[1]) || row[1] <= 0 || row[1] >= 5000
        || !Number.isInteger(row[2]) || row[2] < -20 || row[2] > 200)) {
      throw new Error('매매 실거래가의 날짜·금액·단지 정보를 확인하지 못했습니다.')
    }
    ids.add(apartment.id)
    for (const address of new Set([...apartment.roadAddresses, ...apartment.lotAddresses].map(normalizeAddress))) {
      const matches = addresses.get(address)
      if (matches) matches.push(apartment)
      else addresses.set(address, [apartment])
    }
  }
  return { addresses }
}

export function matchSale(place: Pick<Place, 'name' | 'address' | 'roadAddress' | 'lotAddress'>, catalogs: Catalog[], index: SalesIndex): SaleResult {
  const addresses = [...new Set([place.roadAddress, place.lotAddress, place.address].filter((value): value is string => !!value).map(normalizeAddress))]
  const groups = addresses.map(address => {
    const matches = new Map<string, SaleApartment>()
    for (const catalog of catalogs) for (const item of catalog.addresses.get(address) ?? []) {
      const previous = matches.get(item.id)
      if (!previous || previous.date < item.date) matches.set(item.id, item)
      else if (previous.date === item.date) matches.set(item.id, { ...previous, transactions: [...previous.transactions, ...item.transactions] })
    }
    return matches
  }).filter(group => group.size)
  if (!groups.length) return { status: 'unmatched', index }
  let candidates = [...groups[0].values()].filter(item => groups.every(group => group.has(item.id)))
  if (!candidates.length) return { status: 'ambiguous', index }
  // 주소가 겹치는 경우에는 단지명까지 정확히 확인된 한 곳만 연결한다.
  if (candidates.length > 1) candidates = candidates.filter(item => item.names.some(name => normalizeName(name) === normalizeName(place.name)))
  if (candidates.length !== 1) return { status: 'ambiguous', index }
  const versions = groups.map(group => group.get(candidates[0].id)!).sort((a, b) => b.date.localeCompare(a.date))
  const latest = versions[0]
  const transactions = new Map(versions.filter(item => item.date === latest.date).flatMap(item => item.transactions)
    .map(row => [row.join(':'), row]))
  return { status: 'matched', apartment: { ...latest, transactions: [...transactions.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) }, index }
}

export function formatAmount(amount: number) {
  const billions = Math.floor(amount / 10000), remainder = amount % 10000
  return `${billions ? `${billions.toLocaleString('ko-KR')}억` : ''}${billions && remainder ? ' ' : ''}${remainder ? `${remainder.toLocaleString('ko-KR')}만` : ''} 원`
}

export function createSalesLoader(base: URL) {
  let manifest: { promise: Promise<SalesIndex>; expires: number; failed?: boolean } | undefined
  const files = new Map<string, Promise<Catalog>>()
  const failedFiles = new Set<string>()
  const read = async (url: URL, cache?: RequestCache) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(url, { signal: controller.signal, cache, credentials: 'omit' })
      if (!response.ok) throw new Error('매매 자료를 불러오지 못했습니다.')
      return decodeJson(await response.arrayBuffer())
    } finally { clearTimeout(timer) }
  }
  return async (place: Place, retry = false): Promise<SaleResult> => {
    try {
      if (retry) {
        if (manifest?.failed) manifest = undefined
        for (const asset of failedFiles) files.delete(asset)
        failedFiles.clear()
      }
      if (!manifest || manifest.expires <= Date.now()) {
        manifest = { expires: Date.now() + 2 * 3600000,
          promise: read(new URL('index.json', base), 'no-cache').then(validateSalesIndex) }
        // 짧은 실패 캐시로 화면의 여러 카드가 같은 실패 요청을 반복하지 않게 한다.
        const current = manifest
        current.promise.catch(() => { current.expires = Date.now() + 15000; current.failed = true })
      }
      const index = await manifest.promise
      const addresses = [place.roadAddress, place.lotAddress, place.address].filter((value): value is string => !!value).map(normalizeAddress)
      const districts = index.districts.filter(item => addresses.some(address => address.startsWith(normalizeAddress(item.name) + ' ')))
      if (!districts.length) return { status: 'unmatched', index }
      const catalogs = await Promise.all(districts.map(item => {
        if (!files.has(item.asset)) {
          files.set(item.asset, read(new URL(item.asset, base)).then(value => createCatalog(value, item.code, index)))
          const current = files.get(item.asset)!
          current.catch(() => {
            failedFiles.add(item.asset)
            setTimeout(() => { if (files.get(item.asset) === current) { files.delete(item.asset); failedFiles.delete(item.asset) } }, 15000)
          })
          if (files.size > 32) files.delete(files.keys().next().value!)
        }
        return files.get(item.asset)!
      }))
      return matchSale(place, catalogs, index)
    } catch { return { status: 'unavailable' } }
  }
}
