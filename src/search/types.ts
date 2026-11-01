export interface Point { lat: number; lng: number }
export interface Place extends Point { id: string; name: string; address: string; url: string }
export interface Stop extends Point { id: string; name: string }
export interface TransitLine {
  id: string
  name: string
  mode: 'bus' | 'rail'
  stops: string[]
  seconds: number[]
  waitSeconds: number
  pickup?: boolean[]
  dropoff?: boolean[]
}
export interface TransitNetwork {
  version: 1
  status: 'ready'
  source: { name: string; url: string; date: string; license: string }
  coverage: string
  stops: Stop[]
  lines: TransitLine[]
  transfers: { from: string; to: string; seconds: number }[]
}
export interface RouteLeg {
  mode: 'walk' | 'wait' | 'bus' | 'rail'
  from: string
  to: string
  seconds: number
  line?: string
  lineId?: string
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
}
