import assert from 'node:assert/strict'
import test from 'node:test'
import { routeAppearance } from '../src/lib/routePresentation.ts'
import type { RouteLeg } from '../src/search/types.ts'

const ride = (color: string, typeName: string, mode: RouteLeg['mode'] = 'bus'): RouteLeg =>
  ({ mode, from: '승차', to: '하차', seconds: 600, line: '102번', color, typeName })

test('같은 102번도 종류에 따라 색을 구별하고 탑승 순서가 달라도 유지한다', () => {
  const express = ride('#E60012', '직행좌석'), local = ride('#2A9B48', '일반')
  assert.deepEqual(routeAppearance([express, local]).map(style => [style.label, style.color]), [
    ['직행좌석', '#E60012'], ['일반', '#2A9B48'],
  ])
  assert.deepEqual(routeAppearance([local, express])[1], routeAppearance([express])[0])
})

test('지하철 노선색은 환승 순서가 달라도 유지하고 밝은 노선의 글자를 읽을 수 있게 한다', () => {
  const bundang = ride('#F5A200', '수인분당선', 'rail'), first = ride('#0052A4', '1호선', 'rail')
  const styles = routeAppearance([bundang, first])
  assert.equal(styles[0].color, '#F5A200')
  assert.equal(styles[0].ink, '#000000')
  assert.equal(styles[1].color, '#0052A4')
  assert.equal(styles[1].ink, '#ffffff')
  assert.deepEqual(routeAppearance([first, bundang])[1], styles[0])
})

test('분류·색상 정보가 없으면 번호를 보고 직행좌석이나 특정 지하철로 추측하지 않는다', () => {
  const unknown: RouteLeg = { mode: 'bus', from: '승차', to: '하차', seconds: 600, line: '102번' }
  assert.deepEqual(routeAppearance([unknown])[0], { color: '#64748B', ink: '#ffffff', label: '버스' })
  assert.equal(routeAppearance([{ ...unknown, color: '잘못된 값' }])[0].color, '#64748B')
})
