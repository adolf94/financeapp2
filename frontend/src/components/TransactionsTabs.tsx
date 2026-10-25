import { Link } from '@tanstack/react-router'
import { CalendarDays, List, RotateCw } from 'lucide-react'
import dayjs from 'dayjs'

export type TransactionsTabId = 'daily' | 'monthly' | 'scheduled'

const baseClass =
  'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wide transition-all cursor-pointer'
const activeClass = 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
const inactiveClass =
  'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'

interface TransactionsTabsProps {
  active: TransactionsTabId
  /** Selected month in `YYYY-MM`; preserved when switching between Daily and Monthly. */
  month?: string
}

export default function TransactionsTabs({ active, month }: TransactionsTabsProps) {
  const selectedMonth = month ?? dayjs().format('YYYY-MM')

  return (
    <div className="flex bg-slate-100 dark:bg-slate-800/60 p-1 mx-3 mt-3 rounded-xl gap-1 shrink-0">
      <Link
        to="/transactions/$month/daily"
        params={{ month: selectedMonth }}
        className={`${baseClass} ${active === 'daily' ? activeClass : inactiveClass}`}
      >
        <List className="w-4 h-4" /> Daily
      </Link>
      <Link
        to="/transactions/$month/monthly"
        params={{ month: selectedMonth }}
        className={`${baseClass} ${active === 'monthly' ? activeClass : inactiveClass}`}
      >
        <CalendarDays className="w-4 h-4" /> Monthly
      </Link>
      <Link
        to="/transactions/recurring"
        className={`${baseClass} ${active === 'scheduled' ? activeClass : inactiveClass}`}
      >
        <RotateCw className="w-4 h-4" /> Scheduled
      </Link>
    </div>
  )
}
