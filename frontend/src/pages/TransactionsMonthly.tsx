import { useNavigate, useParams } from '@tanstack/react-router'
import { useGetTransactions } from '@/hooks/useTransactions'
import { useGetAccounts } from '@/hooks/useAccounts'
import CalendarView from '@/pages/CalendarView'
import TransactionsTabs from '@/components/TransactionsTabs'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import dayjs from 'dayjs'

export default function TransactionsMonthly() {
  const { month } = useParams({ from: '/transactions/$month/monthly' })
  const navigate = useNavigate()
  const currentMonth = dayjs(month, 'YYYY-MM')
  const startDate = currentMonth.format('YYYY-MM-DD')
  const endDate = currentMonth.add(1, 'month').startOf('month').format('YYYY-MM-DD')

  const goToMonth = (offset: number) => {
    navigate({
      to: '/transactions/$month/monthly',
      params: { month: currentMonth.add(offset, 'month').format('YYYY-MM') },
    })
  }

  const { data: transactions = [], isLoading } = useGetTransactions(startDate, endDate)
  const { data: accounts = [] } = useGetAccounts()

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Monthly Transactions</h1>
        <div className="flex items-center justify-between mt-1">
          <button
            onClick={() => goToMonth(-1)}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-slate-500 dark:text-slate-400 text-sm font-semibold min-w-[120px] text-center">
            {currentMonth.format('MMMM YYYY')}
          </span>
          <button
            onClick={() => goToMonth(1)}
            className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
      <TransactionsTabs active="monthly" month={currentMonth.format('YYYY-MM')} />
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading...</div>
        ) : (
          <CalendarView currentMonth={currentMonth} transactions={transactions} accounts={accounts} />
        )}
      </div>
    </div>
  )
}
