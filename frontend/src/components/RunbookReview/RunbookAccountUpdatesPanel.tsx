import { useState } from 'react'
import { Check, Trash2, Edit2, MessageSquare } from 'lucide-react'
import { AccountDescriptionUpdate } from '@/hooks/useRunbookReview'

interface RunbookAccountUpdatesPanelProps {
  updates: AccountDescriptionUpdate[]
  ignoredUpdates: Set<string>
  onToggleIgnore: (accountId: string) => void
  onUpdateChange: (accountId: string, newDesc: string, newTags: string[]) => void
  pendingFeedback: Record<string, string>
  onFeedbackChange: (accountId: string, text: string | null) => void
  isThinking: boolean
  getOldDescription: (id: string) => string
  getOldTags: (id: string) => string[]
  getAccountName: (id: string) => string
}

export function RunbookAccountUpdatesPanel({
  updates,
  ignoredUpdates,
  onToggleIgnore,
  onUpdateChange,
  pendingFeedback,
  onFeedbackChange,
  isThinking,
  getOldDescription,
  getOldTags,
  getAccountName
}: RunbookAccountUpdatesPanelProps) {
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null)

  
  const [editDescText, setEditDescText] = useState('')
  const [editTagsText, setEditTagsText] = useState('')

  if (updates.length === 0) return null

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shrink-0">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-800/50 flex justify-between items-center">
        <h3 className="text-sm font-medium text-white">Account Description Suggestions</h3>
        <span className="text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full">
          {updates.length} updates
        </span>
      </div>
      <div className="p-4 space-y-4">
        {updates.map((update, i) => {
          const isIgnored = ignoredUpdates.has(update.account_id)
          const isEditing = editingAccountId === update.account_id
          const hasFeedback = pendingFeedback[update.account_id] !== undefined
          
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
                          onFeedbackChange(update.account_id, null)
                        }}
                        className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                        title="Edit locally"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => {
                          onFeedbackChange(update.account_id, '')
                          setEditingAccountId(null)
                        }}
                        className={`p-1.5 rounded-md transition-colors ${hasFeedback ? 'text-indigo-400 bg-indigo-900/30' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}
                        title="Comment / Feedback to AI"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => onToggleIgnore(update.account_id)}
                    className={`p-1.5 rounded-md transition-colors ${isIgnored ? 'text-green-400 hover:bg-green-900/30' : 'text-neutral-400 hover:text-red-400 hover:bg-red-900/20'}`}
                    title={isIgnored ? "Restore" : "Ignore"}
                  >
                    {isIgnored ? <Check className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative">
                <div className="hidden md:block absolute left-1/2 top-0 bottom-0 w-px bg-neutral-800 -translate-x-1/2" />
                <div className="space-y-1 md:pr-2">
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
                <div className="space-y-1 md:pl-2 pt-2 md:pt-0 border-t md:border-t-0 border-neutral-800">
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
                            const newTags = editTagsText.split(',').map(t => t.trim()).filter(Boolean)
                            onUpdateChange(update.account_id, editDescText, newTags)
                            setEditingAccountId(null)
                          }}
                          className="text-xs px-2 py-1 bg-green-900/40 text-green-400 rounded-md hover:bg-green-900/60"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : hasFeedback ? (
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
                        value={pendingFeedback[update.account_id] || ''}
                        onChange={e => onFeedbackChange(update.account_id, e.target.value)}
                        placeholder={`Feedback for AI about ${getAccountName(update.account_id)}...`}
                        className="w-full bg-indigo-950/30 border border-indigo-900/50 rounded-md p-2 text-sm text-indigo-300 focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-16"
                        disabled={isThinking}
                      />
                      <div className="flex gap-2 justify-between items-center mt-1">
                        <span className="text-[10px] text-indigo-400/70 italic">
                          Feedback will be sent with your next chat message.
                        </span>
                        <button 
                          onClick={() => onFeedbackChange(update.account_id, null)}
                          className="text-xs px-2 py-1 text-neutral-400 hover:text-white"
                          disabled={isThinking}
                        >
                          Cancel
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
  )
}
