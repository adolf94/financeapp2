import { useState, useEffect, useRef } from 'react'
import { X, Brain, ChevronDown, Sparkles, Zap, FileJson } from 'lucide-react'

interface ReasoningDrawerProps {
  isOpen: boolean
  onClose: () => void
  operationId: string
  isPending: boolean
  thinkingEventName?: string
  progressEventName?: string
  finalContent?: string
}

export default function ReasoningDrawer({
  isOpen,
  onClose,
  operationId,
  isPending,
  thinkingEventName = 'reclassifyThinking',
  progressEventName = 'reclassifyProgress',
  finalContent
}: ReasoningDrawerProps) {
  const [thinkingText, setThinkingText] = useState('')
  const [contentText, setContentText] = useState('')
  const [isDone, setIsDone] = useState(false)
  const enableReasoning = (window as any).authConfig?.enableReasoning ?? true
  const [activeTab, setActiveTab] = useState<'thinking' | 'output'>(enableReasoning ? 'thinking' : 'output')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Reset on new operation
  useEffect(() => {
    if (isPending && operationId) {
      setThinkingText('')
      setContentText('')
      setIsDone(false)
      setActiveTab(enableReasoning ? 'thinking' : 'output')
    }
  }, [operationId, isPending, enableReasoning])

  // Fallback to HTTP response if streaming final content was disabled
  useEffect(() => {
    if (!isPending && finalContent && !contentText) {
      setContentText(finalContent)
      setActiveTab('output')
    }
  }, [isPending, finalContent, contentText])

  // Mark done when pending flips off (after we had some output)
  useEffect(() => {
    if (!isPending && (thinkingText || contentText || finalContent)) {
      setIsDone(true)
    }
  }, [isPending, thinkingText, contentText, finalContent])

  // Listen to reclassifyThinking_{operationId} with token simulation
  useEffect(() => {
    if (!operationId) return

    // Token simulation state
    let buffer = ''
    let bufferTimeout: ReturnType<typeof setTimeout> | null = null

    const processBuffer = (currentDebounce: number) => {
      if (buffer.length > 0) {
        const totalDurationMs = currentDebounce > 0 ? currentDebounce * 1000 : 200
        const chunkSize = Math.min(8, buffer.length) // Average 4 characters per token
        const delay = Math.max(5, Math.min(200, totalDurationMs * (chunkSize / buffer.length)))

        const chunk = buffer.substring(0, chunkSize)
        setThinkingText(prev => prev + chunk)
        buffer = buffer.substring(chunkSize)

        // Continue processing if there's more in the buffer
        if (buffer.length > 0) {
          bufferTimeout = setTimeout(() => processBuffer(currentDebounce), delay)
        } else {
          bufferTimeout = null
        }
      } else {
        bufferTimeout = null
      }
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const chunk = typeof detail === 'string' ? detail : detail.chunk
      const debounceDelay = typeof detail === 'string' ? 0 : (detail.debounceDelay || 0)
      buffer += chunk

      // Start processing if not already running
      if (!bufferTimeout) {
        processBuffer(debounceDelay)
      }
    }

    const name = `${thinkingEventName}_${operationId}`
    window.addEventListener(name, handler)
    return () => {
      window.removeEventListener(name, handler)
      if (bufferTimeout) clearTimeout(bufferTimeout)
    }
  }, [operationId])

  // Listen to reclassifyProgress_{operationId} (final content) with token simulation
  useEffect(() => {
    if (!operationId) return

    // Token simulation state for output
    let outputBuffer = ''
    let outputBufferTimeout: ReturnType<typeof setTimeout> | null = null

    const processOutputBuffer = (currentDebounce: number) => {
      if (outputBuffer.length > 0) {
        const totalDurationMs = currentDebounce > 0 ? currentDebounce * 1000 : 200
        const chunkSize = Math.min(4, outputBuffer.length) // Average 4 characters per token
        const delay = Math.max(5, Math.min(200, totalDurationMs * (chunkSize / outputBuffer.length)))

        const chunk = outputBuffer.substring(0, chunkSize)
        setContentText(prev => prev + chunk)
        outputBuffer = outputBuffer.substring(chunkSize)

        // Continue processing if there's more in the buffer
        if (outputBuffer.length > 0) {
          outputBufferTimeout = setTimeout(() => processOutputBuffer(currentDebounce), delay)
        } else {
          outputBufferTimeout = null
          // Auto-switch to output tab when content starts arriving
          setActiveTab('output')
        }
      } else {
        outputBufferTimeout = null
      }
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const chunk = typeof detail === 'string' ? detail : detail.chunk
      const debounceDelay = typeof detail === 'string' ? 0 : (detail.debounceDelay || 0)
      outputBuffer += chunk

      // Start processing if not already running
      if (!outputBufferTimeout) {
        processOutputBuffer(debounceDelay)
      }
    }

    const name = `${progressEventName}_${operationId}`
    window.addEventListener(name, handler)
    return () => {
      window.removeEventListener(name, handler)
      if (outputBufferTimeout) clearTimeout(outputBufferTimeout)
    }
  }, [operationId])

  // Auto-scroll
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [thinkingText, contentText])

  const hasThinking = thinkingText.length > 0
  const hasContent = contentText.length > 0
  const hasAnything = hasThinking || hasContent

  // Determine current phase for status label
  const phase = isPending
    ? hasContent
      ? 'Writing answer...'
      : hasThinking
        ? 'Reasoning...'
        : 'Initializing...'
    : isDone
      ? 'Classification complete'
      : 'Waiting for reclassification...'

  const displayText = activeTab === 'thinking' ? thinkingText : contentText
  const isActiveStreaming = isPending && (activeTab === 'thinking' ? !hasContent : hasContent)

  const handleClose = () => {
    setThinkingText('')
    setContentText('')
    setIsDone(false)
    onClose()
  }

  const copyText = () => {
    const txt = activeTab === 'thinking' ? thinkingText : contentText
    navigator.clipboard.writeText(txt).catch(() => { })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] transition-opacity duration-300 ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="complementary"
        aria-label="AI Chain-of-Thought"
        className={`
          fixed top-0 right-0 z-[70] h-full
          w-full sm:w-[500px] lg:w-[540px]
          flex flex-col
          bg-[#0d1117] border-l border-slate-800
          shadow-2xl shadow-black/50
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-800/80 shrink-0">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600/15 border border-indigo-500/20">
            <Brain className="w-4 h-4 text-indigo-400" strokeWidth={1.5} />
            {isPending && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse ring-2 ring-[#0d1117]" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-100 leading-none">
              AI Chain-of-Thought
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-none">{phase}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isPending && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-[10px] font-semibold text-indigo-300 uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                Live
              </span>
            )}
            {isDone && !isPending && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                <Zap className="w-3 h-3" strokeWidth={2} />
                Done
              </span>
            )}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close AI reasoning drawer"
              className="ml-1 p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center border-b border-slate-800/80 shrink-0 px-3 pt-1 gap-1">
          {enableReasoning && (
            <button
              type="button"
              onClick={() => setActiveTab('thinking')}
              className={`relative flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-t-md transition-colors ${activeTab === 'thinking'
                ? 'text-indigo-300 bg-indigo-500/10'
                : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              <Brain className="w-3 h-3" strokeWidth={1.5} />
              Reasoning
              {hasThinking && (
                <span className="ml-1 px-1 py-0.5 rounded bg-indigo-500/20 text-indigo-400 text-[9px] font-bold tabular-nums">
                  {thinkingText.length > 999
                    ? `${(thinkingText.length / 1000).toFixed(1)}k`
                    : thinkingText.length}
                </span>
              )}
              {isPending && !hasContent && hasThinking && (
                <span className="absolute top-1.5 right-1 w-1 h-1 rounded-full bg-indigo-400 animate-ping" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('output')}
            className={`relative flex items-center gap-1.5 px-3 py-2 text-[11px] font-semibold rounded-t-md transition-colors ${activeTab === 'output'
              ? 'text-amber-300 bg-amber-500/10'
              : 'text-slate-500 hover:text-slate-300'
              }`}
          >
            <FileJson className="w-3 h-3" strokeWidth={1.5} />
            Output
            {hasContent && (
              <span className="ml-1 px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[9px] font-bold tabular-nums">
                {contentText.length > 999
                  ? `${(contentText.length / 1000).toFixed(1)}k`
                  : contentText.length}
              </span>
            )}
            {isPending && hasContent && (
              <span className="absolute top-1.5 right-1 w-1 h-1 rounded-full bg-amber-400 animate-ping" />
            )}
          </button>

          {/* Op ID pushed to right */}
          {operationId && (
            <span className="ml-auto text-[9px] font-mono text-slate-700 truncate max-w-[140px]" title={operationId}>
              {operationId.slice(0, 8)}…
            </span>
          )}
        </div>

        {/* Terminal body */}
        <div className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed p-5 selection:bg-indigo-500/30">
          {/* Empty state */}
          {!hasAnything && !isPending && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 border border-indigo-500/10 flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-indigo-500/50" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-slate-500 text-[13px] font-medium">No stream yet</p>
                <p className="text-slate-600 text-[11px] mt-1">
                  Hit Re-run AI Classification to see the live reasoning.
                </p>
              </div>
            </div>
          )}

          {/* Initializing */}
          {!hasAnything && isPending && (
            <div className="flex items-center gap-2 text-slate-500 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
              <span>Waiting for model...</span>
            </div>
          )}

          {/* Stream content */}
          {displayText && (
            <div
              className={`whitespace-pre-wrap break-words ${activeTab === 'thinking' ? 'text-slate-300' : 'text-amber-100/90'
                }`}
            >
              {displayText}
              {isActiveStreaming && (
                <span
                  className={`inline-block w-[2px] h-[1em] align-middle ml-0.5 animate-[blink_1s_step-end_infinite] ${activeTab === 'thinking' ? 'bg-indigo-400' : 'bg-amber-400'
                    }`}
                  aria-hidden="true"
                />
              )}
            </div>
          )}

          {/* Empty tab placeholder */}
          {hasAnything && !displayText && (
            <div className="flex items-center gap-2 text-slate-600">
              <span className="text-[11px]">
                {activeTab === 'thinking'
                  ? 'No reasoning tokens — model did not emit CoT for this request.'
                  : isPending
                    ? 'Waiting for final output...'
                    : 'No output captured.'}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 py-3 border-t border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.5} />
            <span>
              {activeTab === 'thinking'
                ? hasThinking
                  ? `${thinkingText.length.toLocaleString()} reasoning chars`
                  : 'No reasoning'
                : hasContent
                  ? `${contentText.length.toLocaleString()} output chars`
                  : 'No output yet'}
            </span>
          </div>
          {displayText && (
            <button
              type="button"
              onClick={copyText}
              className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors font-medium px-2 py-1 rounded hover:bg-slate-800"
            >
              Copy
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
