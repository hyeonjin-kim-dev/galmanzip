import type { RouteLeg } from '../search/types'

export const routeTime = (seconds: number) => seconds > 0 && seconds < 60 ? '1분 미만' : `${Math.ceil(seconds / 60)}분`
export const modeName = { walk: '도보', bus: '버스', rail: '지하철' } as const

export function routeAppearance(legs: RouteLeg[]) {
  return legs.map(leg => {
    if (leg.mode === 'walk') return { color: '#687789', ink: '#ffffff', label: '도보' }
    const color = /^#[0-9a-f]{6}$/i.test(leg.color ?? '') ? leg.color! : '#64748B'
    const channels = [1, 3, 5].map(offset => {
      const value = parseInt(color.slice(offset, offset + 2), 16) / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    })
    const luminance = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
    return { color, ink: luminance > .179 ? '#000000' : '#ffffff', label: leg.typeName ?? modeName[leg.mode] }
  })
}
