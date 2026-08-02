import { useState } from 'react'
import { FileText, Code } from 'lucide-react'
import { DiffViewer } from '../DiffViewer'
import ReactMarkdown from 'react-markdown'

interface RunbookDocumentPanelProps {
  currentRunbook: string
  proposedRunbook: string
}

export function RunbookDocumentPanel({ currentRunbook, proposedRunbook }: RunbookDocumentPanelProps) {
  const [viewMode, setViewMode] = useState<'markdown' | 'diff'>('markdown')

  if (!proposedRunbook) return null

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex flex-col mt-4">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-800/50 flex justify-between items-center">
        <h3 className="text-sm font-medium text-white">Runbook Document</h3>
        <div className="flex bg-neutral-950 rounded-lg p-0.5 border border-neutral-800">
          <button
            onClick={() => setViewMode('markdown')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'markdown' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            <FileText className="w-3.5 h-3.5" />
            Preview
          </button>
          <button
            onClick={() => setViewMode('diff')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'diff' ? 'bg-neutral-800 text-white shadow-sm' : 'text-neutral-400 hover:text-neutral-200'}`}
          >
            <Code className="w-3.5 h-3.5" />
            Diff
          </button>
        </div>
      </div>
      <div className="p-0 flex-1 relative min-h-[400px]">
        {viewMode === 'diff' ? (
          <div className="p-4 h-full">
            <DiffViewer oldText={currentRunbook} newText={proposedRunbook} />
          </div>
        ) : (
          <div className="p-6 prose prose-invert max-w-none prose-sm overflow-auto h-full bg-neutral-950 text-neutral-300">
            <ReactMarkdown>
              {proposedRunbook}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
