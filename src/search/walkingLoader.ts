import { decodeJson } from './data.ts'
import { routeWalking, validateWalkingTile } from './walking.ts'
import type { WalkingTile, WalkingPath } from './walking.ts'
import type { ApartmentResult, Point, RouteGeometry } from './types.ts'

interface Index { version: 1; cell: number; tiles: Record<string, string>; source: { timestamp: string } }
const assetName = /^walk-[a-f0-9]{12}\.json\.gz$/

export function walkingTileKeys(from: Point, to: Point, cell: number) {
  // 5분 이내 보행의 우회와 인접 파일 경계를 함께 포함한다.
  const south = Math.min(from.lat, to.lat) - .004, north = Math.max(from.lat, to.lat) + .004
  const west = Math.min(from.lng, to.lng) - .005, east = Math.max(from.lng, to.lng) + .005
  const keys: string[] = []
  for (let y = Math.floor(south / cell); y <= Math.floor(north / cell); y++) {
    for (let x = Math.floor(west / cell); x <= Math.floor(east / cell); x++) keys.push(`${y}-${x}`)
  }
  return keys
}

export function createWalkingLoader(networkUrl: string) {
  const base = new URL('walking/', networkUrl)
  let index: Promise<Index> | undefined
  const files = new Map<string, Promise<WalkingTile>>()
  const read = async (url: URL, cache?: RequestCache) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(url, { signal: controller.signal, cache, credentials: 'omit' })
      if (!response.ok) throw new Error('보행망 자료를 불러오지 못했습니다.')
      return await decodeJson(await response.arrayBuffer())
    } finally { clearTimeout(timer) }
  }
  const loadIndex = () => index ??= read(new URL('index.json', base), 'no-cache').then(value => {
    const data = value as Index
    if (data?.version !== 1 || data.cell !== .02 || !data.tiles || Array.isArray(data.tiles) || typeof data.tiles !== 'object'
      || typeof data.source?.timestamp !== 'string') throw new Error('보행망 배포 정보가 올바르지 않습니다.')
    return data
  }).catch(error => { index = undefined; throw error })
  const loadTile = (asset: string) => {
    let pending = files.get(asset)
    if (!pending) {
      pending = read(new URL(asset, base)).then(validateWalkingTile).catch(error => { files.delete(asset); throw error })
      files.set(asset, pending)
      if (files.size > 32) files.delete(files.keys().next().value!)
    }
    return pending
  }
  return async (geometry: RouteGeometry, apartment: ApartmentResult): Promise<RouteGeometry> => {
    const segments = geometry.segments.filter(segment => apartment.legs[segment.legIndex].mode !== 'walk')
    const walking: NonNullable<RouteGeometry['walking']> = { matched: [], missing: [], accessGaps: false, date: '' }
    const wanted = geometry.segments.filter(segment => apartment.legs[segment.legIndex].mode === 'walk')
    await Promise.all(wanted.map(async segment => {
      let route: WalkingPath = { status: 'unavailable' }
      try {
        const manifest = await loadIndex()
        walking.date = manifest.source.timestamp.slice(0, 10)
        const from = segment.points[0], to = segment.points.at(-1)!
        const keys = walkingTileKeys(from, to, manifest.cell)
        if (keys.length > 9) throw new Error('보행 구간 범위를 확인하지 못했습니다.')
        const assets = [...new Set(keys.map(key => manifest.tiles[key]).filter(Boolean))]
        if (assets.some(asset => !assetName.test(asset))) throw new Error('보행망 파일 이름이 올바르지 않습니다.')
        const tiles = await Promise.all(assets.map(loadTile))
        route = routeWalking(tiles, from, to)
      } catch { /* 자료 오류나 누락 때 확인되지 않은 직선을 그리지 않는다. */ }
      if (route.status === 'matched' && route.points.length > 1) {
        segments.push({ legIndex: segment.legIndex, points: route.points })
        walking.matched.push(segment.legIndex)
        walking.accessGaps ||= route.offsets.some(offset => offset > 2)
      } else walking.missing.push({ legIndex: segment.legIndex, reason: route.status === 'matched' ? 'unavailable' : route.status })
    }))
    segments.sort((a, b) => a.legIndex - b.legIndex)
    walking.matched.sort((a, b) => a - b)
    walking.missing.sort((a, b) => a.legIndex - b.legIndex)
    return { ...geometry, segments, walking }
  }
}
