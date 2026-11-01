export interface MapPosition {
  getLat(): number
  getLng(): number
}

export interface MapInstance {
  getCenter(): MapPosition
  setCenter(position: MapPosition): void
  relayout(): void
  setBounds(bounds: MapBounds, top?: number, right?: number, bottom?: number, left?: number): void
  panTo(position: MapPosition): void
  setLevel(level: number): void
}

interface MapBounds { extend(position: MapPosition): void }
export interface MapMarker { setMap(map: MapInstance | null): void }
export interface MapCluster { getMarkers(): MapMarker[]; getBounds(): MapBounds }
export interface PlaceData {
  id: string; place_name: string; address_name: string; road_address_name: string
  x: string; y: string; place_url: string; category_name: string
}
export interface PlacePage { hasNextPage: boolean; totalCount: number }
export interface PlaceOptions { rect?: string; page?: number; size?: number }
export interface MapsSdk {
  load(callback: () => void): void
  LatLng: new (latitude: number, longitude: number) => MapPosition
  Map: new (
    container: HTMLElement,
    options: { center: MapPosition; level: number },
  ) => MapInstance
  LatLngBounds: new () => MapBounds
  Marker: new (options: { position: MapPosition; title?: string }) => MapMarker
  CustomOverlay: new (options: { position: MapPosition; content: HTMLElement; yAnchor?: number; zIndex?: number }) => {
    setMap(map: MapInstance | null): void
  }
  MarkerClusterer: new (options: {
    map: MapInstance; gridSize: number; averageCenter: boolean; minLevel: number
    minClusterSize: number; disableClickZoom: boolean; texts: (size: number) => string
    calculator: number[]
    styles: Record<string, string>[]
  }) => { clear(): void; addMarkers(markers: MapMarker[]): void }
  event: {
    addListener(target: object, name: string, callback: (cluster: MapCluster) => void): void
    removeListener(target: object, name: string, callback: (cluster: MapCluster) => void): void
  }
  services: {
    Status: { OK: string; ZERO_RESULT: string; ERROR: string }
    SortBy: { DISTANCE: string }
    Places: new () => {
      keywordSearch(query: string, callback: (data: PlaceData[], status: string, page: PlacePage) => void, options?: PlaceOptions): void
    }
  }
}

declare global {
  interface Window {
    kakao?: { maps: MapsSdk }
  }
}

let sdkPromise: Promise<MapsSdk> | undefined
const ready = (maps?: MapsSdk) => Boolean(maps?.Map && maps.services?.Places && maps.MarkerClusterer)

export function loadAppMaps() {
  return loadKakaoMaps(import.meta.env.VITE_KAKAO_MAP_KEY?.trim() ?? '')
}

export function loadKakaoMaps(appKey: string): Promise<MapsSdk> {
  if (!appKey) {
    return Promise.reject(new Error('Kakao 지도 JavaScript 키가 필요합니다.'))
  }

  if (ready(window.kakao?.maps)) {
    return Promise.resolve(window.kakao!.maps)
  }

  if (sdkPromise) {
    return sdkPromise
  }

  sdkPromise = new Promise<MapsSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services,clusterer`
    script.async = true

    const clear = () => {
      window.clearTimeout(timeout)
      script.onload = null
      script.onerror = null
    }

    const fail = () => {
      clear()
      script.remove()
      reject(new Error('Kakao 지도 SDK를 불러오지 못했습니다.'))
    }

    const timeout = window.setTimeout(fail, 15_000)

    script.onload = () => {
      const maps = window.kakao?.maps

      if (!maps?.load) {
        fail()
        return
      }

      try {
        maps.load(() => {
          if (!ready(maps)) {
            fail()
            return
          }

          clear()
          resolve(maps)
        })
      } catch {
        fail()
      }
    }

    script.onerror = fail
    document.head.append(script)
  }).catch((error: unknown) => {
    sdkPromise = undefined
    throw error
  })

  return sdkPromise
}
