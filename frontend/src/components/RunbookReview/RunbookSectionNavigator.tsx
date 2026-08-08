import { useMemo } from 'react'
import { Hash } from 'lucide-react'

interface Section {
  level: number
  title: string
  lineIndex: number
}

interface RunbookSectionNavigatorProps {
  content: string
  onSectionClick: (section: Section) => void
}

export function RunbookSectionNavigator({ content, onSectionClick }: RunbookSectionNavigatorProps) {
  const sections = useMemo(() => {
    const lines = content.split('\n')
    const parsedSections: Section[] = []

    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/)
      if (match) {
        parsedSections.push({
          level: match[1].length,
          title: match[2].trim(),
          lineIndex: index,
        })
      }
    })

    return parsedSections
  }, [content])

  if (sections.length === 0) {
    return (
      <div className="text-neutral-500 text-xs italic p-4 text-center">
        No sections found in document.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-800/40">
        <h3 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider">
          Sections
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sections.map((sec, idx) => {
          const indentClass =
            sec.level === 2 ? 'pl-6' : sec.level === 3 ? 'pl-10' : 'pl-3'
          const textClass =
            sec.level === 1
              ? 'text-neutral-200 font-semibold text-sm'
              : 'text-neutral-400 text-xs hover:text-neutral-200'

          return (
            <button
              key={idx}
              onClick={() => onSectionClick(sec)}
              className={`w-full text-left flex items-center gap-2 py-1.5 rounded-lg hover:bg-neutral-800 transition-colors ${indentClass} ${textClass}`}
            >
              <Hash className="w-3.5 h-3.5 opacity-55 flex-shrink-0" />
              <span className="truncate">{sec.title}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
