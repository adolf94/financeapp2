
import { useState } from 'react'
import { RotateCcw, Sparkles, Plus, X, Check, Mail, MessageSquare, Bell, Image as ImageIcon, AlertTriangle, Link2, ExternalLink } from 'lucide-react'
import dayjs from 'dayjs'
import { useAddTransaction } from './AddTransactionContext'
import { useUpdateIngestionVendor, useGetPendingIngestions, PendingIngestion } from '@/hooks/useIngestions'
import { useGetVendors, useCreateVendor } from '@/hooks/useVendors'
import { useGetAccounts } from '@/hooks/useAccounts'
import SuggestedAccountsPanel from './SuggestedAccountsPanel'
import { IngestionReviewSkeleton } from '@/components/ui/Skeleton'
import AuthenticatedReceiptImage from '@/components/AuthenticatedReceiptImage'

const getIngestionAppName = (ing: PendingIngestion) => {


  if (ing.ai_parsed?.application) return ing.ai_parsed.application

  const payload = (ing.raw_payload as any) || {}
  const keys = Object.keys(payload)

  const pkgKey = keys.find(k => k.toLowerCase() === 'notif_pkg' || k.toLowerCase() === 'notifpkg' || k.toLowerCase() === 'package');
  const senderKey = keys.find(k => k.toLowerCase() === 'sms_rcv_sender' || k.toLowerCase() === 'smssender' || k.toLowerCase() === 'sender' || k.toLowerCase() === 'from');

  const pkg = (pkgKey ? payload[pkgKey] : null) || (senderKey ? payload[senderKey] : null) || '';
  if (!pkg || typeof pkg !== 'string') return 'Notification'

  return pkg
}

const hasMasks = (vendorName?: string) => {
  if (!vendorName) return false
  return vendorName.includes('*') || vendorName.includes('X') || vendorName.includes('x')
}

