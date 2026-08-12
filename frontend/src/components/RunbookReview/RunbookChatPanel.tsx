import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { ChatMessage } from '@/hooks/useRunbookReview'

interface RunbookChatPanelProps {
  chatHistory: ChatMessage[]
  isThinking: boolean
  onSendMessage: (text: string) => void
  sessionActive: boolean
  pendingAnswers: Record<string, string>
  onAnswerChange: (key: string, val: string) => void
}

export function RunbookChatPanel({
  chatHistory,
  isThinking,
  onSendMessage,
  sessionActive,
  pendingAnswers,
  onAnswerChange
}: RunbookChatPanelProps) {
  const [inputMsg, setInputMsg] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const [streamedText, setStreamedText] = useState('')

  useEffect(() => {
    if (!isThinking) {
      setStreamedText('')
      return
    }

    // Token simulation for chat progress
    let chatBuffer = ''
    let chatBufferTimeout: NodeJS.Timeout | null = null

    const processChatBuffer = (currentDebounce: number) => {
      if (chatBuffer.length > 0) {
        const totalDurationMs = currentDebounce > 0 ? currentDebounce * 1000 : 200
        const chunkSize = Math.min(8, chatBuffer.length) // Average 4 characters per token
        const delay = Math.max(5, Math.min(200, totalDurationMs * (chunkSize / chatBuffer.length)))

        const chunk = chatBuffer.substring(0, chunkSize)
        setStreamedText(prev => prev + chunk)
        chatBuffer = chatBuffer.substring(chunkSize)

        if (chatBuffer.length > 0) {
          chatBufferTimeout = setTimeout(() => processChatBuffer(currentDebounce), delay)
        } else {
          chatBufferTimeout = null
        }
      } else {
        chatBufferTimeout = null
      }
    }

    const handleProgress = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const chunk = typeof detail === 'string' ? detail : detail.chunk
      const debounceDelay = typeof detail === 'string' ? 0 : (detail.debounceDelay || 0)

      chatBuffer += chunk

      // Start processing if not already running
      if (!chatBufferTimeout) {
        processChatBuffer(debounceDelay)
      }
    }

    window.addEventListener('chatProgress', handleProgress)
    return () => {
      window.removeEventListener('chatProgress', handleProgress)
      if (chatBufferTimeout) clearTimeout(chatBufferTimeout)
    }
  }, [isThinking])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, streamedText])

  const handleSend = () => {
    // We allow sending if there's an inputMsg OR if there are pending answers (parent will handle checking if any pending state exists)
    onSendMessage(inputMsg)
    setInputMsg('')
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px]">
        {chatHistory.map((msg, i) => (
          <div key={i} className={`flex flex-col space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`px-4 py-3 rounded-2xl max-w-[95%] text-sm whitespace-pre-wrap leading-relaxed ${msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-none'
                : 'bg-neutral-800 text-neutral-200 rounded-bl-none'
                }`}
            >
              {msg.text}
            </div>
            {msg.questions && msg.questions.length > 0 && msg.role === 'ai' && (
              <div className="w-[95%] space-y-3 mt-2 bg-neutral-800/50 p-4 rounded-xl border border-neutral-700/50">
                <h4 className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">AI Clarifications</h4>
                {msg.questions.map((q, qIdx) => {
                  const key = `${i}-${qIdx}`
                  return (
                    <div key={key} className="space-y-2">
                      <p className="text-sm text-neutral-300">Q: {q}</p>
                      <textarea
                        value={pendingAnswers[key] || ''}
                        onChange={e => onAnswerChange(key, e.target.value)}
                        placeholder="Your answer..."
                        rows={2}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                        disabled={isThinking}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div className="flex justify-start w-full">
            <div className="px-4 py-3 rounded-2xl bg-neutral-800 text-neutral-200 rounded-bl-none max-w-[95%] text-sm whitespace-pre-wrap leading-relaxed">
              {streamedText ? (
                // Parse out or just show raw JSON/text since it's the stream
                streamedText
              ) : (
                <span className="text-neutral-500 italic animate-pulse">AI is thinking...</span>
              )}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div className="p-3 border-t border-neutral-800 flex gap-2 bg-neutral-900 z-10 items-end shrink-0">
        <textarea
          value={inputMsg}
          onChange={e => setInputMsg(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          placeholder="Ask for tweaks or general comments... (Shift+Enter for new line)"
          className="flex-1 bg-neutral-800 border-none rounded-xl px-4 py-3 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none resize-none min-h-[44px] max-h-32"
          rows={2}
          disabled={isThinking || !sessionActive}
        />
        <button
          onClick={handleSend}
          disabled={isThinking || !sessionActive}
          className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0 mb-[2px]"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </>
  )
}
