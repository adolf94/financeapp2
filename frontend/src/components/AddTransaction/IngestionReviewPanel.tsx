import { useState } from 'react'
import { RotateCcw, Sparkles, Plus, X, Mail, MessageSquare, Bell } from 'lucide-react'
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
    setIsDrawerOpen,
  } = useAddTransaction()

  const { data: dbVendors = [] } = useGetVendors()
  
  const createVendorMutation = useCreateVendor()
  const updateIngestionVendorMutation = useUpdateIngestionVendor()


  const [isPreviewOpen, setIsPreviewOpen] = useState(false)

  if (!ingestion) return null

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

  return (
    <div className="md:col-span-5 flex flex-col gap-3 md:sticky md:top-0 bg-slate-100 dark:bg-slate-800/60 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex justify-between items-center w-full font-bold text-slate-800 dark:text-slate-250 uppercase tracking-wider text-[11px]">
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
        </div>
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
            onClick={() => {
              if (reclassifyMutation.isPending) {
                setIsDrawerOpen(true)
              } else {
                setConfirmReclassifyOpen(true)
              }
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1 transition-colors shadow-sm w-full focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
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


          {ingestion.notification_type === 'email' ? (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex flex-col gap-2 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                  Email Summary
                </span>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(true)}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 transition-colors shadow-sm cursor-pointer"
                >
                  <Mail className="w-3 h-3" />
                  Preview Email
                </button>
              </div>
              <p className="text-slate-800 dark:text-slate-250 italic font-semibold text-xs leading-snug">
                "{ingestion.ai_parsed.summary || ingestion.ai_parsed.notes || ingestion.raw_msg}"
              </p>
            </div>
          ) : ingestion.notification_type === 'sms' ? (
            <div className="p-3 bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-800/60 rounded-xl flex flex-col gap-1.5 shadow-sm">
              <span className="text-[9px] font-bold text-cyan-600 dark:text-cyan-400 uppercase tracking-wider">
                SMS Message
              </span>
              <p className="text-slate-800 dark:text-slate-250 italic font-semibold text-xs leading-snug">
                "{ingestion.raw_msg}"
              </p>
            </div>
          ) : (
            <div className="p-3 bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/60 rounded-xl flex flex-col gap-1.5 shadow-sm">
              <span className="text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                App Notification
              </span>
              <p className="text-slate-800 dark:text-slate-250 italic font-semibold text-xs leading-snug">
                "{ingestion.raw_msg}"
              </p>
            </div>
          )}

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
                  <span className="text-slate-800 dark:text-slate-250 font-bold text-xs flex items-center gap-1.5 flex-wrap">
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
      {isPreviewOpen && (
        <div className="fixed inset-0 bg-black/60 z-55 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 animate-scale-up">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900/50 rounded-t-2xl">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="font-bold text-slate-950 dark:text-white text-base truncate">
                  {ingestion.raw_payload?.subject || ingestion.raw_payload?.Subject || ingestion.raw_payload?.notif_title || 'Email Preview'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">
                  From: {ingestion.raw_payload?.from || ingestion.raw_payload?.From || ingestion.raw_payload?.sender || 'Unknown'}
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
              {(() => {
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
    </div>
  )
}
