import { useState } from 'react'
import { diffLines, diffWords, diffChars } from 'diff'

interface EnhancedDiffViewerProps {
  oldText: string
  newText: string
}

type DiffMode = 'line' | 'word' | 'char'

export function EnhancedDiffViewer({ oldText, newText }: EnhancedDiffViewerProps) {
  const [mode, setMode] = useState<DiffMode>('line')

  const renderDiff = () => {
    if (mode === 'line') {
      const diff = diffLines(oldText, newText)
      return (
        <div className="space-y-0.5 font-mono text-xs overflow-x-auto">
          {diff.map((part, index) => {
            const colorClass = part.added
              ? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500'
              : part.removed
              ? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500 line-through'
              : 'text-neutral-400'
            const prefix = part.added ? '+' : part.removed ? '-' : ' '
            return (
              <div
                key={index}
                className={`px-3 py-1 whitespace-pre-wrap transition-colors ${colorClass}`}
              >
                <span className="select-none mr-2 opacity-50">{prefix}</span>
                {part.value}
              </div>
            )
          })}
        </div>
      )
    }

    if (mode === 'word') {
      const diff = diffWords(oldText, newText)
      return (
        <div className="p-4 bg-neutral-900 rounded-lg font-mono text-sm leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[400px] text-neutral-300">
          {diff.map((part, index) => {
            const colorClass = part.added
              ? 'bg-emerald-900/50 text-emerald-200 px-1 rounded font-bold'
              : part.removed
              ? 'bg-rose-900/50 text-rose-200 px-1 rounded line-through decoration-rose-500'
              : 'text-neutral-300'
            return (
              <span key={index} className={colorClass}>
                {part.value}
              </span>
            )
          })}
        </div>
      )
    }

    // char mode
    const diff = diffChars(oldText, newText)
    return (
      <div className="p-4 bg-neutral-900 rounded-lg font-mono text-sm leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[400px] text-neutral-300">
        {diff.map((part, index) => {
          const colorClass = part.added
            ? 'bg-emerald-900/50 text-emerald-200 font-bold'
            : part.removed
            ? 'bg-rose-900/50 text-rose-200 line-through'
            : 'text-neutral-400'
          return (
            <span key={index} className={colorClass}>
              {part.value}
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div className="flex flex-col border border-neutral-800 bg-neutral-950 rounded-xl overflow-hidden h-full min-h-[400px]">
      <div className="flex justify-between items-center px-4 py-3 border-b border-neutral-800 bg-neutral-900">
        <span className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Diff Mode</span>
        <div className="flex gap-1 bg-neutral-950 p-1 border border-neutral-800 rounded-lg">
          {(['line', 'word', 'char'] as DiffMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-all duration-200 ${
                mode === m
                  ? 'bg-neutral-800 text-white shadow-sm shadow-black/20'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-neutral-950 p-4">
        {renderDiff()}
      </div>
    </div>
  )
}
