import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { decodeNetwork } from '../src/search/data.ts'
import { validTerminalIndexes, validateBusShape } from '../src/search/busShapes.ts'

const root = new URL('../public/data/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('transit.json', root), 'utf8'))
const network = await decodeNetwork(Uint8Array.from(readFileSync(new URL(manifest.asset, root))).buffer)
const directory = resolve(process.argv[2] ?? 'public/data/bus-shapes')
const index = JSON.parse(readFileSync(resolve(directory, 'index.json'), 'utf8'))
if (index.version !== 1 || !index.patterns || typeof index.patterns !== 'object' || Array.isArray(index.patterns)) {
  throw new Error('버스 도로 좌표 색인 형식이 올바르지 않습니다.')
}
const lines = new Map(network.lines.map(line => [line.id, line]))
for (const [id, endpoints] of Object.entries(index.terminals ?? {})) {
  const line = lines.get(id)
  if (!line || !index.patterns[id] || !validTerminalIndexes(endpoints, line)) throw new Error('버스 기·종점과 운행 순서가 일치하지 않습니다.')
}
for (const [id, asset] of Object.entries(index.patterns)) {
  if (typeof asset !== 'string' || !/^shape-[a-f0-9]{12}\.json\.gz$/.test(asset)) throw new Error('버스 도로 좌표 파일명이 올바르지 않습니다.')
  const line = lines.get(id)
  if (!line) throw new Error('현재 교통 자료에 없는 버스 도로 좌표입니다.')
  const bytes = gunzipSync(readFileSync(resolve(directory, asset)))
  if (`shape-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.json.gz` !== asset) throw new Error('버스 도로 좌표의 내용 해시가 다릅니다.')
  validateBusShape(JSON.parse(bytes.toString('utf8')), line, network)
}
console.log(`버스 도로 좌표 ${Object.keys(index.patterns).length.toLocaleString('ko-KR')}개 운행 패턴 검증 완료`)
