import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { inServiceArea, queryPlaces, toPlace } from '../search/places'
import type { Place } from '../search/types'
import TravelTimeSelect from './TravelTimeSelect'
import SearchSelect from './SearchSelect'

const transferOptions = Array.from({ length: 4 }, (_, value) => ({ value, label: value ? `환승 ${value}회 이하` : '환승 0회' }))

interface DestinationSearchProps {
  busy: boolean
  onSearch(destination: Place, minMinutes: number, maxMinutes: number, maxTransfers: number): void
  onReset(): void
  onCancel(): void
}

export default function DestinationSearch({ busy, onSearch, onReset, onCancel }: DestinationSearchProps) {
  const [query, setQuery] = useState('')
  const [destination, setDestination] = useState<Place | null>(null)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [maxTransfers, setMaxTransfers] = useState(3)
  const [places, setPlaces] = useState<Place[]>([])
  const [message, setMessage] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const messageId = useId()

  useEffect(() => {
    if (destination || query.trim().length < 2) {
      setPlaces([])
      setMessage('')
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setMessage('장소를 찾고 있습니다.')
      try {
        const response = await queryPlaces(query.trim(), controller.signal)
        if (controller.signal.aborted) return
        const found = response.data.filter(item => inServiceArea(item.address_name))
          .map(toPlace).filter((place): place is Place => place !== null)
        setPlaces(found)
        setActive(-1)
        setMessage(found.length ? '목적지를 목록에서 선택해 주세요.' : '서울·경기도 장소를 찾지 못했습니다. 지역명도 함께 입력해 주세요.')
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : '장소 검색을 완료하지 못했습니다.')
      }
    }, 350)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [query, destination])

  useEffect(() => {
    if (open && active >= 0) listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (place: Place) => {
    setDestination(place)
    setQuery(place.name)
    setOpen(false)
    setPlaces([])
    setMessage('')
    onReset()
  }

  const submit = () => {
    if (destination && minutes !== null && !busy) onSearch(destination, minutes - 10, minutes, maxTransfers)
  }

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setActive(index => Math.max(0, Math.min(places.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))))
    } else if (event.key === 'Enter' && open && active >= 0 && places[active]) {
      event.preventDefault()
      choose(places[active])
    } else if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="destination-search" role="search" aria-label="도착 시간으로 아파트 검색">
      <div className="destination-field" onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}>
        <label>
          <span className="visually-hidden">목적지 검색</span>
          <input className="destination-input" type="search" name="destination" placeholder="목적지"
            autoComplete="off" enterKeyHint="search" spellCheck={false} value={query}
            role="combobox" aria-autocomplete="list" aria-expanded={open && places.length > 0}
            aria-controls={listId} aria-describedby={open && message ? messageId : undefined}
            aria-activedescendant={open && active >= 0 && places[active] ? `${listId}-${active}` : undefined}
            onFocus={() => setOpen(true)} onKeyDown={handleKey}
            onChange={event => {
              setQuery(event.target.value)
              setDestination(null)
              setPlaces([])
              setMessage('')
              setActive(-1)
              setOpen(true)
              onReset()
            }} />
        </label>
        {open && (places.length > 0 || message) && (
          <div className="destination-suggestions">
            {message && <p id={messageId} role="status">{message}</p>}
            {places.length > 0 && <ul ref={listRef} id={listId} role="listbox" aria-label="목적지 검색 결과">
              {places.map((place, index) => (
                <li key={place.id} id={`${listId}-${index}`} role="option" aria-selected={active === index}
                  onMouseDown={event => event.preventDefault()} onClick={() => choose(place)}>
                  <strong>{place.name}</strong><span>{place.address}</span>
                </li>
              ))}
            </ul>}
          </div>
        )}
      </div>
      <div className="search-options">
        <TravelTimeSelect label="소요 시간" value={minutes} onChange={value => { setMinutes(value); onReset() }} />
        <SearchSelect label="최대 환승 횟수" value={maxTransfers} options={transferOptions} className="transfer-count-field"
          onChange={value => { setMaxTransfers(value); onReset() }} />
        {busy
          ? <button className="search-button" type="button" onClick={event => { event.preventDefault(); onCancel() }}>중단</button>
          : <button className="search-button" type="button" disabled={!destination || minutes === null} onClick={submit}>검색</button>}
      </div>
    </div>
  )
}
