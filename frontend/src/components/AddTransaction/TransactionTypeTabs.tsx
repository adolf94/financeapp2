import { useAddTransaction } from './AddTransactionContext'
import { uuidv7 } from 'uuidv7'

export default function TransactionTypeTabs() {
  const { mode, setMode, type, setType, setSplits, setToAccountId } = useAddTransaction()

  return (
    <div className="flex flex-col gap-4">
      {/* Mode Toggle (Simple / Advanced) */}
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
        <button
          type="button"
          onClick={() => setMode('Simple')}
          className={`flex-1 py-1.5 rounded-lg font-semibold text-xs uppercase tracking-wide transition-all cursor-pointer ${
            mode === 'Simple'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Simple
        </button>
        <button
          type="button"
          onClick={() => setMode('Advanced')}
          className={`flex-1 py-1.5 rounded-lg font-semibold text-xs uppercase tracking-wide transition-all cursor-pointer ${
            mode === 'Advanced'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
              : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Advanced
        </button>
      </div>

      {mode === 'Simple' && (
        <div className="grid grid-cols-3 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {(['Expense', 'Income', 'Transfer'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t)
                setSplits([{ id: uuidv7(), categoryId: '', subCategoryId: '', amount: '' }])
                if (t !== 'Transfer') setToAccountId('')
              }}
              className={`py-2 rounded-lg font-medium text-sm transition-all cursor-pointer ${
                type === t
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-50 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
