import { useState, useEffect } from 'react'
import { X, Check, Trash2, Maximize2, Minimize2 } from 'lucide-react'
import { PendingIngestion } from '@/hooks/useIngestions'
import {
  useGetRunbookSession,
  useStartRunbookReview,
  useChatRunbookReview,
  useApproveRunbookReview,
  useDiscardRunbookReview,
  AccountDescriptionUpdate,
  VendorUpdate,
} from '@/hooks/useRunbookReview'
import { useGetAccounts } from '@/hooks/useAccounts'
import { useGetVendors } from '@/hooks/useVendors'

import { RunbookChatPanel } from './RunbookReview/RunbookChatPanel'
import { RunbookAccountUpdatesPanel } from './RunbookReview/RunbookAccountUpdatesPanel'
import { RunbookVendorUpdatesPanel } from './RunbookReview/RunbookVendorUpdatesPanel'
import { RunbookDocumentPanel } from './RunbookReview/RunbookDocumentPanel'
import { RunbookEditorPanel } from './RunbookReview/RunbookEditorPanel'
import { MessageSquare, FileEdit, Brain } from 'lucide-react'
import ReasoningDrawer from './ReasoningDrawer'

interface RunbookReviewModalProps {
  isOpen: boolean
  onClose: () => void
  corrections: PendingIngestion[]
  currentRunbook: string
  runbookType: 'app' | 'sms' | 'email' | 'image'
}

