import { useParams } from '@tanstack/react-router'
import { useGetTransactions } from '@/hooks/useTransactions'
import { useGetAccounts } from '@/hooks/useAccounts'
import CalendarView from '@/pages/CalendarView'
import dayjs from 'dayjs'

export default function TransactionsMonthly() {
  const { month } = useParams({ from: '/transactions/$month/monthly' })
  const currentMonth = dayjs(month, 'YYYY-MM')
  const startDate = currentMonth.format('YYYY-MM-DD')
  const endDate = currentMonth.add(1, 'month').startOf('month').format('YYYY-MM-DD')

  const { data: transactions = [], isLoading } = useGetTransactions(startDate, endDate)
  const { data: accounts = [] } = useGetAccounts()

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950">
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Monthly Transactions</h1>
        <p className="text-slate-500 mt-1 text-sm">{currentMonth.format('MMMM YYYY')}</p>
      </div>
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