export default function IngestionReviewPanel() {
  const {
    ingestion,
    ingestionId,
    isLoadingIngestion,
    isReviewOpen,
    setIsReviewOpen,
    setConfirmReclassifyOpen,
    setVendor,
    suggestedVendorType,
    setSuggestedVendorType,
    suggestedVendorTags,
    setSuggestedVendorTags,
    reclassifyMutation,
    setIsDrawerOpen,
    mergeRelatedIds,
    setMergeRelatedIds,
    linkAndDismissIngestion,
  } = useAddTransaction()

  const { data: dbVendors = [] } = useGetVendors()
  const { data: accounts = [] } = useGetAccounts()
  const { data: allPendingIngestions = [] } = useGetPendingIngestions('Pending')

  const createVendorMutation = useCreateVendor()
  const updateIngestionVendorMutation = useUpdateIngestionVendor()

  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [selectedRelatedItem, setSelectedRelatedItem] = useState<PendingIngestion | null>(null)

  // Resolve relation fields
  const definiteRelatedIds = ingestion?.related_ingestion_ids || (ingestion as any)?.RelatedIngestionIds || []
  const possibleRelatedIds = ingestion?.possible_related_ingestion_ids || (ingestion as any)?.PossibleRelatedIngestionIds || []
  const allRelatedPendingIds = Array.from(new Set([...definiteRelatedIds, ...possibleRelatedIds]))
  const relatedPendingItems = allPendingIngestions.filter((item) => allRelatedPendingIds.includes(item.id) && item.status === 'Pending')

  // Auto-select all related pending items for merge by default when modal opens
  const hasAutoInitializedMergeRef = useState({ initialized: false })[0]
  if (!hasAutoInitializedMergeRef.initialized && relatedPendingItems.length > 0 && mergeRelatedIds.length === 0) {
    setMergeRelatedIds(relatedPendingItems.map((i) => i.id))
    hasAutoInitializedMergeRef.initialized = true
  }

  if (isLoadingIngestion) {
    return <IngestionReviewSkeleton />
  }

  if (!ingestion) return null

  const getAccountName = (id?: string | null) => {
    if (!id) return 'Unassigned'
    return accounts.find((a) => a.id === id)?.name ?? 'Unknown Account'
  }

  const handleCreateVendor = () => {
    const tags = suggestedVendorTags
      ? suggestedVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
      : []
    createVendorMutation.mutate(
      { name: ingestion.ai_parsed.vendor?.name!, type: suggestedVendorType, tags },
      {
        onSuccess: () => {
          setVendor(ingestion.ai_parsed.vendor?.name!)
          updateIngestionVendorMutation.mutate({
            id: ingestion.id,
            vendor: ingestion.ai_parsed.vendor?.name!,
          })
        },
      }
    )
  }

  const toggleMergeId = (id: string) => {
    setMergeRelatedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const hasConfirmedMatch = Boolean(
    ingestion.has_possible_confirmed_match ||
    ingestion.HasPossibleConfirmedMatch ||
    (ingestion.related_transaction_ids && ingestion.related_transaction_ids.length > 0)
  )

  return (
    <div className="md:col-span-5 order-first md:order-last flex flex-col gap-2.5 md:sticky md:top-0 bg-slate-100 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xs">
      <div className="flex justify-between items-center w-full font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider text-[11px]">
        <div className="flex items-center gap-1.5">
          <span>Notification Review</span>
          {ingestion.notification_type === 'sms' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700/50">
              <MessageSquare className="w-2.5 h-2.5" />
              SMS
            </span>
          )}
          {ingestion.notification_type === 'email' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50">
              <Mail className="w-2.5 h-2.5" />
              Email
            </span>
          )}
          {ingestion.notification_type === 'app' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50">
              <Bell className="w-2.5 h-2.5" />
              App
            </span>
          )}
          {ingestion.notification_type === 'image' && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50">
              <ImageIcon className="w-2.5 h-2.5" />
              Receipt
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsReviewOpen(!isReviewOpen)}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-bold cursor-pointer normal-case text-[11px]"
          aria-expanded={isReviewOpen}
        >
          {isReviewOpen ? 'Hide AI Details' : 'Show AI Details'}
        </button>
      </div>

      {/* Confirmed Match Warning Banner */}
      {hasConfirmedMatch && (
        <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-200 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-medium">
              A confirmed transaction for this amount already exists.
            </span>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-200/60 dark:border-amber-900/40">
            <button
              type="button"
              onClick={linkAndDismissIngestion}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] transition-colors cursor-pointer shadow-2xs"
            >
              <Check className="w-3 h-3" /> Link & Dismiss Ingestion
            </button>
          </div>
        </div>
      )}

      {/* Related Pending Notifications Banner with Merge Controls */}
      {relatedPendingItems.length > 0 && (
        <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-blue-900 dark:text-blue-200 flex items-center gap-1.5 text-[11px]">
              <Link2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              Related Notifications ({relatedPendingItems.length})
            </span>
            <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">
              {definiteRelatedIds.length > 0 ? 'Exact Ref Match' : 'Same Amount & Time'}
            </span>
          </div>

          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            Select notifications to merge (auto-dismiss as merged on save):
          </p>

          <div className="flex flex-col gap-1.5">
            {relatedPendingItems.map((item) => {
              const type = item.notification_type || 'app'
              const isSelected = mergeRelatedIds.includes(item.id)
              return (
                <div
                  key={item.id}
                  className={`flex items-center justify-between p-1.5 rounded-lg border transition-all ${
                    isSelected
                      ? 'bg-blue-100/70 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleMergeId(item.id)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <div className="flex items-center gap-1.5 text-[11px] truncate">
                      {type === 'sms' && <MessageSquare className="w-3 h-3 text-cyan-600 shrink-0" />}
                      {type === 'email' && <Mail className="w-3 h-3 text-emerald-600 shrink-0" />}
                      {type === 'image' && <ImageIcon className="w-3 h-3 text-purple-600 shrink-0" />}
                      {type === 'app' && <Bell className="w-3 h-3 text-indigo-600 shrink-0" />}
                      <span className="font-semibold capitalize text-slate-800 dark:text-slate-200 truncate">
                        {item.ai_parsed?.vendor?.name || type}
                      </span>
                      <span className="text-slate-400 font-normal shrink-0">
                        ({dayjs(item.received_at).format('h:mm A')})
                      </span>
                    </div>
                  </label>
                  <button
                    type="button"
                    onClick={() => setSelectedRelatedItem(item)}
                    title="View details"
                    className="p-1 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer shrink-0"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Primary Raw Notification / Summary Message - ALWAYS VISIBLE */}
      {ingestion.notification_type === 'email' ? (
        <div className="p-3 bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex flex-col gap-2 shadow-xs">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1">
              <Mail className="w-3 h-3" /> Email Summary
            </span>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 transition-colors shadow-xs cursor-pointer"
            >
              <Mail className="w-3 h-3" /> Preview Email
            </button>
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-medium text-xs leading-relaxed">
            "{ingestion.ai_parsed.summary || ingestion.ai_parsed.notes || ingestion.raw_msg}"
          </p>
        </div>
      ) : ingestion.notification_type === 'image' ? (
        <div className="p-3 bg-purple-50/90 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 rounded-xl flex flex-col gap-2 shadow-xs">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold text-purple-700 dark:text-purple-300 uppercase tracking-wider flex items-center gap-1">
              <ImageIcon className="w-3 h-3" /> Receipt Summary
            </span>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 dark:text-purple-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-md border border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/60 transition-colors shadow-xs cursor-pointer"
            >
              <ImageIcon className="w-3 h-3" /> Preview Receipt
            </button>
          </div>
          <p className="text-slate-900 dark:text-slate-100 font-medium text-xs leading-relaxed">
            "{ingestion.ai_parsed.summary || ingestion.ai_parsed.notes || ingestion.raw_msg}"
          </p>
        </div>
      ) : ingestion.notification_type === 'sms' ? (
        <div className="p-3 bg-cyan-50/90 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800/60 rounded-xl flex flex-col gap-1.5 shadow-xs">
          <span className="text-[10px] font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> SMS Message
          </span>
          <p className="text-slate-900 dark:text-slate-100 font-medium text-xs leading-relaxed">
            "{ingestion.raw_msg}"
          </p>
        </div>
      ) : (
        <div className="p-3 bg-indigo-50/90 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-xl flex flex-col gap-1.5 shadow-xs">
          <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider flex items-center gap-1">
            <Bell className="w-3 h-3" /> App Notification
          </span>
          <p className="text-slate-900 dark:text-slate-100 font-medium text-xs leading-relaxed">
            "{ingestion.raw_msg}"
          </p>
        </div>
      )}

      {isReviewOpen && (
        <div className="flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1">

          {/* Sender / Recipient / App metadata if present */}
          <div className="grid grid-cols-2 gap-2.5 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs">
            <div>
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Source App
              </span>
              <p className="text-slate-900 dark:text-slate-100 font-bold text-xs mt-0.5 truncate">
                {getIngestionAppName(ingestion)}
              </p>
            </div>
            {(ingestion.ai_parsed.sender_account_name || ingestion.ai_parsed.sender_account_number) && (
              <div>
                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Sender Acc
                </span>
                <p className="text-slate-900 dark:text-slate-100 font-bold text-xs mt-0.5 truncate">
                  {ingestion.ai_parsed.sender_account_name || 'N/A'}
                  {ingestion.ai_parsed.sender_account_number
                    ? ` (${ingestion.ai_parsed.sender_account_number})`
                    : ''}
                </p>
              </div>
            )}
            {ingestion.ai_parsed.reference_number && (
              <div>
                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Ref No.
                </span>
                <p className="text-slate-900 dark:text-slate-100 font-bold text-xs mt-0.5 truncate">
                  {ingestion.ai_parsed.reference_number}
                </p>
              </div>
            )}
            {(ingestion.ai_parsed.recipient_account_name ||
              ingestion.ai_parsed.recipient_account_number) && (
                <div className="col-span-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                  <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Recipient Acc
                  </span>
                  <p className="text-slate-900 dark:text-slate-100 font-bold text-xs mt-0.5 truncate">
                    {ingestion.ai_parsed.recipient_account_name || 'N/A'}
                    {ingestion.ai_parsed.recipient_account_number
                      ? ` (${ingestion.ai_parsed.recipient_account_number})`
                      : ''}
                  </p>
                </div>
              )}
          </div>

          {/* AI Reasoning */}
          {ingestion.ai_parsed.why && (
            <div className="p-3 bg-indigo-50/80 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 rounded-xl">
              <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> AI Reasoning
              </span>
              <p className="text-slate-800 dark:text-slate-200 mt-1 leading-relaxed text-xs font-medium">
                {ingestion.ai_parsed.why}
              </p>
            </div>
          )}

          {/* Suggested Vendor */}
          {ingestion.ai_parsed.vendor?.name &&
            ingestionId &&
            !ingestion.ai_parsed.vendor?.matched &&
            !dbVendors.some(
              (v) => v.name.toLowerCase() === ingestion.ai_parsed.vendor?.name?.toLowerCase()
            ) && (
              <div
                key={`${ingestion.id}-suggested-vendor`}
                className="flex flex-col gap-2.5 p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-blue-600 dark:text-blue-400 uppercase tracking-wider font-bold text-[9px] flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={2} /> Suggested Vendor
                  </span>
                  <span className="text-slate-800 dark:text-slate-200 font-bold text-xs flex items-center gap-1.5 flex-wrap">
                    {ingestion.ai_parsed.vendor.name}
                    {ingestion.ai_parsed.vendor?.type === 'Individual' && (
                      <span className="text-[10px] text-slate-500 font-bold" title="Individual">
                        (I)
                      </span>
                    )}
                    {ingestion.ai_parsed.vendor?.type === 'Business' && (
                      <span className="text-[10px] text-slate-500 font-bold" title="Business">
                        (B)
                      </span>
                    )}
                  </span>
                  {ingestion.ai_parsed.vendor?.tags &&
                    ingestion.ai_parsed.vendor.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ingestion.ai_parsed.vendor.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-md text-[10px] font-bold shadow-sm border border-slate-200 dark:border-slate-700"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                </div>
                <div className="flex flex-col gap-2 mt-0.5">
                  {hasMasks(ingestion.ai_parsed.vendor.name) ? (
                    <span className="text-[10px] text-amber-500 font-medium">
                      Name contains masks (please edit via form Vendor dropdown to add a clean vendor
                      name)
                    </span>
                  ) : (
                    <>
                      <div className="flex gap-2 items-center">
                        <select
                          value={suggestedVendorType}
                          onChange={(e) => setSuggestedVendorType(e.target.value as any)}
                          className="text-[10px] px-2 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                          aria-label="Suggested Vendor Type"
                        >
                          <option value="Business">Business</option>
                          <option value="Individual">Individual</option>
                        </select>
                        <input
                          value={suggestedVendorTags}
                          onChange={(e) => setSuggestedVendorTags(e.target.value)}
                          className="flex-1 text-[10px] px-1.5 py-1 rounded border border-blue-200 dark:border-blue-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-white"
                          placeholder="Tags (comma separated)"
                          aria-label="Suggested Vendor Tags"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={handleCreateVendor}
                        disabled={createVendorMutation.isPending}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors shadow-sm disabled:opacity-50 w-full"
                      >
                        {createVendorMutation.isPending ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            Creating...
                          </>
                        ) : (
                          <>
                            <Plus className="w-3.5 h-3.5" strokeWidth={2} /> Create Vendor
                          </>
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

          {/* Suggested Accounts */}
          <SuggestedAccountsPanel />

          {/* Re-run AI Classification Button */}
          <button
            type="button"
            onClick={() => {
              if (reclassifyMutation.isPending) {
                setIsDrawerOpen(true)
              } else {
                setConfirmReclassifyOpen(true)
              }
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs w-full focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none cursor-pointer"
          >
            {reclassifyMutation.isPending ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Thinking... (Click to view)
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                Re-run AI Classification
              </>
            )}
          </button>
        </div>
      )}
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

      {/* Selected Related Ingestion Details Preview Modal */}
      {selectedRelatedItem && (
        <div className="fixed inset-0 bg-black/60 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 rounded-t-2xl">
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-950 dark:text-white text-base">
                    Related {selectedRelatedItem.notification_type?.toUpperCase() || 'NOTIFICATION'}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    {dayjs(selectedRelatedItem.received_at).format('MMM DD, h:mm A')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                  ID: {selectedRelatedItem.id}
                </p>
              </div>
              <button 
                onClick={() => setSelectedRelatedItem(null)} 
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-3 text-sm">
              {/* Message / Summary */}
              <div className="p-3 bg-slate-50 dark:bg-slate-950/60 rounded-xl border border-slate-150 dark:border-slate-800/80">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Raw / Summary Content
                </span>
                <p className="text-slate-800 dark:text-slate-200 font-medium text-xs whitespace-pre-wrap leading-relaxed">
                  {selectedRelatedItem.ai_parsed?.summary || selectedRelatedItem.raw_msg}
                </p>
              </div>

              {/* Parsed Details Grid */}
              <div className="grid grid-cols-2 gap-2.5 p-3 bg-slate-50/50 dark:bg-slate-950/30 rounded-xl border border-slate-150 dark:border-slate-800/60 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Amount</span>
                  <span className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                    ₱{Number(selectedRelatedItem.ai_parsed?.amount ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Vendor</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {selectedRelatedItem.ai_parsed?.vendor?.name || 'Unassigned'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">From (Credit) Acc</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                    {getAccountName(selectedRelatedItem.ai_parsed?.credit_account_id)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">To (Debit) Acc</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200 truncate block">
                    {getAccountName(selectedRelatedItem.ai_parsed?.debit_account_id)}
                  </span>
                </div>
                {selectedRelatedItem.ai_parsed?.reference_number && (
                  <div className="col-span-2">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Ref Number</span>
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {selectedRelatedItem.ai_parsed.reference_number}
                    </span>
                  </div>
                )}
              </div>

              {/* AI Reasoning */}
              {selectedRelatedItem.ai_parsed?.why && (
                <div className="p-2.5 bg-indigo-50/70 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-900/40 text-xs">
                  <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider block mb-1">
                    AI Reasoning
                  </span>
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    {selectedRelatedItem.ai_parsed.why}
                  </p>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2 bg-slate-50/50 dark:bg-slate-900/50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => setSelectedRelatedItem(null)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

