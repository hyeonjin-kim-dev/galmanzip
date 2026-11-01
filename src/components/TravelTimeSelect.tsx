import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

const travelTimes = Array.from({ length: 18 }, (_, index) => {
  const minutes = (index + 1) * 10
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  const label = hours ? `${hours}시간${remainder ? ` ${remainder}분` : ''}` : `${minutes}분`
  return { minutes, label: `약 ${label}` }
})

interface TravelTimeSelectProps {
  label: string
  value: number | null
  onChange(minutes: number): void
}

export default function TravelTimeSelect({ label, value: minutes, onChange }: TravelTimeSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [keyboardNavigation, setKeyboardNavigation] = useState(false)
  const [layout, setLayout] = useState({ side: 'bottom', maxHeight: 240 })
  const selectedIndex = travelTimes.findIndex((option) => option.minutes === minutes)

  const openList = (index = Math.max(selectedIndex, 0), keyboard = false) => {
    setActiveIndex(index)
    setKeyboardNavigation(keyboard)
    setOpen(true)
  }

  const selectOption = (index: number) => {
    onChange(travelTimes[index].minutes)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        if (open) {
          setKeyboardNavigation(true)
          setActiveIndex((index) => Math.max(0, Math.min(travelTimes.length - 1, index + direction)))
        } else {
          openList(selectedIndex >= 0 ? selectedIndex : direction === 1 ? 0 : travelTimes.length - 1, true)
        }
        break
      }
      case 'Home':
      case 'End':
        event.preventDefault()
        openList(event.key === 'Home' ? 0 : travelTimes.length - 1, true)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) {
          selectOption(activeIndex)
        } else {
          openList(Math.max(selectedIndex, 0), true)
        }
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [open])

  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const updateLayout = () => {
      const trigger = triggerRef.current
      const list = listRef.current
      if (!trigger || !list) {
        return
      }

      const viewport = window.visualViewport
      const viewportTop = viewport?.offsetTop ?? 0
      const viewportBottom = viewportTop + (viewport?.height ?? window.innerHeight)
      const rect = trigger.getBoundingClientRect()
      const below = viewportBottom - rect.bottom - 8
      const above = rect.top - viewportTop - 8
      const side = below < list.scrollHeight + 2 && above > below ? 'top' : 'bottom'
      setLayout({
        side,
        maxHeight: Math.max(32, Math.min(240, side === 'top' ? above : below)),
      })
    }

    updateLayout()
    window.addEventListener('resize', updateLayout)
    window.visualViewport?.addEventListener('resize', updateLayout)
    window.visualViewport?.addEventListener('scroll', updateLayout)
    return () => {
      window.removeEventListener('resize', updateLayout)
      window.visualViewport?.removeEventListener('resize', updateLayout)
      window.visualViewport?.removeEventListener('scroll', updateLayout)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, activeIndex])

  return (
    <div
      ref={rootRef}
      className="travel-time-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <input type="hidden" name={label} value={minutes ?? ''} />
      <button
        ref={triggerRef}
        className="travel-time-select"
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
        data-placeholder={minutes === null}
        onClick={() => open ? setOpen(false) : openList()}
        onKeyDown={handleKeyDown}
      >
        <span className="travel-time-label">
          {selectedIndex >= 0 ? travelTimes[selectedIndex].label : label}
        </span>
        {travelTimes.map((option) => (
          <span key={option.minutes} className="travel-time-size" aria-hidden="true">
            {option.label}
          </span>
        ))}
        <svg className="travel-time-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="travel-time-list"
          role="listbox"
          aria-label={label}
          data-placement={layout.side}
          style={{ maxHeight: layout.maxHeight }}
          onPointerDown={(event) => event.preventDefault()}
        >
          {travelTimes.map((option, index) => (
            <li
              key={option.minutes}
              id={`${listId}-${index}`}
              className="travel-time-option"
              role="option"
              aria-selected={option.minutes === minutes}
              data-active={keyboardNavigation && index === activeIndex}
              onPointerMove={(event) => {
                if (event.pointerType !== 'touch') {
                  setKeyboardNavigation(false)
                  setActiveIndex(index)
                }
              }}
              onClick={() => selectOption(index)}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
