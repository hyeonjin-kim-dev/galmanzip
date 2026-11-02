import type { RouteLeg } from '../search/types'

export const routeTime = (seconds: number) => seconds > 0 && seconds < 60 ? '1분 미만' : `${Math.ceil(seconds / 60)}분`
export const modeName = { walk: '도보', wait: '대기', bus: '버스', rail: '지하철' } as const

export function routeAppearance(legs: RouteLeg[]) {
  let riding = 0
  return legs.map(leg => {
    if (leg.mode === 'walk') return { color: '#687789', ink: '#ffffff', label: '도보' }
    if (leg.mode === 'wait') return { color: '#E2E5E9', ink: '#464C53', label: '대기' }
    const colors = leg.mode === 'bus' ? ['#65A30D', '#0F766E', '#C2410C'] : ['#2563EB', '#7C3AED', '#0369A1']
    const color = colors[riding++ % colors.length]
    return { color, ink: color === '#65A30D' ? '#142D00' : '#ffffff', label: modeName[leg.mode] }
  })
}
