import { useMemo } from 'react'
import { Account, AccountGroup } from '@/hooks/useAccounts'

interface AccountSelectFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  accounts: Account[]
  accountGroups: AccountGroup[]
  placeholder?: string
  required?: boolean
  excludeAccountId?: string
  className?: string
}

export default function AccountSelectField({
  id,
  label,
  value,
  onChange,
  accounts,
  accountGroups,
  placeholder = 'Select Account...',
  required = false,
  excludeAccountId,
  className = '',
}: AccountSelectFieldProps) {
  const filteredAccounts = useMemo(() => {
    return excludeAccountId ? accounts.filter((a) => a.id !== excludeAccountId) : accounts
  }, [accounts, excludeAccountId])

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === value)
  }, [accounts, value])

  const groupIds = useMemo(() => {
    return Array.from(new Set(filteredAccounts.map((a) => a.accountGroupId))).sort((a, b) => {
      const gA = accountGroups.find((g) => g.id === a)?.name || ''
      const gB = accountGroups.find((g) => g.id === b)?.name || ''
      return gA.localeCompare(gB)
    })
  }, [filteredAccounts, accountGroups])

  const currentBalance = selectedAccount?.currentBalance ?? selectedAccount?.startingBalance

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {label}
        </label>
        {selectedAccount && currentBalance !== undefined && (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Bal:{' '}
            <span
              className={`font-semibold ${
                currentBalance < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-700 dark:text-slate-300'
              }`}
            >
              ₱{currentBalance.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
        )}
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
      >
        <option value="">{placeholder}</option>
        {groupIds.map((groupId) => {
          const group = accountGroups.find((g) => g.id === groupId)
          const groupAccounts = filteredAccounts.filter((a) => a.accountGroupId === groupId)
          if (!group || groupAccounts.length === 0) return null
          return (
            <optgroup key={group.id} label={group.name}>
              {groupAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          )
        })}
      </select>
    </div>
  )
}
