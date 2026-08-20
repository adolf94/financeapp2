import { useState } from 'react'
import { PhoneHookMessage, useRetryPhoneHook, useDismissPhoneHook, PendingIngestion } from '@/hooks/useIngestions'
import { AlertCircle, RefreshCw, X, Calendar, MessageSquare, Mail, Image as ImageIcon, Bell } from 'lucide-react'
import dayjs from 'dayjs'

interface ErrorNotificationsListProps {
  phoneHooks: PhoneHookMessage[]
  errorIngestions?: PendingIngestion[]
  onRetryComplete?: () => void
}

export default function ErrorNotificationsList({
  phoneHooks,
  errorIngestions = [],
  onRetryComplete
}: ErrorNotificationsListProps) {
  const retryMutation = useRetryPhoneHook()
  const dismissMutation = useDismissPhoneHook()
  const [processingIds, setProcessingIds] = useState<string[]>([])

  const handleRetry = (hookId: string) => {
    setProcessingIds(prev => [...prev, hookId])
    retryMutation.mutate(hookId, {
      onSettled: () => {
        setProcessingIds(prev => prev.filter(id => id !== hookId))
        onRetryComplete?.()
      }
    })
  }

  const handleDismiss = (hookId: string) => {
    if (!confirm('Are you sure you want to dismiss this errored notification?')) return
    setProcessingIds(prev => [...prev, hookId])
    dismissMutation.mutate(hookId, {
      onSettled: () => {
        setProcessingIds(prev => prev.filter(id => id !== hookId))
        onRetryComplete?.()
      }
    })
  }

  const totalErrors = phoneHooks.length + errorIngestions.length

  if (totalErrors === 0) {
    return (
      <div className="p-8 text-center text-slate-400 italic">
        No errored notifications found. Everything is healthy!
      </div>
    )
  }

  return (
    <div className="mx-3 mt-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 px-1">
        <AlertCircle className="w-4 h-4 text-rose-500 animate-pulse" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
          Failed Ingestions & Hooks ({totalErrors})
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {/* PhoneHook Errors */}
        {phoneHooks.map((hook) => {
          const notifType = hook.notification_type || (hook.action?.includes('sms') ? 'sms' : hook.action?.includes('email') ? 'email' : hook.action?.includes('image') ? 'image' : 'app')
          const isProcessing = processingIds.includes(hook.id)
          const errorDetail = hook.processing_metadata?.error || hook.raw_payload?.error || 'Classification failed during processing'

          return (
            <div
              key={hook.id}
              className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-4 flex flex-col gap-3 shadow-sm relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />

              <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {dayjs(hook.received_at).format('MMM DD, YYYY • h:mm A')}
                    </span>
                    {notifType === 'sms' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-700/50">
                        <MessageSquare className="w-2.5 h-2.5" />
                        SMS
                      </span>
                    )}
                    {notifType === 'email' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50">
                        <Mail className="w-2.5 h-2.5" />
                        Email
                      </span>
                    )}
                    {notifType === 'image' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-700/50">
                        <ImageIcon className="w-2.5 h-2.5" />
                        Receipt Image
                      </span>
                    )}
                    {notifType === 'app' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700/50">
                        <Bell className="w-2.5 h-2.5" />
                        App
                      </span>
                    )}
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800">
                      Status: Error
                    </span>
                  </div>

                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 mt-1 line-clamp-3">
                    "{hook.raw_msg}"
                  </p>

                  <div className="mt-1 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/40 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <span className="break-all font-mono">{String(errorDetail)}</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-end items-center border-t border-slate-100 dark:border-slate-800/80 pt-3">
                <button
                  type="button"
                  onClick={() => handleDismiss(hook.id)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 dark:hover:bg-rose-900/30 dark:hover:text-rose-400 dark:hover:border-rose-800 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 text-sm font-medium"
                >
                  <X className="w-4 h-4" />
                  Dismiss
                </button>

                <button
                  type="button"
                  onClick={() => handleRetry(hook.id)}
                  disabled={isProcessing}
                  className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5 text-sm font-medium"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                  <span>{isProcessing ? 'Retrying...' : 'Retry Processing'}</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
