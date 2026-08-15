import { useAddTransaction } from './AddTransactionContext'
import { uuidv7 } from 'uuidv7'

export default function TransactionTypeTabs() {
  const { mode, type, setType, setSplits, setToAccountId } = useAddTransaction()

  if (mode !== 'Simple') return null

  return (
    <div className="grid grid-cols-3 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl gap-1">
      {(['Expense', 'Income', 'Transfer'] as const).map((t) => {
        const isActive = type === t
        let activeStyle = 'bg-white dark:bg-slate-700 text-rose-600 dark:text-rose-400 font-bold shadow-xs'
        if (t === 'Income') activeStyle = 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 font-bold shadow-xs'
        if (t === 'Transfer') activeStyle = 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 font-bold shadow-xs'

        return (
          <button
            key={t}
            type="button"
            onClick={() => {
              setType(t)
              setSplits([{ id: uuidv7(), categoryId: '', subCategoryId: '', amount: '' }])
              if (t !== 'Transfer') setToAccountId('')
            }}
            className={`py-2 rounded-lg text-xs sm:text-sm transition-all cursor-pointer ${
              isActive
                ? activeStyle
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
            }`}
          >
            {t}
          </button>
        )
      })}
    </div>
  )
}

