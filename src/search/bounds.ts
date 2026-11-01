import type { Point } from './types.ts'

export interface Bounds { south: number; west: number; north: number; east: number }
export const contains = (bounds: Bounds, point: Point) => point.lat >= bounds.south && point.lat <= bounds.north
  && point.lng >= bounds.west && point.lng <= bounds.east
export const intersects = (a: Bounds, b: Bounds) => a.south < b.north && a.north > b.south && a.west < b.east && a.east > b.west
export const sameBounds = (a: Bounds | null, b: Bounds) => a !== null
  && (['south', 'west', 'north', 'east'] as const).every(key => Math.abs(a[key] - b[key]) < 0.000001)
export const around = (point: Point): Bounds => ({ south: point.lat - 0.012, north: point.lat + 0.012,
  west: point.lng - 0.016, east: point.lng + 0.016 })
