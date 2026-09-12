import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface DropdownMenuItem {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  disabled?: boolean
}

interface DropdownMenuProps {
  items: DropdownMenuItem[]
  trigger: ReactNode
  triggerTitle?: string
  triggerClassName?: string
  menuClassName?: string
}

export default function DropdownMenu({
  items,
  trigger,
  triggerTitle,
  triggerClassName = 'p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer',
  menuClassName = 'right-0',
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerTitle}
        onClick={() => setOpen(prev => !prev)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 min-w-[180px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1 animate-fade-in ${menuClassName}`}
        >
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {item.icon && <item.icon className="w-3.5 h-3.5 text-slate-400" strokeWidth={1.5} />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
