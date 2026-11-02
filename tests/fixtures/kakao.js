// 브라우저 검증 전용 SDK 대역이다. 이 파일과 가상 장소는 배포에 포함하지 않는다.
(() => {
  const state = window.__searchTest = { calls: [], markers: [], polylines: [], createdMarkers: 0, failAfter: Infinity, delay: 10, pageSize: 2, cappedTotal: false, clusterOptions: null }
  class LatLng {
    constructor(lat, lng) { this.lat = lat; this.lng = lng }
    getLat() { return this.lat }
    getLng() { return this.lng }
  }
  const fire = (target, name, value) => {
    if (name === 'idle' && state.freezeIdle) return
    const listeners = target.events?.[name] ?? []
    listeners.forEach(callback => callback(value))
  }
  class Map {
    constructor(container, options) { this.container = container; this.center = options.center; this.level = options.level; state.map = this; state.level = this.level }
    getCenter() { return this.center }
    getLevel() { return this.level }
    getBounds() {
      if (this.bounds) return this.bounds
      const scale = 2 ** (this.level - 6), lat = 0.012 * scale * this.container.clientHeight / 600, lng = 0.016 * scale * this.container.clientWidth / 900
      return new LatLngBounds(new LatLng(this.center.lat - lat, this.center.lng - lng), new LatLng(this.center.lat + lat, this.center.lng + lng))
    }
    changed() { setTimeout(() => fire(this, 'idle'), 0) }
    setCenter(center) {
      if (this.center.lat !== center.lat || this.center.lng !== center.lng) this.bounds = null
      this.center = center; this.changed()
    }
    relayout() { this.changed() }
    setBounds(bounds) {
      state.fitCount = (state.fitCount || 0) + 1
      const sw = bounds.getSouthWest(), ne = bounds.getNorthEast()
      const lat = Math.max(0.001, (ne.lat - sw.lat) * 0.1), lng = Math.max(0.001, (ne.lng - sw.lng) * 0.1)
      this.bounds = new LatLngBounds(new LatLng(sw.lat - lat, sw.lng - lng), new LatLng(ne.lat + lat, ne.lng + lng))
      this.center = new LatLng((sw.lat + ne.lat) / 2, (sw.lng + ne.lng) / 2)
      this.changed()
    }
    panTo(center) { this.setCenter(center) }
    setLevel(level) { this.level = level; state.level = level; this.bounds = null; this.changed() }
  }
  class LatLngBounds {
    constructor(sw, ne) { this.south = Infinity; this.west = Infinity; this.north = -Infinity; this.east = -Infinity; if (sw) this.extend(sw); if (ne) this.extend(ne) }
    extend(point) { this.south = Math.min(this.south, point.lat); this.north = Math.max(this.north, point.lat); this.west = Math.min(this.west, point.lng); this.east = Math.max(this.east, point.lng) }
    getSouthWest() { return new LatLng(this.south, this.west) }
    getNorthEast() { return new LatLng(this.north, this.east) }
  }
  class Marker { constructor(options) { this.options = options; state.createdMarkers++ } setMap() {} }
  class Polyline {
    constructor(options) { this.options = options; state.polylines.push(this) }
    setMap(map) { this.map = map }
  }
  class CustomOverlay {
    constructor(options) { this.content = options.content }
    setMap(map) { if (map) map.container.append(this.content); else this.content.remove() }
  }
  class MarkerClusterer {
    constructor(options) { this.options = options; state.clusterOptions = options; state.clusterer = this }
    clear() { state.markers = []; this.element?.remove() }
    addMarkers(markers, nodraw) { state.markers.push(...markers); if (!nodraw) this.redraw() }
    removeMarkers(markers, nodraw) { state.markers = state.markers.filter(marker => !markers.includes(marker)); if (!nodraw) this.redraw() }
    redraw() {
      this.element?.remove()
      if (!state.markers.length) return
      const element = this.element = document.createElement('button')
      element.className = 'test-cluster'
      element.textContent = this.options.texts(state.markers.length)
      Object.assign(element.style, this.options.styles[0], { position: 'absolute', top: '45%', left: '45%' })
      element.onclick = () => {
        const bounds = new LatLngBounds()
        state.markers.forEach(marker => bounds.extend(marker.options.position))
        fire(this, 'clusterclick', { getMarkers: () => state.markers, getBounds: () => bounds })
      }
      this.options.map.container.append(element)
    }
  }

  const place = (id, name, lat, lng, extra = {}) => ({ id, place_name: name, x: String(lng), y: String(lat),
    address_name: '경기 성남시 분당구', road_address_name: '경기 성남시 검증로 1',
    category_name: '부동산 > 주거시설 > 아파트', place_url: '', ...extra })
  state.destination = place('destination', '검증 목적지', 37.4, 127.16, { category_name: '교통 > 지하철역' })
  state.homes = [place('slow', '검증 느린 아파트', 37.43, 127.11), place('transfer', '검증 환승 아파트', 37.42, 127.1),
    place('fast', '검증 직행 아파트', 37.4, 127.1), place('walk', '검증 도보 아파트', 37.4052, 127.16),
    place('far', '검증 시간초과 아파트', 37.5, 127.1), place('office', '검증 상가', 37.4, 127.1, { category_name: '부동산 > 상가' }),
    place('outside', '검증 지역외 아파트', 37.4, 127.1, { address_name: '부산 해운대구' })]
  function distance(a, b) {
    const r = Math.PI / 180
    return 12742000 * Math.asin(Math.sqrt(Math.sin((a.lat - b.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((a.lng - b.lng) * r / 2) ** 2))
  }
  class Places {
    keywordSearch(query, callback, options) {
      const call = { query, page: options.page, rect: options.rect, started: performance.now() }
      state.calls.push(call)
      const failed = state.calls.filter(call => call.query === '아파트').length > state.failAfter
      setTimeout(() => {
        call.completed = performance.now()
        if (query !== '아파트') { callback([state.destination], 'OK', { hasNextPage: false, totalCount: 1 }); return }
        if (failed) { callback([], 'ERROR', {}); return }
        const bounds = options.rect?.split(',').map(Number)
        const all = state.homes.filter(home => bounds
          ? Number(home.x) >= bounds[0] && Number(home.y) >= bounds[1] && Number(home.x) <= bounds[2] && Number(home.y) <= bounds[3]
          : distance(options.location, { lat: Number(home.y), lng: Number(home.x) }) <= options.radius)
        const visible = all.slice(0, 45), offset = (options.page - 1) * state.pageSize
        const data = visible.slice(offset, offset + state.pageSize)
        callback(data, data.length ? 'OK' : 'ZERO_RESULT', { hasNextPage: offset + state.pageSize < visible.length,
          totalCount: state.cappedTotal ? visible.length : all.length })
      }, state.delayFor ? state.delayFor(query, options) : state.delay)
    }
  }
  window.kakao = { maps: { load: callback => callback(), LatLng, Map, LatLngBounds, Marker, Polyline, CustomOverlay, MarkerClusterer,
    event: { addListener: (target, name, callback) => { target.events ??= {}; (target.events[name] ??= []).push(callback) }, removeListener: (target, name, callback) => { target.events[name] = (target.events[name] ?? []).filter(value => value !== callback) } },
    services: { Places, Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' }, SortBy: { DISTANCE: 'distance' } } } }
})()
