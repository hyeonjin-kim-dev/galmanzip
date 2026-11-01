export interface Point { lat: number; lng: number }
export interface Place extends Point { id: string; name: string; address: string; url: string }
export interface RouteSource {
  name: string
  url: string
  date: string
  license: string
  reference?: string
}
export interface RouteLeg {
  mode: 'walk' | 'wait' | 'bus' | 'rail'
  from: string
  to: string
  seconds: number
  line?: string
  lineId?: string
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
  source?: RouteSource
  coverage?: string
}
