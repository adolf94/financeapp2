import { useState, useEffect, useRef } from 'react'
import { X, Send, Check, Trash2 } from 'lucide-react'
import { PendingIngestion } from '@/hooks/useIngestions'
import {
  useGetRunbookSession,
  useStartRunbookReview,
  useChatRunbookReview,
  useApproveRunbookReview,
  useDiscardRunbookReview,
} from '@/hooks/useRunbookReview'
import { DiffViewer } from './DiffViewer'

interface RunbookReviewModalProps {
  isOpen: boolean
  onClose: () => void
  corrections: PendingIngestion[]
  currentRunbook: string
}

export function RunbookReviewModal({ isOpen, onClose, corrections, currentRunbook }: RunbookReviewModalProps) {
  const [inputMsg, setInputMsg] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  const { data: session, isLoading: sessionLoading } = useGetRunbookSession()
  const startReview = useStartRunbookReview()
  const chatReview = useChatRunbookReview()
  const approveReview = useApproveRunbookReview()
  const discardReview = useDiscardRunbookReview()

  const isThinking = startReview.isPending || chatReview.isPending

  // On open: if no active session, kick off a new one (overwrite)
  useEffect(() => {
    if (isOpen && !sessionLoading && session === null && !startReview.isPending) {
      startReview.mutate(corrections)
    }
  }, [isOpen, sessionLoading, session])

  // Scroll to bottom when chat grows
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.chat_history])

  if (!isOpen) return null

  const chatHistory = session?.chat_history ?? []
  const proposedRunbook = session?.proposed_runbook ?? ''
  const accountUpdates = session?.account_description_updates ?? []

  const handleSend = async () => {
    if (!inputMsg.trim() || isThinking) return
    const text = inputMsg
    setInputMsg('')
    chatReview.mutate({ user_message: text })
  }

  const handleApprove = async () => {
    await approveReview.mutateAsync()
    onClose()
  }

  const handleDiscard = async () => {
    await discardReview.mutateAsync()
    onClose()
  }

  const isInitializing = (sessionLoading || startReview.isPending) && chatHistory.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
          <div>
            <h2 className="text-xl font-semibold text-white">Review Runbook Changes</h2>
            {session?.updated_at && (
              <p className="text-xs text-neutral-500 mt-0.5">
                Session active · last updated {new Date(session.updated_at).toLocaleTimeString()}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDiscard}
              disabled={discardReview.isPending || !session}
              title="Discard session"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-4 h-4" />
              Discard
            </button>
            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-white rounded-md hover:bg-neutral-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">

          {/* Left: Chat */}
          <div className="w-1/3 flex flex-col border-r border-neutral-800 bg-neutral-900/50">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`px-4 py-2 rounded-2xl max-w-[90%] text-sm whitespace-pre-wrap leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-neutral-800 text-neutral-200 rounded-bl-none'
                    }`}
                  >
                    {msg.text}
                  </div>
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

            {/* Input */}
            <div className="p-3 border-t border-neutral-800 flex gap-2">
              <input
                type="text"
                value={inputMsg}
                onChange={e => setInputMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask for tweaks..."
                className="flex-1 bg-neutral-800 border-none rounded-full px-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                disabled={isThinking || !session}
              />
              <button
                onClick={handleSend}
                disabled={isThinking || !inputMsg.trim() || !session}
                className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right: Diff & Previews */}
          <div className="w-2/3 p-6 overflow-y-auto bg-neutral-950">
            {isInitializing ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p>Analyzing corrections and proposing changes...</p>
              </div>
            ) : proposedRunbook ? (
              <div className="space-y-6">

                {/* Account Updates */}
                {accountUpdates.length > 0 && (
                  <div>
                    <h3 className="text-lg font-medium text-white mb-3">Account Description Updates</h3>
                    <div className="grid gap-3">
                      {accountUpdates.map((update, i) => (
                        <div key={i} className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg">
                          <div className="text-xs text-neutral-500 mb-1">Account ID: {update.account_id}</div>
                          <div className="text-sm text-green-400">"{update.new_description}"</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Runbook Diff */}
                <div>
                  <h3 className="text-lg font-medium text-white mb-3">Runbook Changes</h3>
                  <DiffViewer oldText={currentRunbook} newText={proposedRunbook} />
                </div>

                {/* Approve */}
                <div className="flex justify-end pt-4 pb-12">
                  <button
                    onClick={handleApprove}
                    disabled={approveReview.isPending}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shadow-lg shadow-green-900/20"
                  >
                    {approveReview.isPending ? 'Applying...' : 'Approve & Apply'}
                    <Check className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-neutral-600 text-sm">
                Preparing review session...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
