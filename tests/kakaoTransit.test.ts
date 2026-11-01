import test from 'node:test'
import assert from 'node:assert/strict'
import { transitUrl, readJourneys, pickJourney, requestTransit } from '../src/search/kakaoTransit.ts'
import { searchApartments } from '../src/search/search.ts'

const origin = { lat: 37.394717, lng: 127.111181 }
const goal = { lat: 37.498185, lng: 127.027819 }
// 실제 운행·서비스 응답이 아닌 명세 검증용 응답이다.
const response = (seconds = 1089, transfers = 0) => ({ result_code: 0, journeys: [
  { summary: { total_time: seconds, transfer_count: transfers }, sections: [{ time: 1, waiting_time: 9999 }] },
] })

test('집에서 목적지 방향의 경도·위도와 교통수단·운행일 유형을 요청한다', () => {
  const url = transitUrl(origin, goal, 'Holiday')
  assert.equal(url.searchParams.get('start'), '127.111181,37.394717')
  assert.equal(url.searchParams.get('goal'), '127.027819,37.498185')
  assert.equal(url.searchParams.get('route_type'), 'All')
  assert.equal(url.searchParams.get('day_type'), 'Holiday')
  assert.throws(() => transitUrl({ lat: NaN, lng: 127 }, goal, 'Weekday'), /좌표/)
})

test('API 총시간을 그대로 사용하고 더 느린 경로로 최소 시간을 맞추지 않는다', () => {
  const journeys = [...readJourneys(response(600, 2)), ...readJourneys(response(600, 0)), ...readJourneys(response(1200, 0))]
  assert.equal(pickJourney(journeys, 0, 10)?.seconds, 600)
  assert.equal(pickJourney(journeys, 0, 10)?.transfers, 0)
  assert.equal(pickJourney(journeys, 10, 20)?.seconds, 600)
  assert.equal(pickJourney(journeys, 20, 30), null)
  assert.equal(pickJourney(readJourneys(response(0)), 0, 10)?.seconds, 0)
})

test('API 오류·누락·잘못된 시간을 자체 추정값이나 정상적인 빈 결과로 대체하지 않는다', () => {
  for (const value of [null, { result_code: 5 }, { result_code: 0, journeys: [] }, response(-1), response(10, -1)]) {
    assert.throws(() => readJourneys(value), /카카오 길찾기/)
  }
})

test('인증·쿼터 오류·취소는 자동 재시도나 자체 계산 없이 종료한다', async () => {
  const signal = new AbortController().signal
  for (const [status, message] of [[403, /사용 승인/], [429, /이용 한도/]] as const) {
    let calls = 0
    await assert.rejects(requestTransit(origin, goal, 'Weekday', signal, async () => {
      calls++
      return new Response('', { status })
    }), message)
    assert.equal(calls, 1)
  }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(requestTransit(origin, goal, 'Weekday', controller.signal, async () => { throw new Error('호출되면 안 됩니다.') }), { name: 'AbortError' })
  const result = await requestTransit(origin, goal, 'Weekday', signal, async () => Response.json(response()))
  assert.equal(result[0].seconds, 1089)
})

test('승인 전 검색은 외부 호출과 자체 계산 없이 준비 상태로 종료한다', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('호출되면 안 됩니다.') })
  const place = { ...origin, id: '검증', name: '검증', address: '', url: '' }
  await assert.rejects(searchApartments(place, 0, 10, new AbortController().signal, () => assert.fail('결과를 만들면 안 됩니다.')), /연동을 준비/)
  assert.equal((fetch as unknown as { mock: { callCount(): number } }).mock.callCount(), 0)
})
