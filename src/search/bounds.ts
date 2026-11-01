import type { Point } from './types.ts'

export interface Bounds { south: number; west: number; north: number; east: number }
export const contains = (bounds: Bounds, point: Point) => point.lat >= bounds.south && point.lat <= bounds.north
  && point.lng >= bounds.west && point.lng <= bounds.east
export const intersects = (a: Bounds, b: Bounds) => a.south < b.north && a.north > b.south && a.west < b.east && a.east > b.west
export const sameBounds = (a: Bounds | null, b: Bounds) => a !== null
  && (['south', 'west', 'north', 'east'] as const).every(key => Math.abs(a[key] - b[key]) < 0.000001)
export const destinationLevel = (maxMinutes: number) => Math.max(5, Math.min(10, 6 + Math.ceil(Math.log2(maxMinutes / 20))))
export const around = (point: Point, maxMinutes: number): Bounds => {
  const scale = 2 ** (destinationLevel(maxMinutes) - 6)
  return { south: point.lat - 0.012 * scale, north: point.lat + 0.012 * scale,
    west: point.lng - 0.016 * scale, east: point.lng + 0.016 * scale }
}
