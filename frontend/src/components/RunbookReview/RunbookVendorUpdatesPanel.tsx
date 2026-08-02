import { useState } from 'react'
import { Check, Trash2, Edit2, MessageSquare, Send } from 'lucide-react'
import { VendorUpdate } from '@/hooks/useRunbookReview'

interface RunbookVendorUpdatesPanelProps {
  updates: VendorUpdate[]
  ignoredUpdates: Set<string>
  onToggleIgnore: (vendorId: string) => void
  onUpdateChange: (vendorId: string, newTags: string[]) => void
  onSendFeedback: (vendorId: string, vendorName: string, text: string) => void
  isThinking: boolean
  getOldVendorTags: (id: string) => string[]
  getVendorName: (id: string) => string
}

export function RunbookVendorUpdatesPanel({
  updates,
  ignoredUpdates,
  onToggleIgnore,
  onUpdateChange,
  onSendFeedback,
  isThinking,
  getOldVendorTags,
  getVendorName
}: RunbookVendorUpdatesPanelProps) {
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null)
  const [editVendorTagsText, setEditVendorTagsText] = useState('')
  
  const [commentingVendorId, setCommentingVendorId] = useState<string | null>(null)
  const [commentVendorText, setCommentVendorText] = useState('')

  if (updates.length === 0) return null

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shrink-0">
      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-800/50 flex justify-between items-center">
        <h3 className="text-sm font-medium text-white">Vendor Tag Suggestions</h3>
        <span className="text-xs text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-full">
          {updates.length} updates
        </span>
      </div>
      <div className="p-4 space-y-4">
        {updates.map((update, i) => {
          const isIgnored = ignoredUpdates.has(update.vendor_id)
          const isEditing = editingVendorId === update.vendor_id
          const isCommenting = commentingVendorId === update.vendor_id
          
          return (
            <div key={i} className={`bg-neutral-950 border border-neutral-800 rounded-lg p-4 transition-colors ${isIgnored ? 'opacity-50 grayscale' : ''}`}>
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded-md font-medium">
                    {getVendorName(update.vendor_id)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {!isIgnored && (
                    <>
                      <button 
                        onClick={() => {
                          setEditingVendorId(update.vendor_id)
                          setEditVendorTagsText(update.new_tags ? update.new_tags.join(', ') : '')
                          setCommentingVendorId(null)
                        }}
                        className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                        title="Edit locally"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => {
                          setCommentingVendorId(update.vendor_id)
                          setCommentVendorText('')
                          setEditingVendorId(null)
                        }}
                        className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors"
                        title="Comment / Feedback to AI"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button 
                    onClick={() => onToggleIgnore(update.vendor_id)}
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
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Current Tags</div>
                  {getOldVendorTags(update.vendor_id).length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {getOldVendorTags(update.vendor_id).map((t, ti) => (
                        <span key={ti} className="px-1.5 py-0.5 bg-neutral-800 text-neutral-300 text-[10px] rounded">{t}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-500 italic">None</div>
                  )}
                </div>
                <div className="space-y-1 md:pl-2 pt-2 md:pt-0 border-t md:border-t-0 border-neutral-800">
                  <div className="text-[10px] uppercase tracking-wider text-green-500 font-semibold">Suggested Tags</div>
                  {isEditing ? (
                    <div className="space-y-2 z-10 relative">
                      <input
                        value={editVendorTagsText}
                        onChange={e => setEditVendorTagsText(e.target.value)}
                        placeholder="Tags (comma separated)"
                        className="w-full bg-neutral-900 border border-neutral-700 rounded-md p-2 text-sm text-green-400 focus:ring-1 focus:ring-green-500 outline-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button 
                          onClick={() => setEditingVendorId(null)}
                          className="text-xs px-2 py-1 text-neutral-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => {
                            const newTags = editVendorTagsText.split(',').map(t => t.trim()).filter(Boolean)
                            onUpdateChange(update.vendor_id, newTags)
                            setEditingVendorId(null)
                          }}
                          className="text-xs px-2 py-1 bg-green-900/40 text-green-400 rounded-md hover:bg-green-900/60"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : isCommenting ? (
                    <div className="space-y-2 z-10 relative">
                      {update.new_tags && update.new_tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {update.new_tags.map((t, ti) => (
                            <span key={ti} className="px-1.5 py-0.5 bg-green-900/30 text-green-400 text-[10px] rounded">{t}</span>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={commentVendorText}
                        onChange={e => setCommentVendorText(e.target.value)}
                        placeholder={`Feedback for AI about ${getVendorName(update.vendor_id)}...`}
                        className="w-full bg-indigo-950/30 border border-indigo-900/50 rounded-md p-2 text-sm text-indigo-300 focus:ring-1 focus:ring-indigo-500 outline-none resize-none h-16"
                      />
                      <div className="flex gap-2 justify-end">
                        <button 
                          onClick={() => setCommentingVendorId(null)}
                          className="text-xs px-2 py-1 text-neutral-400 hover:text-white"
                          disabled={isThinking}
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={() => {
                            if (commentVendorText.trim()) {
                              onSendFeedback(update.vendor_id, getVendorName(update.vendor_id), commentVendorText)
                            }
                            setCommentingVendorId(null)
                          }}
                          disabled={isThinking || !commentVendorText.trim()}
                          className="flex items-center gap-1 text-xs px-2 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          Send to AI
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {update.new_tags && update.new_tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {update.new_tags.map((t, ti) => (
                            <span key={ti} className="px-1.5 py-0.5 bg-green-900/30 text-green-400 text-[10px] rounded">{t}</span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-neutral-500 italic">No tags</div>
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
