interface MapPosition {
  getLat(): number
  getLng(): number
}

export interface MapInstance {
  getCenter(): MapPosition
  setCenter(position: MapPosition): void
  relayout(): void
}

interface MapsSdk {
  load(callback: () => void): void
  LatLng: new (latitude: number, longitude: number) => MapPosition
  Map: new (
    container: HTMLElement,
    options: { center: MapPosition; level: number },
  ) => MapInstance
}

declare global {
  interface Window {
    kakao?: { maps: MapsSdk }
  }
}

let sdkPromise: Promise<MapsSdk> | undefined

export function loadKakaoMaps(appKey: string): Promise<MapsSdk> {
  if (!appKey) {
    return Promise.reject(new Error('Kakao 지도 JavaScript 키가 필요합니다.'))
  }

  if (window.kakao?.maps.Map) {
    return Promise.resolve(window.kakao.maps)
  }

  if (sdkPromise) {
    return sdkPromise
  }

  sdkPromise = new Promise<MapsSdk>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`
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
          if (!maps.Map) {
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
