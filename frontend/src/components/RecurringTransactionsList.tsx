import { useState } from 'react'
import { useGetRecurringTransactions, useDeleteRecurringTransaction } from '@/hooks/useRecurringTransactions'
import { Plus, Trash2, CalendarDays, ArrowRightLeft, ArrowUpRight, ArrowDownRight, RotateCw, Pencil } from 'lucide-react'
import dayjs from 'dayjs'
import AddTransactionModal from './AddTransactionModal'
import ConfirmationModal from './ui/ConfirmationModal'
import RecurringTransactionModal from './RecurringTransactionModal'
import { RecurringTransaction } from '@/hooks/useRecurringTransactions'

export default function RecurringTransactionsList() {
  const { data: recurringTransactions = [], isLoading } = useGetRecurringTransactions()
  const deleteMutation = useDeleteRecurringTransaction()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null)
  const [editCandidate, setEditCandidate] = useState<RecurringTransaction | null>(null)

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'Income': return <ArrowDownRight className="w-5 h-5 text-emerald-500" />
      case 'Expense': return <ArrowUpRight className="w-5 h-5 text-rose-500" />
      case 'Transfer': return <ArrowRightLeft className="w-5 h-5 text-blue-500" />
      default: return <ArrowRightLeft className="w-5 h-5 text-slate-500" />
    }
  }

  const getExpectedEndDate = (tx: any) => {
    if (tx.endDate) return dayjs(tx.endDate).format('MMM D, YYYY')
    if (!tx.maxOccurrences) return 'Indefinite'
    
    let date = dayjs(tx.startDate)
    const units = tx.maxOccurrences - 1
    if (units > 0) {
      if (tx.frequency === 'Daily') date = date.add(units, 'day')
      else if (tx.frequency === 'Weekly') date = date.add(units, 'week')
      else if (tx.frequency === 'Monthly') date = date.add(units, 'month')
      else if (tx.frequency === 'Yearly') date = date.add(units, 'year')
    }
    return date.format('MMM D, YYYY')
  }

  if (isLoading) {
    return <div className="p-4 text-center text-slate-500">Loading recurring transactions...</div>
  }

  return (
    <div className="p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <RotateCw className="w-5 h-5 text-blue-600" />
          Recurring Schedules
        </h2>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {recurringTransactions.length === 0 ? (
        <div className="text-center py-10 bg-slate-100 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 border-dashed">
          <CalendarDays className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-3" strokeWidth={1} />
          <p className="text-slate-500 font-medium">No recurring transactions yet</p>
          <p className="text-sm text-slate-400 mt-1">Set up automated entries</p>
        </div>
      ) : (
        <div className="space-y-3">
          {recurringTransactions.map(tx => (
            <div key={tx.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
              <div 
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                onClick={() => setExpandedId(expandedId === tx.id ? null : (tx.id ?? null))}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                    {getTypeIcon(tx.templateType)}
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{tx.templateNote || 'Untitled'}</div>
                    <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                      <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider">
                        {tx.frequency}
                      </span>
                      <span>• Next: {dayjs(tx.nextOccurrenceDate).format('MMM D, YYYY')}</span>
                      <span>• Ends: {getExpectedEndDate(tx)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      tx.templateType === 'Income'
                        ? 'text-emerald-500'
                        : tx.templateType === 'Expense'
                        ? 'text-rose-500'
                        : tx.templateType === 'Journal'
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {tx.templateType === 'Income' ? '+' : tx.templateType === 'Expense' ? '-' : ''}₱
                    {(
                      (tx.templateEntries ?? []).filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0) ||
                      (tx.templateEntries ?? []).reduce((sum, e) => sum + Math.abs(e.amount), 0) / 2
                    ).toFixed(2)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditCandidate(tx)
                    }}
                    className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-full transition-colors"
                    title="Edit schedule"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (tx.id) setDeleteCandidate(tx.id)
                    }}
                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-full transition-colors"
                    title="Delete schedule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              {/* Expandable visualization of occurrences */}
              {expandedId === tx.id && (
                <div className="bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 p-4">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Generation History</h4>
                  {tx.occurrences && tx.occurrences.length > 0 ? (
                    <div className="space-y-2">
                      {tx.occurrences.map((occ, idx) => (
                        <div key={idx} className="flex justify-between items-center text-sm">
                          <span className="text-slate-600 dark:text-slate-400">
                            #{occ.occurrenceNo} - {dayjs(occ.date).format('MMM D, YYYY')}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            occ.status === 'Processed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                            occ.status === 'Pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                          }`}>
                            {occ.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500 italic">No transactions generated yet.</div>
                  )}
                  
                  {tx.maxOccurrences && (
                    <div className="mt-3 text-xs text-slate-500">
                      Progress: {tx.occurrences?.length || 0} / {tx.maxOccurrences} completed
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AddTransactionModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {editCandidate && (
        <RecurringTransactionModal
          isOpen={!!editCandidate}
          onClose={() => setEditCandidate(null)}
          recurringTx={editCandidate}
        />
      )}

      <ConfirmationModal
        isOpen={!!deleteCandidate}
        title="Delete Recurring Schedule"
        message="This will stop future automatic transaction generation. All previously created transactions are kept and won't be affected."
        onConfirm={() => {
          if (deleteCandidate) {
            deleteMutation.mutate(deleteCandidate)
            setDeleteCandidate(null)
          }
        }}
        onCancel={() => setDeleteCandidate(null)}
      />
    </div>
  )
}


