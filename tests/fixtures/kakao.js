// 브라우저 검증 전용 SDK 대역이다. 이 파일과 가상 장소는 배포에 포함하지 않는다.
(() => {
  const state = window.__searchTest = { calls: [], markers: [], failAfter: Infinity, delay: 10, clusterOptions: null }
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng }
    getLat() { return this.lat }
    getLng() { return this.lng }
  }
  class Map {
    constructor(container, options) { this.container = container; this.center = options.center; state.map = this }
    getCenter() { return this.center }
    setCenter(center) { this.center = center }
    relayout() {}
    setBounds() { state.fitCount = (state.fitCount || 0) + 1 }
    panTo(center) { this.center = center }
    setLevel(level) { state.level = level }
  }
  class LatLngBounds { extend() {} }
  class Marker { constructor(options) { this.options = options } setMap() {} }
  class CustomOverlay {
    constructor(options) { this.content = options.content }
    setMap(map) { if (map) map.container.append(this.content); else this.content.remove() }
  }
  class MarkerClusterer {
    constructor(options) { this.options = options; state.clusterOptions = options; state.clusterer = this }
    clear() { state.markers = []; this.element?.remove() }
    addMarkers(markers) {
      state.markers = markers
      if (!markers.length) return
      const element = this.element = document.createElement('button')
      element.className = 'test-cluster'
      element.textContent = this.options.texts(markers.length)
      Object.assign(element.style, this.options.styles[0], { position: 'absolute', top: '45%', left: '45%' })
      element.onclick = () => this.listener?.({ getMarkers: () => markers, getBounds: () => new LatLngBounds() })
      this.options.map.container.append(element)
    }
  }
  const place = (id, name, lat, lng, extra = {}) => ({ id, place_name: name, x: String(lng), y: String(lat),
    address_name: '경기 성남시 분당구', road_address_name: '경기 성남시 검증로 1',
    category_name: '부동산 > 주거시설 > 아파트', place_url: '', ...extra })
  state.destination = place('destination', '검증 목적지', 37.4, 127.16, { category_name: '교통 > 지하철역' })
  state.homes = [place('slow', '검증 느린 아파트', 37.43, 127.11), place('transfer', '검증 환승 아파트', 37.42, 127.1),
    place('fast', '검증 직행 아파트', 37.4, 127.1), place('walk', '검증 도보 아파트', 37.4005, 127.16),
    place('far', '검증 시간초과 아파트', 37.5, 127.1), place('office', '검증 상가', 37.4, 127.1, { category_name: '부동산 > 상가' }),
    place('outside', '검증 지역외 아파트', 37.4, 127.1, { address_name: '부산 해운대구' })]
  function distance(a, b) {
    const r = Math.PI / 180
    return 12742000 * Math.asin(Math.sqrt(Math.sin((a.lat - b.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((a.lng - b.lng) * r / 2) ** 2))
  }
  class Places {
    keywordSearch(query, callback, options) {
      state.calls.push({ query, page: options.page })
      const failed = state.calls.filter(call => call.query === '아파트').length > state.failAfter
      setTimeout(() => {
        if (query !== '아파트') { callback([state.destination], 'OK', { hasNextPage: false, totalCount: 1 }); return }
        if (failed) { callback([], 'ERROR', {}); return }
        const all = state.homes.filter(home => distance(options.location, { lat: Number(home.y), lng: Number(home.x) }) <= options.radius)
        const offset = (options.page - 1) * 2
        const data = all.slice(offset, offset + 2)
        callback(data, data.length ? 'OK' : 'ZERO_RESULT', { hasNextPage: offset + 2 < all.length, totalCount: all.length })
      }, state.delay)
    }
  }
  window.kakao = { maps: { load: callback => callback(), LatLng, Map, LatLngBounds, Marker, CustomOverlay, MarkerClusterer,
    event: { addListener: (target, name, callback) => target.listener = callback, removeListener: target => target.listener = null },
    services: { Places, Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' }, SortBy: { DISTANCE: 'distance' } } } }
})()
