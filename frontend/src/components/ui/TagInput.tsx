import React, { useState } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  className?: string
}

export default function TagInput({ tags = [], onChange, placeholder = 'Add tag...', className = '' }: TagInputProps) {
  const [input, setInput] = useState('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = input.trim()
      if (trimmed && !tags.includes(trimmed)) {
        onChange([...tags, trimmed])
        setInput('')
      }
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  const removeTag = (indexToRemove: number) => {
    onChange(tags.filter((_, idx) => idx !== indexToRemove))
  }

  return (
    <div className={`flex flex-wrap gap-1.5 p-1.5 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 focus-within:ring-1 focus-within:ring-blue-600 focus-within:border-blue-600 min-h-[44px] items-center ${className}`}>
      {tags.map((tag, idx) => (
        <span
          key={`${tag}-${idx}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs font-medium"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(idx)}
            className="text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-200 p-0.5 rounded cursor-pointer"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : ''}
        className="flex-1 bg-transparent border-none outline-none text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 min-w-[80px] py-1"
        aria-label="Add tag and press Enter"
      />
    </div>
  )
}
