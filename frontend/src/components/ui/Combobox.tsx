import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus } from 'lucide-react'

export interface ComboboxOption {
  value: string
  label: string
  group?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  onCreate?: (inputValue: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export default function Combobox({
  options,
  value,
  onChange,
  onCreate,
  placeholder = 'Select...',
  className = '',
  disabled = false,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedOption = options.find((opt) => opt.value === value)
  const displayValue = isOpen ? search : selectedOption?.label || ''

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  )

  const showCreate = onCreate && search.trim() !== '' && !options.some(
    (opt) => opt.label.toLowerCase() === search.trim().toLowerCase()
  )

  const handleSelect = (val: string) => {
    onChange(val)
    setIsOpen(false)
    setSearch('')
  }

  const handleCreate = () => {
    if (onCreate && search.trim()) {
      onCreate(search.trim())
      setIsOpen(false)
      setSearch('')
    }
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`flex items-center justify-between border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 px-3 min-h-[44px] cursor-text ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        } ${isOpen ? 'ring-1 ring-blue-600 border-blue-600' : ''}`}
        onClick={() => {
          if (!disabled) {
            setIsOpen(true)
            inputRef.current?.focus()
          }
        }}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="combobox-options-list"
      >
        <div className="flex-1 flex items-center min-w-0">
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent border-none outline-none text-slate-900 dark:text-slate-100 text-sm placeholder:text-slate-400"
            placeholder={placeholder}
            value={displayValue}
            onChange={(e) => {
               setSearch(e.target.value)
               if (!isOpen) setIsOpen(true)
            }}
            disabled={disabled}
            aria-autocomplete="list"
            aria-controls="combobox-options-list"
          />
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0 ml-2" />
      </div>

      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filteredOptions.length === 0 && !showCreate && (
            <div className="p-3 text-sm text-slate-500 text-center">No options found.</div>
          )}

          {(() => {
            let lastGroup = ''
            return filteredOptions.map((opt) => {
              const showHeader = opt.group && opt.group !== lastGroup
              if (showHeader) {
                lastGroup = opt.group!
              }
              return (
                <div key={opt.value}>
                  {showHeader && (
                    <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 uppercase tracking-wider select-none border-b border-t first:border-t-0 border-slate-100 dark:border-slate-800">
                      {opt.group}
                    </div>
                  )}
                  <button
                    type="button"
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${
                      opt.value === value ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'text-slate-900 dark:text-slate-100'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleSelect(opt.value)
                    }}
                  >
                    {opt.label}
                  </button>
                </div>
              )
            })
          })()}

          {showCreate && (
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                handleCreate()
              }}
            >
              <Plus className="w-4 h-4" /> Create "{search}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}
