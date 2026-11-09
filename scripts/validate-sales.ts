import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { createCatalog, validateSalesIndex } from '../src/sales/data.ts'

const root = resolve(process.argv[2] ?? 'public/data/sales')
const index = validateSalesIndex(JSON.parse(readFileSync(resolve(root, 'index.json'), 'utf8')))
let apartments = 0
for (const district of index.districts) {
  const bytes = gunzipSync(readFileSync(resolve(root, district.asset)))
  if (district.asset !== `sales-${district.code}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.json.gz`) {
    throw new Error(`${district.name} 매매 자료 해시가 일치하지 않습니다.`)
  }
  const data = JSON.parse(bytes.toString('utf8'))
  createCatalog(data, district.code, index)
  apartments += data.apartments.length
}
console.log(`매매 자료 검사 통과: ${index.districts.length}개 지역 · ${apartments}개 단지 자료 · ${index.collectedOn} 수집`)
