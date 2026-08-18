import { useState } from 'react'
import { uuidv7 } from 'uuidv7'
import { UseMutationResult } from '@tanstack/react-query'
import ConfirmationModal from '@/components/ui/ConfirmationModal'
import { Account } from '@/hooks/useAccounts'
import { PendingIngestion } from '@/hooks/useIngestions'
import { JournalLine, SplitLine } from './AddTransactionContext'

interface ReclassifyConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  ingestion: PendingIngestion | null
  mode: 'Simple' | 'Advanced'
  type: string
  vendor: string
  sourceAccountId: string
  toAccountId: string
  splits: SplitLine[]
  journalLines: JournalLine[]
  accounts: Account[]
  reclassifyMutation: UseMutationResult<any, any, any, any>
  setCurrentOperationId: (id: string) => void
}

export default function ReclassifyConfirmModal({
  isOpen,
  onClose,
  ingestion,
  mode,
  type,
  vendor,
  sourceAccountId,
  toAccountId,
  splits,
  journalLines,
  accounts,
  reclassifyMutation,
  setCurrentOperationId,
}: ReclassifyConfirmModalProps) {
  const [reclassifyComment, setReclassifyComment] = useState('')
  const [streamReasoning, setStreamReasoning] = useState(false)

  if (!isOpen || !ingestion) return null

  const debitAccId =
    mode === 'Advanced'
      ? journalLines.find((l) => l.type === 'Debit')?.subCategoryId || null
      : type === 'Transfer'
      ? toAccountId || null
      : type === 'Income'
      ? sourceAccountId || null
      : splits[0]?.subCategoryId || null

  const creditAccId =
    mode === 'Advanced'
      ? journalLines.find((l) => l.type === 'Credit')?.subCategoryId || null
      : type === 'Transfer'
      ? sourceAccountId || null
      : type === 'Income'
      ? splits[0]?.subCategoryId || null
      : sourceAccountId || null

  const debitAccName = accounts.find((a) => a.id === debitAccId)?.name || (debitAccId ? 'Selected' : 'None')
  const creditAccName = accounts.find((a) => a.id === creditAccId)?.name || (creditAccId ? 'Selected' : 'None')

  const commentText = reclassifyComment.trim()
  const hasComment = Boolean(commentText)

  const corrections = hasComment ? {
    comment: commentText,
    type,
    vendor: vendor.trim() || undefined,
    debit_account_id: debitAccId,
    credit_account_id: creditAccId,
  } : undefined

  return (
    <ConfirmationModal
      isOpen={isOpen}
      title="Re-run AI Classification"
      confirmLabel="Reclassify"
      confirmVariant="primary"
      onConfirm={() => {
        onClose()
        const opId = uuidv7()
        setCurrentOperationId(opId)

        reclassifyMutation.mutate({
          id: ingestion.id,
          operationId: opId,
          streamReasoning,
          userCorrections: corrections,
        })
        setReclassifyComment('')
      }}
      onCancel={() => {
        onClose()
        setReclassifyComment('')
      }}
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Re-run AI classification on this ingestion.{hasComment ? ' The AI will use your instructions and current values as context to refine suggestions and propose a runbook rule.' : ''}
        </p>

        {/* Current values context preview if comment is provided */}
        {hasComment && (
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs flex flex-col gap-1.5">
            <span className="font-bold text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Values Being Sent to AI:
            </span>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-700 dark:text-slate-300">
              <div className="col-span-2">
                <span className="text-slate-400">Instruction:</span> <span className="font-semibold italic">"{commentText}"</span>
              </div>
              <div>
                <span className="text-slate-400">Type:</span> <span className="font-semibold">{type}</span>
              </div>
              <div>
                <span className="text-slate-400">Vendor:</span> <span className="font-semibold">{vendor || '(None)'}</span>
              </div>
              <div>
                <span className="text-slate-400">Debit (Dr / To):</span> <span className="font-semibold truncate">{debitAccName}</span>
              </div>
              <div>
                <span className="text-slate-400">Credit (Cr / From):</span> <span className="font-semibold truncate">{creditAccName}</span>
              </div>
            </div>
          </div>
        )}

        {/* Optional comments/instructions textarea */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="reclassify-comment-input"
            className="text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            Optional Comments / Instructions for AI
          </label>
          <textarea
            id="reclassify-comment-input"
            rows={3}
            value={reclassifyComment}
            onChange={(e) => setReclassifyComment(e.target.value)}
            placeholder="e.g. Treat this as a Food & Dining expense, and suggest a runbook rule for GrabFood..."
            className="p-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
          />
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800/50 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/50 cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors">
          <input
            type="checkbox"
            checked={streamReasoning}
            onChange={(e) => setStreamReasoning(e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 dark:border-slate-600 dark:bg-slate-700"
          />
          <div className="flex flex-col">
            <span className="font-semibold text-xs text-slate-900 dark:text-slate-50">Stream AI Reasoning</span>
          </div>
        </label>
      </div>
    </ConfirmationModal>
  )
}