export function RunbookReviewModal({ isOpen, onClose, corrections, currentRunbook, runbookType }: RunbookReviewModalProps) {
  const [mode, setMode] = useState<'chat' | 'editor'>('chat')
  const [isMaximized, setIsMaximized] = useState(false)
  
  // Local state for tracking edited/ignored account updates
  const [localAccountUpdates, setLocalAccountUpdates] = useState<AccountDescriptionUpdate[]>([])
  const [ignoredUpdates, setIgnoredUpdates] = useState<Set<string>>(new Set())
  
  // Local state for tracking vendor updates
  const [localVendorUpdates, setLocalVendorUpdates] = useState<VendorUpdate[]>([])
  const [ignoredVendorUpdates, setIgnoredVendorUpdates] = useState<Set<string>>(new Set())

  const [streamReasoning, setStreamReasoning] = useState(true)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [currentOperationId, setCurrentOperationId] = useState('')

  const [pendingAnswers, setPendingAnswers] = useState<Record<string, string>>({})
  const [pendingAccountFeedback, setPendingAccountFeedback] = useState<Record<string, string>>({})
  const [pendingVendorFeedback, setPendingVendorFeedback] = useState<Record<string, string>>({})
  
  const { data: session, isLoading: sessionLoading } = useGetRunbookSession()
  const { data: accounts } = useGetAccounts()
  const { data: vendors } = useGetVendors()
  
  const startReview = useStartRunbookReview()
  const chatReview = useChatRunbookReview()
  const approveReview = useApproveRunbookReview()
  const discardReview = useDiscardRunbookReview()

  const isThinking = startReview.isPending || chatReview.isPending

  // On open: if no active session, kick off a new one (overwrite)
  useEffect(() => {
    if (isOpen && !sessionLoading && session === null && !startReview.isPending) {
      const opId = crypto.randomUUID()
      setCurrentOperationId(opId)
      
      startReview.mutate({ corrections, runbookType, operationId: opId, streamReasoning })
    }
  }, [isOpen, sessionLoading, session, runbookType])

  // Sync local account and vendor updates with session data
  useEffect(() => {
    if (session?.account_description_updates) {
      setLocalAccountUpdates(session.account_description_updates)
    }
    if (session?.vendor_updates) {
      setLocalVendorUpdates(session.vendor_updates)
    }
  }, [session?.account_description_updates, session?.vendor_updates])

  if (!isOpen) return null

  const chatHistory = session?.chat_history ?? []
  const proposedRunbook = session?.proposed_runbook ?? ''

  const handleApprove = async () => {
    const finalizedAccountUpdates = localAccountUpdates.filter(u => !ignoredUpdates.has(u.account_id))
    const finalizedVendorUpdates = localVendorUpdates.filter(u => !ignoredVendorUpdates.has(u.vendor_id))
    await approveReview.mutateAsync({ 
      account_updates: finalizedAccountUpdates,
      vendor_updates: finalizedVendorUpdates
    })
    onClose()
  }

  const handleDiscard = async () => {
    await discardReview.mutateAsync()
    onClose()
  }

  const isInitializing = (sessionLoading || startReview.isPending) && chatHistory.length === 0

  const getOldDescription = (accountId: string) => accounts?.find(a => a.id === accountId)?.description || 'No existing description'
  const getOldTags = (accountId: string) => accounts?.find(a => a.id === accountId)?.tags || []
  const getAccountName = (accountId: string) => accounts?.find(a => a.id === accountId)?.name || accountId
  
  const getOldVendorTags = (vendorId: string) => vendors?.find(v => v.id === vendorId)?.tags || []
  const getVendorName = (vendorId: string) => vendors?.find(v => v.id === vendorId)?.name || vendorId

  const handleAccountUpdateChange = (accountId: string, newDesc: string, newTags: string[]) => {
    setLocalAccountUpdates(prev => prev.map(u => u.account_id === accountId ? { ...u, new_description: newDesc, new_tags: newTags } : u))
  }

  const handleVendorUpdateChange = (vendorId: string, newTags: string[]) => {
    setLocalVendorUpdates(prev => prev.map(u => u.vendor_id === vendorId ? { ...u, new_tags: newTags } : u))
  }

  const runbookLabel = runbookType === 'sms' ? 'SMS' : runbookType === 'email' ? 'Email' : runbookType === 'image' ? 'Image' : 'App'

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 ${isMaximized ? 'p-0' : ''}`}>
      <div className={`bg-neutral-900 border border-neutral-800 shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${isMaximized ? 'w-full h-full rounded-none' : 'w-full max-w-6xl h-[85vh] rounded-xl'}`}>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border-b border-neutral-800 bg-neutral-900 z-10 gap-3">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Review {runbookLabel} Runbook Changes</h2>
              {session?.updated_at && (
                <p className="text-xs text-neutral-500 mt-0.5">
                  Session active · last updated {new Date(session.updated_at).toLocaleTimeString()}
                </p>
              )}
            </div>
            
            {/* Mode Switcher */}
            {session && !isInitializing && (
              <div className="flex bg-neutral-950 rounded-lg p-0.5 border border-neutral-800">
                <button
                  onClick={() => setMode('chat')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
                    mode === 'chat'
                      ? 'bg-neutral-800 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Chat Mode
                </button>
                <button
                  onClick={() => setMode('editor')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-200 ${
                    mode === 'editor'
                      ? 'bg-neutral-800 text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <FileEdit className="w-3.5 h-3.5" />
                  Editor Mode
                </button>
              </div>
            )}

            {/* AI Reasoning Toggle & Button */}
            <div className="flex items-center gap-3 ml-4 bg-neutral-900/50 p-1.5 rounded-lg border border-neutral-800">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-neutral-400 hover:text-neutral-200 transition-colors">
                <input
                  type="checkbox"
                  checked={streamReasoning}
                  onChange={(e) => setStreamReasoning(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-neutral-700 bg-neutral-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-neutral-900"
                />
                Stream CoT
              </label>
              
              <button
                onClick={() => setIsDrawerOpen(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                title="View AI Chain of Thought"
              >
                <Brain className="w-3.5 h-3.5" />
                Thinking
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
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
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

          {mode === 'editor' && session && !isInitializing ? (
            <RunbookEditorPanel
              currentRunbook={currentRunbook}
              proposedRunbook={proposedRunbook}
              sessionActive={!!session}
            />
          ) : (
            <>
              {/* Left: Chat */}
              <div className="w-full lg:w-1/3 h-1/2 lg:h-full flex flex-col border-b lg:border-b-0 lg:border-r border-neutral-800 bg-neutral-900/50">
                <RunbookChatPanel
                  chatHistory={chatHistory}
                  isThinking={isThinking}
                  onSendMessage={(text) => {
                    const answers = Object.entries(pendingAnswers)
                      .filter(([_, ans]) => ans.trim() !== '')
                      .map(([key, ans]) => {
                        const qIdx = parseInt(key.split('-')[1])
                        return `[Question ${qIdx + 1}]: ${ans}`
                      })
                      .join('\n')

                    const accFeedback = Object.entries(pendingAccountFeedback)
                      .filter(([_, fb]) => fb !== null && fb.trim() !== '')
                      .map(([id, fb]) => `- Regarding account '${accounts?.find(a => a.id === id)?.name || id}' description suggestion: ${fb}`)
                      .join('\n')

                    const venFeedback = Object.entries(pendingVendorFeedback)
                      .filter(([_, fb]) => fb !== null && fb.trim() !== '')
                      .map(([id, fb]) => `- Regarding vendor '${vendors?.find(v => v.id === id)?.name || id}' tag suggestion: ${fb}`)
                      .join('\n')

                    let fullMessage = text.trim() ? `[User Message]\n${text.trim()}\n\n` : ''
                    if (answers) fullMessage += `[Answers to Clarifications]\n${answers}\n\n`
                    if (accFeedback) fullMessage += `[Account Feedback]\n${accFeedback}\n\n`
                    if (venFeedback) fullMessage += `[Vendor Feedback]\n${venFeedback}\n\n`

                    fullMessage = fullMessage.trim()
                    if (!fullMessage) return

                    const opId = crypto.randomUUID()
                    setCurrentOperationId(opId)
                    
                    chatReview.mutate({ user_message: fullMessage, operationId: opId, streamReasoning })

                    setPendingAnswers({})
                    setPendingAccountFeedback({})
                    setPendingVendorFeedback({})
                  }}
                  sessionActive={!!session}
                  pendingAnswers={pendingAnswers}
                  onAnswerChange={(key, val) => setPendingAnswers(prev => ({...prev, [key]: val}))}
                />
              </div>

              {/* Right: Diff & Previews */}
              <div className="w-full lg:w-2/3 h-1/2 lg:h-full flex flex-col bg-neutral-950 overflow-hidden">
                {isInitializing ? (
                  <div className="h-full flex flex-col items-center justify-center text-neutral-500">
                    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
                    <p>Analyzing corrections and proposing changes...</p>
                  </div>
                ) : proposedRunbook ? (
                  <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-8">
                    
                    <RunbookAccountUpdatesPanel
                      updates={localAccountUpdates}
                      ignoredUpdates={ignoredUpdates}
                      onToggleIgnore={(id) => setIgnoredUpdates(prev => {
                        const next = new Set(prev)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })}
                      onUpdateChange={handleAccountUpdateChange}
                      pendingFeedback={pendingAccountFeedback}
                      onFeedbackChange={(id, text) => {
                        setPendingAccountFeedback(prev => {
                          const next = { ...prev }
                          if (text === null) delete next[id]
                          else next[id] = text
                          return next
                        })
                      }}
                      isThinking={isThinking}
                      getOldDescription={getOldDescription}
                      getOldTags={getOldTags}
                      getAccountName={getAccountName}
                    />
                    
                    <RunbookVendorUpdatesPanel
                      updates={localVendorUpdates}
                      ignoredUpdates={ignoredVendorUpdates}
                      onToggleIgnore={(id) => setIgnoredVendorUpdates(prev => {
                        const next = new Set(prev)
                        if (next.has(id)) next.delete(id)
                        else next.add(id)
                        return next
                      })}
                      onUpdateChange={handleVendorUpdateChange}
                      pendingFeedback={pendingVendorFeedback}
                      onFeedbackChange={(id, text) => {
                        setPendingVendorFeedback(prev => {
                          const next = { ...prev }
                          if (text === null) delete next[id]
                          else next[id] = text
                          return next
                        })
                      }}
                      isThinking={isThinking}
                      getOldVendorTags={getOldVendorTags}
                      getVendorName={getVendorName}
                    />
                    
                    <RunbookDocumentPanel
                      currentRunbook={currentRunbook}
                      proposedRunbook={proposedRunbook}
                    />

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
            </>
          )}
        </div>
      </div>

      <ReasoningDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        operationId={currentOperationId}
        isPending={isThinking}
        thinkingEventName="reclassifyThinking"
        progressEventName="chatProgress"
        finalContent={chatReview.data?.proposed_runbook || startReview.data?.proposed_runbook || undefined}
      />
    </div>
  )
}
