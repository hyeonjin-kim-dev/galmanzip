import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'

const positions = ['collapsed', 'half', 'expanded'] as const
type SheetPosition = (typeof positions)[number]

interface MapPanelProps {
  onHeightChange(height: string): void
  search: ReactNode
  children: ReactNode
  searchVersion: number
  selection: { id: string } | null
}

export default function MapPanel({ onHeightChange, search, children, searchVersion, selection }: MapPanelProps) {
  const panelRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const suppressClickRef = useRef(false)
  const [position, setPosition] = useState<SheetPosition>('half')
  const [dragHeight, setDragHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const panel = panelRef.current
    const search = panel?.querySelector<HTMLElement>('.destination-search')
    const page = panel?.parentElement
    if (!search || !page) return
    const measure = () => page.style.setProperty('--search-height', `${search.getBoundingClientRect().height}px`)
    const observer = new ResizeObserver(measure)
    observer.observe(search)
    measure()
    return () => { observer.disconnect(); page.style.removeProperty('--search-height') }
  }, [])

  useEffect(() => {
    if (searchVersion) setPosition(current => current === 'collapsed' ? 'half' : current)
  }, [searchVersion])

  useEffect(() => {
    if (selection && window.matchMedia('(max-width: 767px)').matches) {
      setPosition(current => current === 'expanded' ? 'half' : current)
    }
  }, [selection])

  const getHeights = () => {
    const viewportHeight =
      panelRef.current?.parentElement?.clientHeight ?? window.innerHeight
    const maxHeight = panelRef.current ? parseFloat(getComputedStyle(panelRef.current).maxHeight) : NaN
    const upper = Number.isFinite(maxHeight) ? Math.min(maxHeight, viewportHeight * 0.88) : viewportHeight * 0.88
    return [72, Math.min(viewportHeight * 0.42, upper), upper]
  }

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || !panelRef.current) {
      return
    }

    suppressClickRef.current = false
    dragRef.current = {
      startY: event.clientY,
      startHeight: panelRef.current.getBoundingClientRect().height,
    }
    setDragHeight(dragRef.current.startHeight)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current

    if (!drag) {
      return
    }

    const distance = drag.startY - event.clientY
    const heights = getHeights()
    setDragHeight(
      Math.max(heights[0], Math.min(heights[2], drag.startHeight + distance)),
    )

    if (Math.abs(distance) > 5) {
      suppressClickRef.current = true
    }
  }

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current

    if (!drag) {
      return
    }

    const height = drag.startHeight + drag.startY - event.clientY
    const heights = getHeights()
    const nearest = heights.reduce(
      (closest, value, index) =>
        Math.abs(value - height) < Math.abs(heights[closest] - height) ? index : closest,
      0,
    )
    setPosition(positions[nearest])
    dragRef.current = null
    setDragHeight(null)
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const cancelDrag = () => {
    if (!dragRef.current) {
      return
    }

    dragRef.current = null
    suppressClickRef.current = false
    setDragHeight(null)
  }

  const togglePosition = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    setPosition((current) => (current === 'half' ? 'expanded' : 'half'))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = positions.indexOf(position)
    const next = {
      ArrowUp: Math.min(index + 1, positions.length - 1),
      ArrowDown: Math.max(index - 1, 0),
      Home: 0,
      End: positions.length - 1,
    }[event.key]

    if (next !== undefined) {
      event.preventDefault()
      setPosition(positions[next])
    }
  }

  const height =
    dragHeight === null
      ? { collapsed: '72px', half: '42%', expanded: '88%' }[position]
      : `${dragHeight}px`

  useLayoutEffect(() => {
    onHeightChange(height)
  }, [height, onHeightChange])

  return (
    <aside
      ref={panelRef}
      className="map-panel"
      aria-label="정보 패널"
      data-position={position}
      data-dragging={dragHeight !== null}
    >
      <button
        className="sheet-handle"
        type="button"
        aria-label={position === 'expanded' ? '패널 줄이기' : '패널 펼치기'}
        aria-expanded={position !== 'collapsed'}
        aria-controls="panel-content"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onClick={togglePosition}
        onKeyDown={handleKeyDown}
      >
        <span aria-hidden="true" />
      </button>
      {search}
      <div id="panel-content" className="panel-content" hidden={position === 'collapsed'}>{children}</div>
    </aside>
  )
}
