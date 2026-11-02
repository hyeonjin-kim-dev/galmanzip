import type { RoutingTask } from './types.ts'

let worker: Worker | undefined
let expires = 0
let idleTimer: number | undefined
let sequence = 0
let retained = 0
const pending = new Map<number, (error?: Error, result?: unknown) => void>()

function scheduleRelease() {
  window.clearTimeout(idleTimer)
  const active = worker
  if (!active || retained || pending.size) return
  idleTimer = window.setTimeout(() => {
    if (worker === active) stop(new Error('사용하지 않는 경로 자료를 해제했습니다.'))
  }, 30000)
}

// 장소 응답을 기다리는 동안에도 진행 중인 조회 계획은 유휴 자료가 아니다.
export function retainRoutingWorker() {
  retained++
  window.clearTimeout(idleTimer)
  let released = false
  return () => {
    if (released) return
    released = true
    retained--
    scheduleRelease()
  }
}

function stop(reason: Error) {
  worker?.terminate()
  worker = undefined
  for (const finish of [...pending.values()]) finish(reason)
  window.clearTimeout(idleTimer)
}

export function routingTask<T>(task: RoutingTask, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  window.clearTimeout(idleTimer)
  if (worker && expires <= Date.now()) stop(new Error('교통 자료를 새로 준비합니다. 다시 시도해 주세요.'))
  if (!worker) {
    worker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module' })
    expires = Date.now() + 2 * 3600000
    const created = worker
    worker.onmessage = event => { if (worker === created) pending.get(event.data.id)?.(event.data.error ? new Error(event.data.error) : undefined, event.data.result) }
    worker.onerror = () => { if (worker === created) stop(new Error('경로를 계산하지 못했습니다. 페이지를 새로고침해 주세요.')) }
  }
  const active = worker
  const id = ++sequence
  return new Promise<T>((resolve, reject) => {
    const finish = (error?: Error, result?: unknown) => {
      if (!pending.delete(id)) return
      window.clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(result as T)
      scheduleRelease()
    }
    const abort = () => {
      const error = new DOMException('검색을 취소했습니다.', 'AbortError')
      if (task.kind === 'plan') stop(error)
      else finish(error)
    }
    const timer = window.setTimeout(() => stop(new Error('교통 자료 처리 시간이 초과되었습니다. 다시 시도해 주세요.')), 90000)
    pending.set(id, finish)
    signal.addEventListener('abort', abort, { once: true })
    // 검색과 선택 경로가 겹쳐도 서로의 응답·취소 처리를 덮어쓰지 않는다.
    try { active.postMessage({ ...task, id, url: new URL(`${import.meta.env.BASE_URL}data/transit.json`, location.href).href }) }
    catch { stop(new Error('경로 요청을 전달하지 못했습니다. 다시 시도해 주세요.')) }
  })
}
