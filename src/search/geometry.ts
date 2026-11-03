import type { ApartmentResult, BusRoadShape, Place, Point, RouteGeometry, TransitNetwork } from './types.ts'
import { distance } from './routing.ts'

export function createRouteGeometry(network: TransitNetwork) {
  const stops = new Map(network.stops.map(stop => [stop.id, stop]))
  const lines = new Map(network.lines.map(line => [line.id, line]))
  const point = (id: string | undefined, fallback: Point): Point => {
    const value = id === undefined ? fallback : stops.get(id)
    if (!value) throw new Error('경로의 정류장 자료가 없습니다. 다시 검색해 주세요.')
    return { lat: value.lat, lng: value.lng }
  }
  return (apartment: ApartmentResult, destination: Place, shapes = new Map<string, BusRoadShape>()): RouteGeometry => {
    const busLines: RouteGeometry['busLines'] = []
    const included = new Set<string>()
    const roadBusLines = new Set<string>()
    const sources = new Map<string, BusRoadShape['source']>()
    const segments = apartment.legs.flatMap((leg, legIndex) => {
      if (leg.seconds <= 0) return []
      let points: Point[]
      if (leg.mode === 'walk') points = [point(leg.fromStopId, apartment), point(leg.toStopId, destination)]
      else {
        const line = lines.get(leg.lineId ?? ''), start = leg.fromIndex, end = leg.toIndex
        if (!line || line.mode !== leg.mode || start === undefined || end === undefined
          || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end >= line.stops.length
          || line.stops[start] !== leg.fromStopId || line.stops[end] !== leg.toStopId) {
          throw new Error('경로의 운행 순서를 확인하지 못했습니다. 다시 검색해 주세요.')
        }
        // 이름이 같거나 순환하는 정류장도 운행 순서로 구분한다. 도로 선형을 임의로 만들지 않는다.
        const road = line.mode === 'bus' ? shapes.get(line.id) : undefined
        points = road ? road.points.slice(road.stopIndexes[start], road.stopIndexes[end] + 1)
          : line.stops.slice(start, end + 1).map(id => point(id, apartment))
        if (road) { roadBusLines.add(line.id); sources.set(`${road.source.url}:${road.source.date}`, road.source) }
        if (line.mode === 'bus' && !included.has(line.id)) {
          const first = stops.get(line.stops[0])!, last = stops.get(line.stops.at(-1)!)!
          const circular = first.id === last.id || (first.name === last.name && distance(first, last) <= 100)
          // 왕복 노선은 전체 파일에서 확인한 회차 정류장을 쓰고, 미확인 순환 노선의 반대편 종점을 추측하지 않는다.
          const endpoints = road?.terminalStopIndexes ?? (circular ? [0] : [0, line.stops.length - 1])
          const terminals = endpoints.map((index, order) => ({ name: stops.get(line.stops[index])!.name,
            point: road ? road.points[road.stopIndexes[index]] : point(line.stops[index], apartment),
            label: endpoints.length === 1 ? '기·종점' : order === 0 ? '기점' : '종점' }))
          busLines.push({ legIndex, points: road?.points ?? line.stops.map(id => point(id, apartment)), terminals })
          included.add(line.id)
        }
      }
      return points.some(value => value.lat !== points[0].lat || value.lng !== points[0].lng) ? [{ legIndex, points }] : []
    })
    return { segments, busLines, roadBusLines: [...roadBusLines], sources: [...sources.values()] }
  }
}
