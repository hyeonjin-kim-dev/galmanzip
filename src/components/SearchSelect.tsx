import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

interface SearchSelectProps {
  options: { value: number; label: string }[]
  className: string
  label: string
  value: number | null
  onChange(value: number): void
}

export default function SearchSelect({ label, value, options, className, onChange }: SearchSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [keyboardNavigation, setKeyboardNavigation] = useState(false)
  const [layout, setLayout] = useState({ side: 'bottom', maxHeight: 240 })
  const selectedIndex = options.findIndex((option) => option.value === value)

  const openList = (index = Math.max(selectedIndex, 0), keyboard = false) => {
    setActiveIndex(index)
    setKeyboardNavigation(keyboard)
    setOpen(true)
  }

  const selectOption = (index: number) => {
    onChange(options[index].value)
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
          setActiveIndex((index) => Math.max(0, Math.min(options.length - 1, index + direction)))
        } else {
          openList(selectedIndex >= 0 ? selectedIndex : direction === 1 ? 0 : options.length - 1, true)
        }
        break
      }
      case 'Home':
      case 'End':
        event.preventDefault()
        openList(event.key === 'Home' ? 0 : options.length - 1, true)
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
      className={`search-select-field ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false)
        }
      }}
    >
      <input type="hidden" name={label} value={value ?? ''} />
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
        data-placeholder={value === null}
        onClick={() => open ? setOpen(false) : openList()}
        onKeyDown={handleKeyDown}
      >
        <span className="travel-time-label">
          {selectedIndex >= 0 ? options[selectedIndex].label : label}
        </span>
        {options.map((option) => (
          <span key={option.value} className="travel-time-size" aria-hidden="true">
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
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              className="travel-time-option"
              role="option"
              aria-selected={option.value === value}
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
