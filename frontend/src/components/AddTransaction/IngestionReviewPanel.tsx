import { RotateCcw, Sparkles, Plus } from 'lucide-react'
import { useAddTransaction } from './AddTransactionContext'
import { useUpdateIngestionVendor, PendingIngestion } from '@/hooks/useIngestions'
import { useGetVendors, useCreateVendor } from '@/hooks/useVendors'
import SuggestedAccountsPanel from './SuggestedAccountsPanel'

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
    isReviewOpen,
    setIsReviewOpen,
    setConfirmReclassifyOpen,
    setVendor,
    suggestedVendorType,
    setSuggestedVendorType,
    suggestedVendorTags,
    setSuggestedVendorTags,
    reclassifyMutation,
  } = useAddTransaction()

  const { data: dbVendors = [] } = useGetVendors()
  
  const createVendorMutation = useCreateVendor()
  const updateIngestionVendorMutation = useUpdateIngestionVendor()

  if (!ingestion) return null

  const handleCreateVendor = () => {
    const tags = suggestedVendorTags
      ? suggestedVendorTags.split(',').map((t) => t.trim()).filter(Boolean)
      : []
    createVendorMutation.mutate(
      { name: ingestion.ai_parsed.vendor!, type: suggestedVendorType, tags },
      {
        onSuccess: () => {
          setVendor(ingestion.ai_parsed.vendor!)
          updateIngestionVendorMutation.mutate({
            id: ingestion.id,
            vendor: ingestion.ai_parsed.vendor!,
          })
        },
      }
    )
  }

  return (
    <div className="md:col-span-5 flex flex-col gap-3 md:sticky md:top-0 bg-slate-100 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex justify-between items-center w-full font-bold text-slate-800 dark:text-slate-250 uppercase tracking-wider text-[11px]">
        <span>Notification Review</span>
        <button
          type="button"
          onClick={() => setIsReviewOpen(!isReviewOpen)}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-bold cursor-pointer normal-case text-[11px]"
          aria-expanded={isReviewOpen}
        >
          {isReviewOpen ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {isReviewOpen && (
        <div className="flex flex-col gap-2.5 animate-in fade-in slide-in-from-top-1">
           <button
            type="button"
            onClick={() => setConfirmReclassifyOpen(true)}
            disabled={reclassifyMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors shadow-sm disabled:opacity-50 w-full focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
          >
            {reclassifyMutation.isPending ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Reclassifying...
              </>
            ) : (
              <>
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                Re-run AI Classification
              </>
            )}
          </button>

          <div className="p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl">
            <span className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              Raw Msg
            </span>
            <p className="text-slate-800 dark:text-slate-250 italic mt-0.5 font-semibold text-xs leading-snug">
              "{ingestion.raw_msg}"
            </p>
          </div>

          {/* Sender / Recipient / App metadata if present */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
            <div>
              <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Source App
              </span>
              <p className="text-slate-800 dark:text-slate-250 font-bold text-xs mt-0.5 truncate">
                {getIngestionAppName(ingestion)}
              </p>
            </div>
            {(ingestion.ai_parsed.sender_account_name || ingestion.ai_parsed.sender_account_number) && (
              <div>
                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Sender Acc
                </span>
                <p className="text-slate-800 dark:text-slate-250 font-bold text-xs mt-0.5 truncate">
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
                <p className="text-slate-800 dark:text-slate-250 font-bold text-xs mt-0.5 truncate">
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
                <p className="text-slate-800 dark:text-slate-250 font-bold text-xs mt-0.5 truncate">
                  {ingestion.ai_parsed.recipient_account_name || 'N/A'}
                  {ingestion.ai_parsed.recipient_account_number
                    ? ` (${ingestion.ai_parsed.recipient_account_number})`
                    : ''}
                </p>
              </div>
            )}
          </div>

          {ingestion.ai_parsed.vendor &&
            ingestionId &&
            !ingestion.ai_parsed.vendor_matched &&
            !dbVendors.some(
              (v) => v.name.toLowerCase() === ingestion.ai_parsed.vendor?.toLowerCase()
            ) && (
              <div
                key={`${ingestion.id}-suggested-vendor`}
                className="flex flex-col gap-2.5 p-3 bg-blue-50 dark:bg-blue-900/40 border border-blue-200 dark:border-blue-800/60 rounded-xl"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-blue-600 dark:text-blue-400 uppercase tracking-wider font-bold text-[9px] flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" strokeWidth={2} /> Suggested Vendor
                  </span>
                  <span className="text-slate-800 dark:text-slate-250 font-bold text-xs flex items-center gap-1.5 flex-wrap">
                    {ingestion.ai_parsed.vendor}
                    {ingestion.ai_parsed.suggested_vendor?.type === 'Individual' && (
                      <span className="text-[10px] text-slate-500 font-bold" title="Individual">
                        (I)
                      </span>
                    )}
                    {ingestion.ai_parsed.suggested_vendor?.type === 'Business' && (
                      <span className="text-[10px] text-slate-500 font-bold" title="Business">
                        (B)
                      </span>
                    )}
                  </span>
                  {ingestion.ai_parsed.suggested_vendor?.tags &&
                    ingestion.ai_parsed.suggested_vendor.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {ingestion.ai_parsed.suggested_vendor.tags.map((tag) => (
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
                  {hasMasks(ingestion.ai_parsed.vendor) ? (
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

          <SuggestedAccountsPanel />

          {ingestion.ai_parsed.why && (
            <div className="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 rounded-xl mt-1">
              <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                AI Reasoning
              </span>
              <p className="text-slate-800 dark:text-slate-250 mt-0.5 leading-snug text-xs font-medium">
                {ingestion.ai_parsed.why}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
