import test from 'node:test'
import assert from 'node:assert/strict'
import { sortApartments } from '../src/search/routing.ts'
import { resultGroup } from '../src/search/resultOrder.ts'
import { initialView, viewReducer } from '../src/search/view.ts'
import type { ApartmentResult, RouteLeg } from '../src/search/types.ts'

const apartment = (id: string, seconds: number, mode: RouteLeg['mode'], typeName?: string): ApartmentResult => ({
  id, name: id, lat: 37.4, lng: 127.1, address: '', url: '', transfers: 0, startStop: '', seconds,
  legs: [{ mode, typeName, from: '출발', to: '도착', seconds, line: '102', color: '#E60012' }],
})
const rail = apartment('지하철', 1200, 'rail', '신분당선')
const express = apartment('빨간 좌석버스', 900, 'bus', '직행좌석')
const bus = apartment('마을버스', 300, 'bus', '마을')

test('무환승 지하철·빨간 좌석버스·기타 버스 순으로 시간보다 수단을 우선한다', () => {
  const seated = apartment('파란 좌석버스', 200, 'bus', '좌석')
  const walk = apartment('도보', 60, 'walk')
  const transfer = { ...rail, id: '환승 지하철', seconds: 30, transfers: 1 }
  assert.deepEqual(sortApartments([transfer, bus, express, seated, rail, walk]).map(result => result.id),
    [rail.id, express.id, seated.id, bus.id, walk.id, transfer.id])
  assert.equal(resultGroup(apartment('광역', 900, 'bus', '광역')), 'express')
  assert.equal(resultGroup(apartment('번호가 같은 일반버스', 900, 'bus', '일반')), 'bus')
  assert.equal(resultGroup(apartment('분류 미확인', 900, 'bus')), 'bus')
})

test('늦게 도착한 우선 수단은 앞에 추가하되 각 수단의 기존 읽던 순서는 유지한다', () => {
  const bounds = { south: 37.39, north: 37.41, west: 127.09, east: 127.11 }
  let view = viewReducer(initialView, { type: 'begin', bounds })
  const publish = (results: ApartmentResult[]) => {
    view = viewReducer(view, { type: 'snapshot', snapshot: { ...initialView.snapshot, status: 'loading', results } })
  }
  const laterBus = { ...bus, id: '늦게 찾은 빠른 버스', seconds: 100 }
  publish([bus])
  publish([bus, express, laterBus])
  publish([bus, express, laterBus, rail])
  assert.deepEqual(view.results, [rail, express, bus, laterBus])
  assert.equal(view.results[2], bus)
  view = viewReducer(view, { type: 'sort' })
  assert.deepEqual(view.results, [rail, express, laterBus, bus])
})
