import test from 'node:test'
import assert from 'node:assert/strict'
import { initialView, isViewLoading, viewReducer } from '../src/search/view.ts'
import type { ApartmentResult, SearchSnapshot } from '../src/search/types.ts'

const bounds = { south: 37.39, north: 37.41, west: 127.09, east: 127.11 }
const apartment = (id: string, seconds: number, lng = 127.1): ApartmentResult => ({ id, name: id, address: '', url: '',
  lat: 37.4, lng, seconds, transfers: 0, startStop: '', legs: [] })
const snapshot = (results: ApartmentResult[], status: SearchSnapshot['status'] = 'loading'): SearchSnapshot =>
  ({ ...initialView.snapshot, results, status })

test('같은 환승 분류의 더 빠른 결과가 늦게 도착해도 기존 순서를 보존한다', () => {
  const a = apartment('먼저', 1200), b = apartment('나중', 600)
  let view = viewReducer(initialView, { type: 'begin', bounds })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([a]) })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([b, a]) })
  assert.deepEqual(view.results, [a, b])
  assert.equal(view.results[0], a)
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([b, a], 'complete') })
  assert.deepEqual(view.results, [a, b])
})

test('지도 밖 결과와 진행률 변경은 현재 목록을 재생성하지 않는다', () => {
  const a = apartment('지도 안', 1000), b = apartment('지도 밖', 600, 127.2)
  let view = viewReducer(initialView, { type: 'begin', bounds })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([a]) })
  const previous = view.results
  view = viewReducer(view, { type: 'snapshot', snapshot: { ...snapshot([a, b]), completed: 20 } })
  assert.equal(view.results, previous)
  assert.equal(view.results.length, 1)
})

test('지도 확대·축소·이동으로 보이지 않게 된 집도 목록과 기존 순서에 남긴다', () => {
  const a = apartment('지도 안', 1000), b = apartment('새로 보이는 집', 600, 127.2)
  let view = viewReducer(initialView, { type: 'begin', bounds })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([b, a]) })
  view = viewReducer(view, { type: 'bounds', bounds: { ...bounds, east: 127.21 } })
  assert.deepEqual(view.results, [a, b])
  const previous = view.results
  view = viewReducer(view, { type: 'bounds', bounds: { ...bounds, west: 127.19, east: 127.21 } })
  assert.equal(view.results, previous)
  view = viewReducer(view, { type: 'bounds', bounds: { ...bounds, west: 128, east: 129 } })
  assert.equal(view.results, previous)
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([b, a], 'complete') })
  assert.equal(view.results, previous)
  for (let repeat = 0; repeat < 3; repeat++) {
    view = viewReducer(view, { type: 'bounds', bounds })
    view = viewReducer(view, { type: 'bounds', bounds: { ...bounds, east: 127.21 } })
    assert.equal(view.results, previous)
  }
})

test('소요시간 재정렬은 사용자 요청 시 적용하며 이후 결과는 기존 순서 뒤에 추가한다', () => {
  const a = apartment('늦은 집', 1000), b = apartment('빠른 집', 600), c = apartment('새 집', 500)
  let view = viewReducer(initialView, { type: 'begin', bounds })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([a]) })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([a, b]) })
  view = viewReducer(view, { type: 'sort' })
  assert.deepEqual(view.results, [b, a])
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([c, b, a]) })
  assert.deepEqual(view.results, [b, a, c])
})

test('현재 지도 조회와 다른 지역 백그라운드 조회 상태를 구분한다', () => {
  let view = viewReducer(initialView, { type: 'begin', bounds })
  assert.equal(isViewLoading(view), true)
  view = viewReducer(view, { type: 'snapshot', snapshot: { ...snapshot([]), pendingAreas: [{ ...bounds, west: 127.2, east: 127.3 }] } })
  assert.equal(isViewLoading(view), false)
  view = viewReducer(view, { type: 'bounds', bounds: { ...bounds, east: 127.25 } })
  assert.equal(isViewLoading(view), true)
  view = viewReducer(view, { type: 'cancel' })
  assert.equal(isViewLoading(view), false)
})

test('다시 검색하거나 조건을 지우면 이전 목록과 순서를 비운다', () => {
  let view = viewReducer(initialView, { type: 'begin', bounds })
  view = viewReducer(view, { type: 'snapshot', snapshot: snapshot([apartment('이전 집', 600)]) })
  assert.equal(viewReducer(view, { type: 'begin', bounds }).results.length, 0)
  assert.equal(viewReducer(view, { type: 'reset' }).results.length, 0)
})
