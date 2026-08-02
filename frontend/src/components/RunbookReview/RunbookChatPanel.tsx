import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { ChatMessage } from '@/hooks/useRunbookReview'

interface RunbookChatPanelProps {
  chatHistory: ChatMessage[]
  isThinking: boolean
  onSendMessage: (text: string) => void
  sessionActive: boolean
}

export function RunbookChatPanel({
  chatHistory,
  isThinking,
  onSendMessage,
  sessionActive
}: RunbookChatPanelProps) {
  const [inputMsg, setInputMsg] = useState('')
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

  const handleSend = () => {
    if (!inputMsg.trim() || isThinking) return
    onSendMessage(inputMsg)
    setInputMsg('')
  }

  const handleSubmitAnswers = (msgIdx: number) => {
    const answers = Object.entries(questionAnswers)
      .filter(([key, answer]) => key.startsWith(`${msgIdx}-`) && answer.trim() !== '')
      .map(([key, answer]) => {
        const qIdx = parseInt(key.split('-')[1])
        return `[Question ${qIdx + 1}]: ${answer}`
      })
      
    if (answers.length === 0 || isThinking) return
    
    onSendMessage(answers.join('\n\n'))
    
    // Clear just these answers
    setQuestionAnswers(prev => {
      const next = { ...prev }
      Object.keys(next).forEach(k => {
        if (k.startsWith(`${msgIdx}-`)) delete next[k]
      })
      return next
    })
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[300px]">
        {chatHistory.map((msg, i) => (
          <div key={i} className={`flex flex-col space-y-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`px-4 py-3 rounded-2xl max-w-[95%] text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
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
                        value={questionAnswers[key] || ''}
                        onChange={e => setQuestionAnswers(prev => ({...prev, [key]: e.target.value}))}
                        placeholder="Your answer..."
                        rows={2}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none resize-none"
                        disabled={isThinking}
                      />
                    </div>
                  )
                })}
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => handleSubmitAnswers(i)}
                    disabled={isThinking || Object.keys(questionAnswers).filter(k => k.startsWith(`${i}-`) && questionAnswers[k].trim() !== '').length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send Answers
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div className="flex justify-start">
            <div className="px-4 py-2 rounded-2xl bg-neutral-800 text-neutral-400 rounded-bl-none animate-pulse text-sm">
              AI is thinking...
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
          disabled={isThinking || !inputMsg.trim() || !sessionActive}
          className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0 mb-[2px]"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </>
  )
}
