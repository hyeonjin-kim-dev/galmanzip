import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { createRouter, validateNetwork } from '../src/search/routing.ts'
import { searchZones } from '../src/search/zones.ts'

// 실제 배포 자료를 사용하되 외부 장소 API를 호출하지 않는다.
const root = new URL('../public/data/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('transit.json', root), 'utf8'))
const network = validateNetwork(JSON.parse(gunzipSync(readFileSync(new URL(manifest.asset, root))).toString()))
const started = performance.now()
const route = createRouter(network)
console.log(`교통망 준비: ${Math.round(performance.now() - started)}ms`)
const results = []
for (const destination of [{ name: '서현역', lat: 37.384988, lng: 127.12339 }, { name: '강남역', lat: 37.498103, lng: 127.028079 }]) {
  for (const minutes of [30, 60, 180]) {
    const started = performance.now()
    const result = route(destination, minutes)
    const elapsed = performance.now() - started
    const zones = searchZones(result.stops, destination, minutes)
    results.push({ 목적지: destination.name, 최대분: minutes, 계산ms: Math.round(elapsed),
      도달경로: result.stops.length, 최초조회영역: zones.length })
  }
}
console.table(results)
console.log('최초 조회에는 교통망 준비가 추가되며, 장소 조회 횟수는 실제 결과 밀도에 따라 달라집니다.')
