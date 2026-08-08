import { X } from 'lucide-react'

interface ConfirmationModalProps {
  isOpen: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  confirmVariant?: 'danger' | 'primary'
}

export default function ConfirmationModal({
  isOpen,
  title = 'Confirm Action',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  confirmVariant = 'danger'
}: ConfirmationModalProps) {
  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        className="fixed inset-0 bg-black/60 z-50 transition-opacity duration-200 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-sm bg-white dark:bg-slate-900 rounded-2xl z-55 shadow-2xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden"
        style={{ animation: 'scaleUp 0.15s cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        <div className="flex justify-between items-center px-5 pt-4 pb-2">
          <h2 id="confirm-modal-title" className="text-base font-bold text-slate-900 dark:text-slate-50">
            {title}
          </h2>
          <button
            onClick={onCancel}
            className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-2 text-sm text-slate-600 dark:text-slate-300">
          {message}
        </div>

        <div className="flex gap-2 p-4 pt-4 bg-slate-50 dark:bg-slate-900/50 justify-end border-t border-slate-100 dark:border-slate-800 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-xs font-semibold text-white rounded-lg transition-colors cursor-pointer ${
              confirmVariant === 'danger'
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
