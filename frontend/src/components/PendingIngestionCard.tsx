import { useState } from 'react'
import { Check, X, Edit, Sparkles, PlusCircle } from 'lucide-react'
import dayjs from 'dayjs'
import { PendingIngestion } from '@/hooks/useIngestions'
import { AccountGroup } from '@/hooks/useAccounts'

interface PendingIngestionCardProps {
  ingestion: PendingIngestion
  getAccountName: (id?: string | null) => string
  groups: AccountGroup[]
  isProcessing: boolean
  onQuickConfirm: (ingestion: PendingIngestion) => void
  onDismiss: (id: string) => void
  onEditConfirm: (ingestion: PendingIngestion) => void
  onUpdateVendor: (ingestionId: string, vendor: string) => Promise<void>
  onCreateSuggestedAccount: (data: any, ingestionId: string) => Promise<void>
  onGenerateDesc: (data: { accountName: string, accountType: string, groupName: string, context?: string }, onSuccess: (data: {description: string, tags?: string[]}) => void) => void
  isGeneratingDesc: boolean
}

export default function PendingIngestionCard({
  ingestion,
  getAccountName,
  groups,
  isProcessing,
  onQuickConfirm,
  onDismiss,
  onEditConfirm,
  onUpdateVendor,
  onCreateSuggestedAccount,
  onGenerateDesc,
  isGeneratingDesc
}: PendingIngestionCardProps) {
  const [editingVendor, setEditingVendor] = useState<string | null>(null)
  const [editingSuggestion, setEditingSuggestion] = useState<{ idx: number, data: { name: string, account_group: string, type: string, description: string, tagsInput: string } } | null>(null)

  const confidence = ingestion.ai_parsed.confidence ?? 0.0
  const similarity = ingestion.similarity_score ?? 0.0
  const isHighConfidence = confidence >= 0.85 || similarity >= 0.90

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-sm hover:shadow transition-shadow relative overflow-hidden">
      {/* Top Accent line representing AI Match level */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 ${
          isHighConfidence ? 'bg-emerald-500' : 'bg-amber-500'
        }`}
      />

      <div className="flex justify-between items-start gap-4">
        <div className="flex flex-col gap-1 flex-1">
          <span className="text-xs font-semibold text-slate-400">
            {dayjs(ingestion.received_at).format('MMM DD, YYYY • h:mm A')}
          </span>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            "{ingestion.raw_msg}"
          </p>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-slate-900 dark:text-slate-50">
            ₱{(ingestion.ai_parsed.amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1 mt-0.5">
            <Sparkles className="w-3 h-3 text-blue-500" />
            {(Math.max(confidence, similarity) * 100).toFixed(0)}% match
          </div>
        </div>
      </div>

      {/* Proposed transaction details */}
      <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl text-xs border border-slate-100 dark:border-slate-800/60">
        <div className="flex flex-col gap-0.5">
          <span className={`uppercase font-semibold text-[10px] ${ingestion.ai_parsed.vendor_matched ? 'text-slate-400' : 'text-amber-500'}`}>
            {ingestion.ai_parsed.vendor_matched ? 'Vendor' : 'Suggested Vendor'}
          </span>
          {editingVendor !== null ? (
            <div className="flex items-center gap-1 mt-1">
              <input 
                autoFocus
                value={editingVendor}
                onChange={e => setEditingVendor(e.target.value)}
                className="w-full text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                placeholder="Vendor Name"
              />
              <button
                onClick={async () => {
                  await onUpdateVendor(ingestion.id, editingVendor)
                  setEditingVendor(null)
                }}
                disabled={!editingVendor.trim() || isProcessing}
                className="bg-blue-600 hover:bg-blue-700 text-white p-1 rounded disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setEditingVendor(null)}
                className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 p-1 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
                {ingestion.ai_parsed.vendor || 'Unknown Vendor'}
              </span>
              <button
                onClick={() => setEditingVendor(ingestion.ai_parsed.vendor || '')}
                className="text-slate-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit Vendor"
              >
                <Edit className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {ingestion.ai_parsed.suggested_account_creation && ingestion.ai_parsed.suggested_account_creation.length > 0 && (
          <div className="flex flex-col gap-2 col-span-2">
            {ingestion.ai_parsed.suggested_account_creation.map((suggestion, idx) => {
              const isEditing = editingSuggestion?.idx === idx
              return (
              <div key={idx} className="flex flex-col gap-1.5 bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg border border-blue-100 dark:border-blue-900/30">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col gap-0.5 flex-1 pr-2">
                    <span className="text-blue-500 uppercase font-semibold text-[10px] flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Suggested Account Creation
                    </span>
                    {isEditing ? (
                        <div className="flex flex-col gap-1.5 mt-1">
                          <input 
                            value={editingSuggestion.data.name}
                            onChange={e => setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, name: e.target.value}})}
                            className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                            placeholder="Account Name"
                          />
                          <div className="relative">
                            <input 
                              value={editingSuggestion.data.account_group}
                              onChange={e => setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, account_group: e.target.value}})}
                              className={`w-full text-xs px-2 py-1 rounded border bg-white dark:bg-slate-950 text-slate-900 dark:text-white pr-8 ${groups.some(g => g.name.toLowerCase() === editingSuggestion.data.account_group.toLowerCase()) ? 'border-green-400 dark:border-green-600 focus:outline-none focus:ring-1 focus:ring-green-500' : 'border-blue-200 dark:border-blue-800'}`}
                              placeholder="Account Group"
                            />
                            {groups.some(g => g.name.toLowerCase() === editingSuggestion.data.account_group.toLowerCase()) && (
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-green-600 dark:text-green-400 font-bold" title="Group exists">
                                <Check className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                          <select
                            value={editingSuggestion.data.type}
                            onChange={e => setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, type: e.target.value}})}
                            className="text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                          >
                            {['Cash', 'Bank', 'CreditCard', 'Investment', 'Asset', 'Liability', 'Equity', 'Income', 'Expense', 'Adjustment'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <div className="flex flex-col gap-1 w-full">
                            <div className="flex gap-1 items-center w-full">
                              <input 
                                value={editingSuggestion.data.description || ''}
                                onChange={e => setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, description: e.target.value}})}
                                className="flex-1 text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                                placeholder="Description (optional)"
                              />
                              <button 
                                onClick={() => {
                                  onGenerateDesc({ 
                                    accountName: editingSuggestion.data.name, 
                                    accountType: editingSuggestion.data.type, 
                                    groupName: editingSuggestion.data.account_group, 
                                    context: ingestion.raw_msg 
                                  }, (data) => {
                                    if (editingSuggestion) {
                                      setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, description: data.description, tagsInput: data.tags ? data.tags.join(', ') : ''}})
                                    }
                                  })
                                }}
                                disabled={isGeneratingDesc || !editingSuggestion.data.name || !editingSuggestion.data.account_group}
                                className="p-1 text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded transition-colors disabled:opacity-50"
                                title="Generate Description with AI"
                              >
                                <Sparkles className={`w-3.5 h-3.5 ${isGeneratingDesc ? 'animate-pulse' : ''}`} />
                              </button>
                            </div>
                            <input 
                              value={editingSuggestion.data.tagsInput || ''}
                              onChange={e => setEditingSuggestion({...editingSuggestion, data: {...editingSuggestion.data, tagsInput: e.target.value}})}
                              className="w-full text-xs px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                              placeholder="Tags (comma separated)"
                            />
                          </div>
                        </div>
                    ) : (
                      <span className="text-slate-700 dark:text-slate-300 font-medium text-xs">
                        {suggestion.account_group} - {suggestion.name}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={async () => {
                            await onCreateSuggestedAccount(editingSuggestion.data, ingestion.id)
                            setEditingSuggestion(null)
                          }}
                          disabled={isProcessing || !editingSuggestion.data.name || !editingSuggestion.data.account_group}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" /> Save
                        </button>
                        <button
                          onClick={() => setEditingSuggestion(null)}
                          className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => onCreateSuggestedAccount(suggestion, ingestion.id)}
                          disabled={isProcessing}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                        >
                          <PlusCircle className="w-3 h-3" /> Create
                        </button>
                        <button
                          onClick={() => setEditingSuggestion({ idx, data: { name: suggestion.name, account_group: suggestion.account_group, type: suggestion.type, description: (suggestion as any).description || '', tagsInput: (suggestion as any).tags ? (suggestion as any).tags.join(', ') : '' } })}
                          disabled={isProcessing}
                          className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded text-[10px] font-semibold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                        >
                          <Edit className="w-3 h-3" /> Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {!isEditing && (
                  <span className="text-slate-500 dark:text-slate-400 text-[10px] leading-tight mt-1">
                    {suggestion.reason}
                  </span>
                )}
              </div>
            )})}
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-slate-400 uppercase font-semibold text-[10px]">From Account</span>
          <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
            {getAccountName(ingestion.ai_parsed.credit_account_id)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-slate-400 uppercase font-semibold text-[10px]">To Account</span>
          <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
            {getAccountName(ingestion.ai_parsed.debit_account_id)}
          </span>
        </div>
        {ingestion.ai_parsed.application && (
          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 uppercase font-semibold text-[10px]">Source App</span>
            <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
              {ingestion.ai_parsed.application}
            </span>
          </div>
        )}
        {(ingestion.ai_parsed.recipient_account_number || ingestion.ai_parsed.recipient_account_name) && (
          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 uppercase font-semibold text-[10px]">Recipient Acc</span>
            <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
              {ingestion.ai_parsed.recipient_account_name || ''} 
              {ingestion.ai_parsed.recipient_account_number ? ` (${ingestion.ai_parsed.recipient_account_number})` : ''}
            </span>
          </div>
        )}
        {(ingestion.ai_parsed.sender_account_number || ingestion.ai_parsed.sender_account_name) && (
          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 uppercase font-semibold text-[10px]">Sender Acc</span>
            <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
              {ingestion.ai_parsed.sender_account_name || ''} 
              {ingestion.ai_parsed.sender_account_number ? ` (${ingestion.ai_parsed.sender_account_number})` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end border-t border-slate-100 dark:border-slate-800/80 pt-3">
        <button
          onClick={() => onDismiss(ingestion.id)}
          disabled={isProcessing}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/20 dark:hover:text-rose-400 transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" /> Dismiss
        </button>
        <button
          onClick={() => onEditConfirm(ingestion)}
          disabled={isProcessing}
          className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 hover:bg-slate-100 dark:text-slate-350 dark:hover:bg-slate-850 transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <Edit className="w-3.5 h-3.5" /> Edit details
        </button>
        <button
          onClick={() => onQuickConfirm(ingestion)}
          disabled={isProcessing}
          className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors flex items-center gap-1.5 text-xs font-semibold cursor-pointer shadow-sm disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Quick Confirm
        </button>
      </div>
    </div>
  )
}
