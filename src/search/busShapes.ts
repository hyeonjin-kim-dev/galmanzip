import { decodeJson } from './data.ts'
import { distance } from './routing.ts'
import type { ApartmentResult, BusRoadShape, TransitLine, TransitNetwork } from './types.ts'

const assetName = /^shape-[a-f0-9]{12}\.json\.gz$/

export function validateBusShape(value: unknown, line: TransitLine, network: TransitNetwork): BusRoadShape {
  const data = value as BusRoadShape | undefined
  if (!data || data.version !== 1 || line.mode !== 'bus' || data.lineId !== line.id
    || !Array.isArray(data.points) || data.points.length < 2 || data.points.length > 50000
    || data.points.some(point => !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
      || point.lat < 32 || point.lat > 40 || point.lng < 123 || point.lng > 133)
    || !Array.isArray(data.stopIds) || data.stopIds.length !== line.stops.length
    || data.stopIds.some((id, index) => id !== line.stops[index])
    || !Array.isArray(data.stopIndexes) || data.stopIndexes.length !== line.stops.length
    || data.stopIndexes.some((index, position) => !Number.isInteger(index) || index < 0 || index >= data.points.length
      || (position > 0 && index < data.stopIndexes[position - 1]))
    || data.stopIndexes[0] !== 0 || data.stopIndexes.at(-1) !== data.points.length - 1
    || typeof data.source?.name !== 'string' || !data.source.name.trim()
    || typeof data.source.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.source.date)
    || typeof data.source.license !== 'string' || !data.source.license.trim()
    || data.source.url !== 'https://www.data.go.kr/data/15080662/openapi.do') {
    throw new Error('버스 도로 좌표와 운행 순서를 확인하지 못했습니다.')
  }
  const stops = new Map(network.stops.map(stop => [stop.id, stop]))
  for (let index = 0; index < line.stops.length; index++) {
    const stop = stops.get(line.stops[index])
    if (!stop || distance(stop, data.points[data.stopIndexes[index]]) > 80) {
      throw new Error('정류장과 버스 도로 좌표가 일치하지 않습니다.')
    }
  }
  return data
}

export function createBusShapeLoader(network: TransitNetwork, networkUrl: string) {
  let index: Promise<Record<string, string>> | undefined
  const files = new Map<string, Promise<unknown>>()
  const base = new URL('bus-shapes/', networkUrl)
  const read = async (url: URL, cache?: RequestCache) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(url, { signal: controller.signal, cache, credentials: 'omit' })
      if (!response.ok) throw new Error('버스 도로 좌표를 불러오지 못했습니다.')
      return await decodeJson(await response.arrayBuffer())
    } finally { clearTimeout(timer) }
  }
  return async (apartment: ApartmentResult) => {
    const selected = network.lines.filter(line => line.mode === 'bus' && apartment.legs.some(leg => leg.lineId === line.id))
    const result = new Map<string, BusRoadShape>()
    if (!selected.length) return result
    index ??= read(new URL('index.json', base), 'no-cache').then(value => {
      const data = value as { version?: number; patterns?: Record<string, string> }
      if (data?.version !== 1 || !data.patterns || typeof data.patterns !== 'object' || Array.isArray(data.patterns)) return {}
      return data.patterns
    }).catch(() => ({}))
    const patterns = await index
    await Promise.all(selected.map(async line => {
      const asset = patterns[line.id]
      if (typeof asset !== 'string' || !assetName.test(asset)) return
      try {
        if (!files.has(asset)) {
          files.set(asset, read(new URL(asset, base)).catch(() => undefined))
          if (files.size > 16) files.delete(files.keys().next().value!)
        }
        result.set(line.id, validateBusShape(await files.get(asset), line, network))
      } catch { /* 확인할 수 없는 선형은 기존 정류장 연결선으로 표시한다. */ }
    }))
    return result
  }
}
