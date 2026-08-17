import { X, Mail, MessageSquare, Bell, Image as ImageIcon } from 'lucide-react'
import dayjs from 'dayjs'
import { useGetIngestionById } from '@/hooks/useIngestions'
import AuthenticatedReceiptImage from '@/components/AuthenticatedReceiptImage'

interface IngestionPreviewModalProps {
  ingestionId: string
  onClose: () => void
}

export default function IngestionPreviewModal({ ingestionId, onClose }: IngestionPreviewModalProps) {
  const { data: ingestion, isLoading } = useGetIngestionById(ingestionId)

  const getTypeIcon = (type?: string) => {
    switch (type) {
      case 'sms':
        return <MessageSquare className="w-3.5 h-3.5 text-cyan-500" />
      case 'email':
        return <Mail className="w-3.5 h-3.5 text-emerald-500" />
      case 'receipt':
        return <ImageIcon className="w-3.5 h-3.5 text-amber-500" />
      default:
        return <Bell className="w-3.5 h-3.5 text-indigo-500" />
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <div className="flex items-center gap-2">
            {getTypeIcon(ingestion?.notification_type)}
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <span>Merged Notification</span>
                {ingestion?.status && (
                  <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {ingestion.status}
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                ID: {ingestionId}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto space-y-4 text-sm">
          {isLoading ? (
            <div className="space-y-3 py-4">
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-3/4" />
              <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-1/2" />
              <div className="h-16 bg-slate-200 dark:bg-slate-800 rounded animate-pulse" />
            </div>
          ) : !ingestion ? (
            <div className="py-6 text-center text-slate-400">
              Notification details not found or expired.
            </div>
          ) : (
            <>
              {/* Image preview if receipt */}
              {ingestion.notification_type === 'receipt' && (
                <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-950/40 max-h-56 flex items-center justify-center">
                  <AuthenticatedReceiptImage
                    ingestionId={ingestion.id}
                    className="max-h-56 w-full object-contain"
                  />
                </div>
              )}

              {/* Summary / Extracted fields */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Amount
                  </span>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    {ingestion.ai_parsed?.amount != null
                      ? `₱${Number(ingestion.ai_parsed.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Vendor
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {ingestion.ai_parsed?.vendor?.name || 'Unassigned'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Received Time
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {dayjs(ingestion.received_at).format('MMM DD, YYYY h:mm A')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Reference Number
                  </span>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                    {ingestion.ai_parsed?.reference_number || 'N/A'}
                  </span>
                </div>
              </div>

              {/* AI Summary / Notes */}
              {ingestion.ai_parsed?.summary && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    AI Summary
                  </span>
                  <p className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/30 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800 leading-relaxed">
                    {ingestion.ai_parsed.summary}
                  </p>
                </div>
              )}

              {/* Raw Message */}
              {ingestion.raw_msg && (
                <div>
                  <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                    Raw Message
                  </span>
                  <p className="text-xs font-mono text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 p-2.5 rounded-lg border border-slate-150 dark:border-slate-800/80 whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
                    {ingestion.raw_msg}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
