import { sortApartments } from './routing'
import type { Bounds } from './bounds'
import { inServiceArea, queryPlaces, toPlace } from './places'
import { retainRoutingWorker, routingTask } from './workerClient'
import type { ApartmentResult, Place, SearchArea, SearchPlan, SearchProgress, SearchSnapshot } from './types'

type PlaceResponse = Awaited<ReturnType<typeof queryPlaces>>
type ResponseOutcome = { response: PlaceResponse; error?: never } | { response?: never; error: unknown }
type CompletedArea = { area: SearchArea; outcome: ResponseOutcome }
let searchSequence = 0

// 응답 완료와 다음 요청 시각 중 먼저 오는 쪽을 처리한다. 취소·완료된 타이머는 남기지 않는다.
async function waitForResponse(pending: Iterable<Promise<CompletedArea>>, delay: number | undefined, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  try {
    return await Promise.race([...pending, new Promise<undefined>((resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      if (delay !== undefined) timer = setTimeout(() => resolve(undefined), delay)
      if (signal.aborted) abort()
    })])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export async function searchApartments(destination: Place, minMinutes: number, maxMinutes: number, parentSignal: AbortSignal,
  update: (snapshot: SearchSnapshot) => void, getViewport: () => Bounds | null = () => null) {
  if (!Number.isFinite(minMinutes) || minMinutes < 0 || minMinutes > maxMinutes) throw new Error('소요 시간을 확인해 주세요.')
  parentSignal.throwIfAborted()
  const controller = new AbortController()
  const abort = () => controller.abort(parentSignal.reason)
  parentSignal.addEventListener('abort', abort, { once: true })
  const signal = controller.signal
  const session = ++searchSequence
  const initialBounds = getViewport()
  const started = performance.now()
  const request = (bounds: Bounds, page = 1): Promise<ResponseOutcome> => queryPlaces('아파트', signal, bounds, page)
    .then<ResponseOutcome, ResponseOutcome>(response => ({ response }), error => ({ error }))
  // 첫 화면의 장소 응답과 Worker의 교통망·조회 구역 준비를 동시에 기다린다.
  const early = initialBounds ? request(initialBounds) : undefined
  const release = retainRoutingWorker()
  let results: ApartmentResult[] = []
  let progress: SearchProgress = { completed: 0, total: 0, limited: false, pendingAreas: [] }
  let plan: SearchPlan | undefined
  const emit = (status: SearchSnapshot['status'], message: string) => update({ ...progress, status, message, results,
    notice: '각 도보 구간이 5분 이하인 경로에서 환승 없는 경로를 우선합니다. 교통 자료로 추정한 결과이며 실제 운행은 외부 길찾기에서 확인해 주세요.',
    source: plan?.source, coverage: plan?.coverage })
  try {
    plan = await routingTask<SearchPlan>({ kind: 'plan', session, destination, minutes: maxMinutes, bounds: initialBounds }, signal)
    signal.throwIfAborted()
    progress = plan
    emit('loading', '집을 계속 찾고 있어요.')
    const pending = new Map<number, Promise<CompletedArea>>()
    if (plan.initialArea && early) {
      const area = plan.initialArea
      pending.set(area.id, early.then(outcome => ({ area, outcome })))
    } else if (early) await early
    let nextRequest = early ? started + 200 : 0
    let available = true
    while (available || pending.size) {
      signal.throwIfAborted()
      const remaining = nextRequest - performance.now()
      // 호출 간격은 유지하며 최대 두 응답만 겹쳐 기다린다. 새 지도 영역은 요청 직전에 반영한다.
      if (available && pending.size < 2 && remaining <= 0) {
        const area = await routingTask<SearchArea | undefined>({ kind: 'next', session, bounds: getViewport() }, signal)
        available = !!area
        if (area) {
          nextRequest = performance.now() + 200
          pending.set(area.id, request(area.bounds, area.page).then(outcome => ({ area, outcome })))
        }
        continue
      }
      const finished = await waitForResponse(pending.values(), available && pending.size < 2 ? Math.max(0, remaining) : undefined, signal)
      if (!finished) continue
      pending.delete(finished.area.id)
      signal.throwIfAborted()
      if ('error' in finished.outcome) throw finished.outcome.error
      const response = finished.outcome.response!
      const places = response.data.filter(data => /아파트\s*$/.test(data.category_name) && inServiceArea(data.address_name))
        .map(toPlace).filter((place): place is Place => place !== null)
      const { added, ...accepted } = await routingTask<SearchProgress & { added: ApartmentResult[] }>({ kind: 'accept', session,
        area: finished.area.id, page: { count: response.data.length, total: response.total, more: response.more }, places, minMinutes }, signal)
      signal.throwIfAborted()
      progress = accepted
      if (added.length) results = [...results, ...sortApartments(added)]
      // 지도 이벤트와 무관하게 검증을 마친 응답마다 목록·클러스터를 갱신한다.
      emit('loading', '집을 계속 찾고 있어요.')
      available = true
    }
    signal.throwIfAborted()
    emit('complete', '검색을 완료했습니다.')
  } catch (error) {
    if (parentSignal.aborted) throw error
    emit('error', error instanceof Error ? error.message : '아파트 조회를 완료하지 못했습니다.')
  } finally {
    parentSignal.removeEventListener('abort', abort)
    controller.abort()
    release()
  }
}
