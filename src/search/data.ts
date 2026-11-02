import { validateNetwork } from './routing.ts'

export async function decodeJson(bytes: ArrayBuffer): Promise<unknown> {
  const header = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength))
  let value: unknown
  if (header[0] === 0x1f && header[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('교통 자료를 읽으려면 브라우저를 최신 버전으로 업데이트해 주세요.')
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      value = await new Response(stream).json()
    } catch { throw new Error('교통 자료의 압축 또는 JSON 형식이 올바르지 않습니다.') }
  } else {
    // 호스팅 서버가 이미 압축을 해제해 전달한 응답도 처리한다.
    try { value = JSON.parse(new TextDecoder().decode(bytes)) }
    catch { throw new Error('교통 자료의 JSON 형식이 올바르지 않습니다.') }
  }
  return value
}

export async function decodeNetwork(bytes: ArrayBuffer) {
  return validateNetwork(await decodeJson(bytes))
}

async function download(url: string | URL, cache?: RequestCache) {
  let response: Response
  try { response = await fetch(url, { cache }) }
  catch { throw new Error('교통 자료를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.') }
  if (!response.ok) throw new Error('교통 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
  return response
}

export async function loadNetwork(url: string) {
  const response = await download(url, 'no-cache')
  let manifest
  try { manifest = await response.json() }
  catch { throw new Error('교통 자료 배포 정보가 올바르지 않습니다.') }
  if (manifest?.asset !== undefined) {
    if (manifest.status !== 'ready' || manifest.version !== 1 || typeof manifest.asset !== 'string'
      || !/^transit-[a-f0-9]{12}\.json\.gz$/.test(manifest.asset)) throw new Error('교통 자료 배포 정보가 올바르지 않습니다.')
    const packed = await download(new URL(manifest.asset, url))
    return decodeNetwork(await packed.arrayBuffer())
  }
  return validateNetwork(manifest)
}
