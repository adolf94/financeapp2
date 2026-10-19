import { useEffect, useState } from 'react'
import { Check, Copy, FileJson, X } from 'lucide-react'
import { PendingIngestion } from '@/hooks/useIngestions'

interface IngestionJsonDebugModalProps {
  ingestion: PendingIngestion
  onClose: () => void
}

export default function IngestionJsonDebugModal({ ingestion, onClose }: IngestionJsonDebugModalProps) {
  const [isCopied, setIsCopied] = useState(false)

  const prettyJson = JSON.stringify(ingestion, null, 2)

  // Close on Escape for quick debug peek/dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prettyJson)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // Clipboard unavailable (e.g. insecure context); ignore silently
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 rounded-t-2xl">
          <div className="flex-1 min-w-0 pr-4">
            <div className="flex items-center gap-2">
              <FileJson className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
              <span className="font-bold text-slate-950 dark:text-white text-base">Notification JSON</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                Debug
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
              {ingestion.notification_type?.toUpperCase()} &middot; {ingestion.id}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              title="Copy JSON to clipboard"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isCopied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close JSON preview"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto flex-1 bg-slate-950">
          <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-emerald-300/90">
            {prettyJson}
          </pre>
        </div>
      </div>
    </div>
  )
}
