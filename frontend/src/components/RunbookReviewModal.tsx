import { useState, useEffect, useRef } from 'react'
import { X, Send, Check, Trash2, Maximize2, Minimize2, Edit2, MessageSquare, Code, FileText } from 'lucide-react'
import { PendingIngestion } from '@/hooks/useIngestions'
import {
  useGetRunbookSession,
  useStartRunbookReview,
  useChatRunbookReview,
  useApproveRunbookReview,
  useDiscardRunbookReview,
  AccountDescriptionUpdate,
} from '@/hooks/useRunbookReview'
import { useGetAccounts } from '@/hooks/useAccounts'
import { DiffViewer } from './DiffViewer'
import ReactMarkdown from 'react-markdown'

interface RunbookReviewModalProps {
  isOpen: boolean
  onClose: () => void
  corrections: PendingIngestion[]
  currentRunbook: string
}

export function RunbookReviewModal({ isOpen, onClose, corrections, currentRunbook }: RunbookReviewModalProps) {
  const [inputMsg, setInputMsg] = useState('')
  const [isMaximized, setIsMaximized] = useState(false)
  const [viewMode, setViewMode] = useState<'markdown' | 'diff'>('markdown')
  
  // Local state for tracking edited/ignored account updates
  const [localAccountUpdates, setLocalAccountUpdates] = useState<AccountDescriptionUpdate[]>([])
  const [ignoredUpdates, setIgnoredUpdates] = useState<Set<string>>(new Set())
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)
  const [editDescText, setEditDescText] = useState('')
  const [editTagsText, setEditTagsText] = useState('')
  const [commentingAccountId, setCommentingAccountId] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  
  // State for AI questions
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({})

  const chatEndRef = useRef<HTMLDivElement>(null)

  const { data: session, isLoading: sessionLoading } = useGetRunbookSession()
  const { data: accounts } = useGetAccounts()
  
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

  // Sync local account updates with session data
  useEffect(() => {
    if (session?.account_description_updates) {
      // Only add updates that we don't already have locally, or overwrite if AI provided a new one
      setLocalAccountUpdates(session.account_description_updates)
    }
  }, [session?.account_description_updates])

  // Scroll to bottom when chat grows
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [session?.chat_history])

  if (!isOpen) return null

  const chatHistory = session?.chat_history ?? []
  const proposedRunbook = session?.proposed_runbook ?? ''

  const handleSend = async () => {
    if (!inputMsg.trim() || isThinking) return
    const text = inputMsg
    setInputMsg('')
    chatReview.mutate({ user_message: text })
  }

  const handleSubmitAnswers = async () => {
    const answers = Object.entries(questionAnswers)
      .filter(([_, answer]) => answer.trim() !== '')
      .map(([qIdx, answer]) => `[Question ${parseInt(qIdx.split('-')[1]) + 1}]: ${answer}`)
      
    if (answers.length === 0 || isThinking) return
    
    const text = answers.join('\n\n')
    setQuestionAnswers({})
    chatReview.mutate({ user_message: text })
  }

  const handleApprove = async () => {
    const finalizedUpdates = localAccountUpdates.filter(u => !ignoredUpdates.has(u.account_id))
    await approveReview.mutateAsync({ account_updates: finalizedUpdates })
    onClose()
  }

  const handleDiscard = async () => {
    await discardReview.mutateAsync()
    onClose()
  }

  const isInitializing = (sessionLoading || startReview.isPending) && chatHistory.length === 0

  const getOldDescription = (accountId: string) => {
    return accounts?.find(a => a.id === accountId)?.description || 'No existing description'
  }
  const getOldTags = (accountId: string) => {
    return accounts?.find(a => a.id === accountId)?.tags || []
  }
  const getAccountName = (accountId: string) => {
    return accounts?.find(a => a.id === accountId)?.name || accountId
  }

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 ${isMaximized ? 'p-0' : ''}`}>
      <div className={`bg-neutral-900 border border-neutral-800 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${isMaximized ? 'w-full h-full rounded-none' : 'w-full max-w-6xl h-[85vh] rounded-xl'}`}>

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900 z-10">
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
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-2 text-neutral-400 hover:text-white rounded-md hover:bg-neutral-800 transition-colors"
              title={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
            <button
              onClick={handleDiscard}
              disabled={discardReview.isPending || !session}
              title="Discard session"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40 ml-2"
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
                            <input
                              type="text"
                              value={questionAnswers[key] || ''}
                              onChange={e => setQuestionAnswers(prev => ({...prev, [key]: e.target.value}))}
                              placeholder="Your answer..."
                              className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                              disabled={isThinking}
                            />
                          </div>
                        )
                      })}
                      <div className="flex justify-end pt-2">
                        <button
                          onClick={handleSubmitAnswers}
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

            {/* Input */}
            <div className="p-3 border-t border-neutral-800 flex gap-2 bg-neutral-900 z-10">
              <input
                type="text"
                value={inputMsg}
                onChange={e => setInputMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Ask for tweaks or general comments..."
                className="flex-1 bg-neutral-800 border-none rounded-full px-4 py-2 text-sm text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                disabled={isThinking || !session}
              />
              <button
                onClick={handleSend}
                disabled={isThinking || !inputMsg.trim() || !session}
                className="p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Right: Diff & Previews */}
          <div className="w-2/3 flex flex-col bg-neutral-950 overflow-hidden">
            {isInitializing ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-500">
                <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
                <p>Analyzing corrections and proposing changes...</p>
              </div>
            ) : proposedRunbook ? (
              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                
                {/* Account Updates Section */}
                {localAccountUpdates.length > 0 && (
                  <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-800/50 flex justify-between items-center">
                      <h3 className="text-sm font-medium text-white">Account Description Suggestions</h3>
                      <span className="text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full">
                        {localAccountUpdates.length} updates
                      </span>
                    </div>
                    <div className="p-4 space-y-4">
                      {localAccountUpdates.map((update, i) => {
                        const isIgnored = ignoredUpdates.has(update.account_id)
                        const isEditing = editingAccountId === update.account_id
                        return (
                          <div key={i} className={`bg-neutral-950 border border-neutral-800 rounded-lg p-4 transition-colors ${isIgnored ? 'opacity-50 grayscale' : ''}`}>
                            <div className="flex justify-between items-start mb-3">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-1 bg-indigo-500/10 text-indigo-400 text-xs rounded-md font-medium">
                                  {getAccountName(update.account_id)}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                {!isIgnored && (
                                  <>
                                    <button 
                                      onClick={() => {
                                        setEditingAccountId(update.account_id)
                                        setEditDescText(update.new_description)
                                        setEditTagsText(update.new_tags ? update.new_tags.join(', ') : '')
                                        setCommentingAccountId(null)
                                      }}
                                      className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                                      title="Edit locally"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setCommentingAccountId(update.account_id)
                                        setCommentText('')
                                        setEditingAccountId(null)
                                      }}
                                      className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                                      title="Comment / Feedback to AI"
                                    >
                                      <MessageSquare className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                                <button 
                                  onClick={() => {
                                    setIgnoredUpdates(prev => {
                                      const next = new Set(prev)
                                      if (next.has(update.account_id)) next.delete(update.account_id)
                                      else next.add(update.account_id)
                                      return next
                                    })
                                  }}
                                  className={`p-1.5 rounded-md transition-colors ${isIgnored ? 'text-green-400 hover:bg-green-900/30' : 'text-neutral-400 hover:text-red-400 hover:bg-red-900/20'}`}
                                  title={isIgnored ? "Restore" : "Ignore"}
                                >
                                  {isIgnored ? <Check className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 relative">
                              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-neutral-800 -translate-x-1/2" />
                              <div className="space-y-1">
                                <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Current</div>
                                <div className="text-sm text-neutral-400 line-clamp-3" title={getOldDescription(update.account_id)}>
                                  {getOldDescription(update.account_id)}
                                </div>
                                {getOldTags(update.account_id).length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {getOldTags(update.account_id).map((t, ti) => (
                                      <span key={ti} className="px-1.5 py-0.5 bg-neutral-800 text-neutral-300 text-[10px] rounded">{t}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1 pl-2">
                                <div className="text-[10px] uppercase tracking-wider text-green-500 font-semibold">Suggested</div>
                                {isEditing ? (
                                  <div className="space-y-2 z-10 relative">
                                    <textarea
                                      value={editDescText}
                                      onChange={e => setEditDescText(e.target.value)}
                                      className="w-full bg-neutral-900 border border-neutral-700 rounded-md p-2 text-sm text-green-400 focus:ring-1 focus:ring-green-500 outline-none resize-none h-16"
                                    />
                                    <input
                                      value={editTagsText}
                                      onChange={e => setEditTagsText(e.target.value)}
                                      placeholder="Tags (comma separated)"
                                      className="w-full bg-neutral-900 border border-neutral-700 rounded-md p-2 text-sm text-green-400 focus:ring-1 focus:ring-green-500 outline-none"
                                    />
                                    <div className="flex gap-2 justify-end">
                                      <button 
                                        onClick={() => setEditingAccountId(null)}
                                        className="text-xs px-2 py-1 text-neutral-400 hover:text-white"
                                      >
                                        Cancel
                                      </button>
                                      <button 
                                        onClick={() => {
                                          setLocalAccountUpdates(prev => prev.map(u => u.account_id === update.account_id ? { ...u, new_description: editDescText, new_tags: editTagsText.split(',').map(t=>t.trim()).filter(Boolean) } : u))
                                          setEditingAccountId(null)
                                        }}
                                        className="text-xs px-2 py-1 bg-green-900/40 text-green-400 rounded-md hover:bg-green-900/60"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : commentingAccountId === update.account_id ? (
                                  <div className="space-y-2 z-10 relative">
                                    <div className="text-sm text-green-400 mb-2">{update.new_description}</div>
                                    {update.new_tags && update.new_tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1 mb-2">
                                        {update.new_tags.map((t, ti) => (
                                          <span key={ti} className="px-1.5 py-0.5 bg-green-900/30 text-green-400 text-[10px] rounded">{t}</span>
                                        ))}
                                      </div>
                                    )}
                                    <textarea
                                      value={commentText}
                                      onChange={e => setCommentText(e.target.value)}
                                      placeholder={`Feedback for AI about ${getAccountName(update.account_id)}...`}
                                      className="w-full bg-indigo-950/30 border border-indigo-900/50 rounded-md p-2 text-sm text-indigo-300 focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-16"
                                    />
                                    <div className="flex gap-2 justify-end">
                                      <button 
                                        onClick={() => setCommentingAccountId(null)}
                                        className="text-xs px-2 py-1 text-neutral-400 hover:text-white"
                                        disabled={isThinking}
                                      >
                                        Cancel
                                      </button>
                                      <button 
                                        onClick={() => {
                                          if (commentText.trim()) {
                                            chatReview.mutate({ user_message: `Regarding account '${getAccountName(update.account_id)}' description suggestion: ${commentText}` })
                                          }
                                          setCommentingAccountId(null)
                                        }}
                                        disabled={isThinking || !commentText.trim()}
                                        className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                                      >
                                        <Send className="w-3 h-3" />
                                        Send to AI
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="text-sm text-green-400">
                                      {update.new_description}
                                    </div>
                                    {update.new_tags && update.new_tags.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {update.new_tags.map((t, ti) => (
                                          <span key={ti} className="px-1.5 py-0.5 bg-green-900/30 text-green-400 text-[10px] rounded">{t}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Runbook Section */}
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden flex flex-col">
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
                      <div className="p-4">
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

              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-neutral-600 text-sm">
                Preparing review session...
              </div>
            )}
            
            {/* Action Bar */}
            {proposedRunbook && (
              <div className="p-4 border-t border-neutral-800 bg-neutral-900 flex justify-end shrink-0 z-10">
                <button
                  onClick={handleApprove}
                  disabled={approveReview.isPending}
                  className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 shadow-lg shadow-green-900/20"
                >
                  {approveReview.isPending ? 'Applying...' : 'Approve & Apply All'}
                  <Check className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
