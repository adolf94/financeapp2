import { useState } from 'react'
import { Check, X, Edit, Sparkles, PlusCircle, MessageSquare, Bell, Mail, Image as ImageIcon } from 'lucide-react'
import dayjs from 'dayjs'
import { PendingIngestion } from '@/hooks/useIngestions'
import { AccountGroup } from '@/hooks/useAccounts'
import AuthenticatedReceiptImage from '@/components/AuthenticatedReceiptImage'

interface PendingIngestionCardProps {

  ingestion: PendingIngestion
  getAccountName: (id?: string | null) => string
  groups: AccountGroup[]
  isProcessing: boolean
  onQuickConfirm: (ingestion: PendingIngestion) => void
  onDismiss: (id: string) => void
  onEditConfirm: (ingestion: PendingIngestion) => void
  onOpenTransaction?: (transactionId: string) => void
  onUpdateVendor: (ingestionId: string, vendor: string) => Promise<void>
  onCreateSuggestedAccount: (data: any, ingestionId: string) => Promise<void>
}

export function hasMasks(name?: string | null): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  if (name.includes('*')) return true
  if (lower.includes('xxx')) return true
  if (/x{2,}/.test(lower)) return true
  if (/\d{4,}/.test(name)) return true
  return false
}

export default function PendingIngestionCard({
  ingestion,
  getAccountName,
  groups,
  isProcessing,
  onQuickConfirm,
  onDismiss,
  onEditConfirm,
  onOpenTransaction,
  onUpdateVendor,
  onCreateSuggestedAccount
}: PendingIngestionCardProps) {
  const [editingVendor, setEditingVendor] = useState<string | null>(null)
  const [editingSuggestion, setEditingSuggestion] = useState<{ idx: number, data: { name: string, account_group: string, type: string, description: string, tagsInput: string } } | null>(null)

  const confidence = ingestion.ai_parsed.confidence ?? 0.0
  const similarity = ingestion.similarity_score ?? 0.0
  const isHighConfidence = confidence >= 0.85 || similarity >= 0.90

  const suggestedVendor = ingestion.ai_parsed.vendor?.is_recommendation ? ingestion.ai_parsed.vendor : null
  const suggestedType = ingestion.ai_parsed.vendor?.type

  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

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
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">
              {dayjs(ingestion.received_at).format('MMM DD, YYYY • h:mm A')}
            </span>
            {ingestion.notification_type === 'sms' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700/50">
                <MessageSquare className="w-2.5 h-2.5" />
                SMS
              </span>
            )}
            {ingestion.notification_type === 'email' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50">
                <Mail className="w-2.5 h-2.5" />
                Email
              </span>
            )}
            {ingestion.notification_type === 'app' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50">
                <Bell className="w-2.5 h-2.5" />
                App
              </span>
            )}
            {ingestion.notification_type === 'image' && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50">
                <ImageIcon className="w-2.5 h-2.5" />
                Receipt Image
              </span>
            )}
          </div>
          {ingestion.notification_type === 'email' ? (
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                Email Summary
              </span>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 italic leading-snug">
                "{ingestion.ai_parsed.summary || ingestion.ai_parsed.notes || ingestion.raw_msg}"
              </p>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="self-start mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-350 border border-emerald-200/60 dark:border-emerald-900/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-all cursor-pointer shadow-sm"
              >
                <Mail className="w-3.5 h-3.5" />
                Preview Email
              </button>
            </div>
          ) : ingestion.notification_type === 'image' ? (
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                Receipt Summary
              </span>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 italic leading-snug">
                "{ingestion.ai_parsed.summary || ingestion.ai_parsed.notes || ingestion.raw_msg}"
              </p>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="self-start mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-900/40 hover:bg-purple-100 dark:hover:bg-purple-950/60 transition-all cursor-pointer shadow-sm"
              >
                <ImageIcon className="w-3.5 h-3.5" />
                Preview Receipt
              </button>
            </div>
          ) : (
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-1">
              "{ingestion.raw_msg}"
            </p>
          )}
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

      {isPreviewOpen && (
        <div className="fixed inset-0 bg-black/60 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 rounded-t-2xl">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="font-bold text-slate-950 dark:text-white text-base truncate">
                  {ingestion.raw_payload?.subject || ingestion.raw_payload?.Subject || ingestion.raw_payload?.notif_title || (ingestion.notification_type === 'image' ? 'Receipt Image Preview' : 'Email Preview')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                  {ingestion.notification_type === 'image' 
                    ? `File: ${ingestion.raw_payload?.filename || 'Receipt'} (${ingestion.raw_payload?.file_size ? `${(ingestion.raw_payload.file_size / 1024).toFixed(1)} KB` : ''})`
                    : `From: ${ingestion.raw_payload?.from || ingestion.raw_payload?.From || ingestion.raw_payload?.sender || 'Unknown'}`}
                </p>
              </div>
              <button 
                onClick={() => setIsPreviewOpen(false)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 bg-white dark:bg-slate-950 text-sm min-h-[300px]">
              {ingestion.notification_type === 'image' ? (
                <div className="flex flex-col items-center justify-center p-4 bg-slate-950 rounded-xl">
                  <AuthenticatedReceiptImage
                    ingestionId={ingestion.id}
                    alt={ingestion.raw_payload?.filename || 'Receipt Image'}
                    className="max-h-[60vh] max-w-full object-contain rounded-lg shadow-lg"
                  />
                  <div className="mt-3 flex justify-between w-full text-xs text-slate-400 px-2">
                    <span>{ingestion.raw_payload?.filename || 'Receipt Image'}</span>
                    <span>{ingestion.raw_payload?.file_size ? `${(ingestion.raw_payload.file_size / 1024).toFixed(1)} KB` : ''}</span>
                  </div>
                </div>
              ) : (() => {

                const html = ingestion.raw_payload?.html_content || ingestion.raw_payload?.html || ingestion.raw_payload?.body_html
                const markdown = ingestion.raw_payload?.markdown_content || ingestion.raw_payload?.markdown || ingestion.raw_payload?.body_markdown
                const plainText = ingestion.raw_payload?.raw_msg || ingestion.raw_payload?.body || ingestion.raw_payload?.text || ingestion.raw_payload?.content || ingestion.raw_payload?.text_content || ingestion.raw_msg

                if (html) {
                  return (
                    <iframe
                      srcDoc={html}
                      title="Email Body"
                      className="w-full h-[55vh] border border-slate-150 dark:border-slate-800 bg-white rounded-xl shadow-inner"
                      sandbox="allow-same-origin"
                    />
                  )
                }
                
                return (
                  <pre className="whitespace-pre-wrap font-sans text-slate-800 dark:text-slate-200 p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-150 dark:border-slate-800">
                    {markdown || plainText}
                  </pre>
                )
              })()}
            </div>
          </div>
        </div>
      )}


      {/* Proposed transaction details */}
      <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-950/50 rounded-xl text-xs border border-slate-100 dark:border-slate-800/60">
        <div className="flex flex-col gap-0.5">
          <span className={`uppercase font-semibold text-[10px] ${ingestion.ai_parsed.vendor?.matched ? 'text-slate-400' : 'text-amber-500'}`}>
            {ingestion.ai_parsed.vendor?.matched ? 'Vendor' : 'Suggested Vendor'}
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
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2 group flex-wrap animate-fade-in">
                <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
                  {ingestion.ai_parsed.vendor?.name || 'Unknown Vendor'}
                </span>
                {!ingestion.ai_parsed.vendor?.matched && suggestedType === 'Individual' && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold" title="Individual">(I)</span>
                )}
                {!ingestion.ai_parsed.vendor?.matched && suggestedType === 'Business' && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold" title="Business">(B)</span>
                )}
                


                <button
                  onClick={() => setEditingVendor(ingestion.ai_parsed.vendor?.name || '')}
                  className="text-slate-400 hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Edit Vendor"
                >
                  <Edit className="w-3.5 h-3.5" />
                </button>
              </div>
              {!ingestion.ai_parsed.vendor?.matched && suggestedVendor?.tags && suggestedVendor.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {suggestedVendor.tags.map((tag: string) => (
                    <span key={tag} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-md text-[9px] font-medium">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
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
                      <Sparkles className="w-3 h-3" /> Suggested Account
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
                            {['Adjustment', 'Asset', 'Bank', 'Cash', 'CreditCard', 'Equity', 'Expense', 'Income', 'Investment', 'Liability'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                          <div className="flex flex-col gap-1 w-full">

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
        {ingestion.ai_parsed.reference_number && (
          <div className="flex flex-col gap-0.5">
            <span className="text-slate-400 uppercase font-semibold text-[10px]">Ref No.</span>
            <span className="text-slate-700 dark:text-slate-350 font-medium truncate">
              {ingestion.ai_parsed.reference_number}
            </span>
          </div>
        )}
      </div>
 
      {/* Action buttons */}
      {ingestion.status !== 'AutoConfirmed' && ingestion.status !== 'Confirmed' && (
        <div className="flex gap-2 justify-end items-center border-t border-slate-100 dark:border-slate-800/80 pt-3 flex-wrap">
          {!ingestion.ai_parsed.vendor?.matched && hasMasks(ingestion.ai_parsed.vendor?.name) && (
            <span className="text-[10px] text-amber-500 font-medium mr-auto">
              Name contains masks (edit to enable Quick Confirm)
            </span>
          )}
          <button
            onClick={() => onDismiss(ingestion.id)}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-400 dark:hover:border-rose-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 text-sm font-medium"
          >
            <X className="w-4 h-4" strokeWidth={2} />
            Dismiss
          </button>
 
          <button
            onClick={() => onEditConfirm(ingestion)}
            disabled={isProcessing}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 text-sm font-medium"
          >
            <Edit className="w-4 h-4" strokeWidth={2} />
            Edit
          </button>
          <button
            onClick={() => onQuickConfirm(ingestion)}
            disabled={isProcessing || (!ingestion.ai_parsed.vendor?.matched && hasMasks(ingestion.ai_parsed.vendor?.name))}
            title={!ingestion.ai_parsed.vendor?.matched && hasMasks(ingestion.ai_parsed.vendor?.name) ? "Quick Confirm disabled (vendor name contains masks)" : "Quick Confirm"}
            className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 text-sm font-medium"
          >
            <Check className="w-4 h-4" strokeWidth={2.5} />
            Confirm
          </button>
        </div>
      )}
      {(ingestion.status === 'AutoConfirmed' || ingestion.status === 'Confirmed') && ingestion.transaction_id && onOpenTransaction && (
        <div className="flex gap-2 justify-end items-center border-t border-slate-100 dark:border-slate-800/80 pt-3 flex-wrap">
          <button
            onClick={() => onOpenTransaction(ingestion.transaction_id!)}
            className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors cursor-pointer shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 text-sm font-medium"
          >
            View Transaction
          </button>
        </div>
      )}
    </div>
  )
}
