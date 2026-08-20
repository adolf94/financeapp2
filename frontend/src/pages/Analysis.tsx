import { useState, useMemo } from 'react'
import dayjs from 'dayjs'
import { useAnalysis } from '@/hooks/useAnalysis'
import { Link } from '@tanstack/react-router'
import { Loader2, TrendingUp, Target, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'

const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1', // indigo
  '#e11d48', // rose
  '#84cc16', // lime
  '#64748b', // slate
]

export default function Analysis() {
  const [selectedMonth, setSelectedMonth] = useState(dayjs())
  const { categoryGroupBreakdown, monthlyBarChartData, goalProgress, isLoading } = useAnalysis(selectedMonth)

  // Aggregate pie chart data by Category Group
  const pieChartData = useMemo(() => {
    if (!categoryGroupBreakdown || categoryGroupBreakdown.length === 0) return []
    const totalMonthSpending = categoryGroupBreakdown.reduce((sum, g) => sum + g.total, 0)
    
    // Take top 6 groups, group remainder as "Other"
    if (categoryGroupBreakdown.length <= 7) {
      return categoryGroupBreakdown.map((g, i) => ({
        name: g.name,
        value: g.total,
        percentage: totalMonthSpending > 0 ? (g.total / totalMonthSpending) * 100 : 0,
        color: PALETTE[i % PALETTE.length],
      }))
    }

    const topGroups = categoryGroupBreakdown.slice(0, 6)
    const otherGroups = categoryGroupBreakdown.slice(6)
    const otherTotal = otherGroups.reduce((sum, g) => sum + g.total, 0)

    const items = topGroups.map((g, i) => ({
      name: g.name,
      value: g.total,
      percentage: totalMonthSpending > 0 ? (g.total / totalMonthSpending) * 100 : 0,
      color: PALETTE[i % PALETTE.length],
    }))

    if (otherTotal > 0) {
      items.push({
        name: 'Other',
        value: otherTotal,
        percentage: totalMonthSpending > 0 ? (otherTotal / totalMonthSpending) * 100 : 0,
        color: PALETTE[items.length % PALETTE.length],
      })
    }

    return items
  }, [categoryGroupBreakdown])

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-6">
      <header className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Analysis</h1>
          <p className="text-slate-500 mt-1 text-sm">Insights and spending charts</p>
        </div>
        <div className="flex items-center gap-4 bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <button 
            onClick={() => setSelectedMonth(prev => prev.subtract(1, 'month'))}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            aria-label="Previous Month"
          >
            <ChevronLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
          <span className="font-semibold text-slate-900 dark:text-slate-50 min-w-[120px] text-center">
            {selectedMonth.format('MMMM YYYY')}
          </span>
          <button 
            onClick={() => setSelectedMonth(prev => prev.add(1, 'month'))}
            className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            aria-label="Next Month"
          >
            <ChevronRight className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </button>
        </div>
      </header>

      {/* Goal Tracking */}
      <section className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2 text-slate-900 dark:text-slate-50 font-semibold">
            <Target className="w-5 h-5 text-blue-500" />
            <h2>Savings Goal Progress</h2>
          </div>
          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">{goalProgress}%</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3 mb-2 overflow-hidden">
          <div className="bg-blue-500 h-3 rounded-full transition-all duration-500" style={{ width: `${goalProgress}%` }}></div>
        </div>
        <p className="text-xs text-slate-500">You are on track to hit your year-end savings goal!</p>
      </section>

      {/* Spending by Category Group Pie Chart */}
      <section className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-6">{selectedMonth.format('MMMM')} Spending</h2>
        {pieChartData.length === 0 ? (
           <p className="text-sm text-slate-500 text-center py-10">No expenses recorded this month.</p>
        ) : (
          <div className="flex flex-col items-center gap-8">
            {/* Chart Area */}
            <div className="h-80 w-full max-w-[340px] relative flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                  <Pie
                    data={pieChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={72}
                    outerRadius={108}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                     formatter={(value: any) => `₱${Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                     contentStyle={{
                       borderRadius: '12px',
                       background: 'rgba(15, 23, 42, 0.95)',
                       borderColor: '#334155',
                       color: '#f8fafc',
                       boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
                       fontSize: '13px',
                       zIndex: 50
                     }}
                     itemStyle={{ color: '#f8fafc' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total</span>
                <span className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                  ₱{pieChartData.reduce((acc, curr) => acc + curr.value, 0).toLocaleString('en-PH', { maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>

            {/* Structured Clean Legend */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
              {pieChartData.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0 ml-3">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100">
                      ₱{item.value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-xs font-medium text-slate-400 min-w-[36px] text-right">
                      {item.percentage.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Spending Breakdown List */}
      {categoryGroupBreakdown && categoryGroupBreakdown.length > 0 && (
        <section className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm animate-in fade-in slide-in-from-bottom-3 duration-200">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">Spending Breakdown</h2>
          <div className="flex flex-col gap-4">
            {categoryGroupBreakdown.map((group) => (
              <div key={group.id} className="border-b border-slate-100 dark:border-slate-800 pb-3 last:border-0 last:pb-0">
                <div className="flex justify-between items-center mb-2">
                  <Link 
                    to="/categories/$categoryId" 
                    params={{ categoryId: group.id }}
                    className="font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                  >
                    {group.name}
                  </Link>
                  <span className="font-bold text-slate-900 dark:text-slate-100">
                    ₱{group.total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="pl-4 flex flex-col gap-1.5 border-l border-slate-100 dark:border-slate-800 ml-1">
                  {group.subcategories.map((sub) => (
                    <div key={sub.id} className="flex justify-between items-center text-sm">
                      <Link
                        to="/accounts/$accountId"
                        params={{ accountId: sub.id }}
                        className="text-slate-500 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                      >
                        {sub.name}
                      </Link>
                      <span className="text-slate-600 dark:text-slate-400">
                        ₱{sub.total.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Income vs Expense Bar Chart */}
      <section className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2 mb-4 text-slate-900 dark:text-slate-50 font-semibold">
           <TrendingUp className="w-5 h-5 text-emerald-500" />
           <h2>Cash Flow (6 Months)</h2>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={monthlyBarChartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.2} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} tickFormatter={(value) => `₱${value/1000}k`} />
              <Tooltip 
                 formatter={(value: any) => `₱${Number(value).toLocaleString()}`}
                 contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                 cursor={{fill: 'transparent'}}
              />
              <Legend />
              <Bar dataKey="Income" fill="#10b981" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expense" fill="#f43f5e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

    </div>
  )
}
