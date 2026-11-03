import type { Bounds } from './bounds.ts'

export interface Point { lat: number; lng: number }
export interface Place extends Point { id: string; name: string; address: string; url: string }
export interface Stop extends Point { id: string; name: string; mode?: 'bus' | 'rail' }
export interface TransitLine {
  id: string
  name: string
  mode: 'bus' | 'rail'
  typeName?: string
  color?: string
  stops: string[]
  seconds: number[]
  waitSeconds: number
  dwellSeconds?: number[]
  pickup?: boolean[]
  dropoff?: boolean[]
}
export interface TransitNetwork {
  version: 1
  status: 'ready'
  source: { name: string; url: string; date: string; license: string; reference?: string }
  coverage: string
  stops: Stop[]
  lines: TransitLine[]
  transfers: { from: string; to: string; seconds: number }[]
}
export interface RouteLeg {
  mode: 'walk' | 'bus' | 'rail'
  from: string
  to: string
  seconds: number
  line?: string
  lineId?: string
  typeName?: string
  color?: string
  fromStopId?: string
  toStopId?: string
  fromIndex?: number
  toIndex?: number
}
export interface ReachableStop extends Stop {
  seconds: number
  boardings: number
  legs: RouteLeg[]
}
export interface Reachability {
  stops: ReachableStop[]
  source: TransitNetwork['source']
  coverage: string
}
export interface ReachabilitySummary extends Omit<Reachability, 'stops'> {
  stops: Pick<ReachableStop, 'id' | 'lat' | 'lng' | 'seconds' | 'boardings'>[]
}
export interface RouteGeometry {
  segments: { legIndex: number; points: Point[] }[]
  busLines: { legIndex: number; points: Point[]; terminals: { name: string; point: Point; label: string }[] }[]
  roadBusLines: string[]
  sources: BusRoadShape['source'][]
}
export interface BusRoadShape {
  version: 1
  lineId: string
  stopIds: string[]
  stopIndexes: number[]
  terminalStopIndexes?: number[]
  points: Point[]
  source: { name: string; url: string; date: string; license: string }
}
export interface SearchArea { id: number; bounds: Bounds; page: number }
export interface AreaPage { count: number; total: number; more: boolean }
export interface SearchProgress { completed: number; total: number; limited: boolean; pendingAreas: Bounds[] }
export interface SearchPlan extends SearchProgress {
  initialArea?: SearchArea
  source: TransitNetwork['source']
  coverage: string
}
export type RoutingTask = { kind: 'plan'; session: number; destination: Place; minutes: number; bounds: Bounds | null; maxTransfers: number }
  | { kind: 'next'; session: number; bounds: Bounds | null }
  | { kind: 'accept'; session: number; area: number; page: AreaPage; places: Place[]; minMinutes: number }
  | { kind: 'geometry'; destination: Place; apartment: ApartmentResult }
export interface ApartmentResult extends Place {
  seconds: number
  transfers: number
  startStop: string
  legs: RouteLeg[]
}
export interface SearchSnapshot {
  status: 'idle' | 'loading' | 'complete' | 'cancelled' | 'error'
  results: ApartmentResult[]
  message: string
  completed: number
  total: number
  limited: boolean
  source?: TransitNetwork['source']
  coverage?: string
  notice?: string
  pendingAreas?: Bounds[]
  maxTransfers?: number
}
