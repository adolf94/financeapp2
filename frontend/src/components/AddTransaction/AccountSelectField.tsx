import { useMemo } from 'react'
import { Account, AccountGroup } from '@/hooks/useAccounts'
import Combobox from '@/components/ui/Combobox'

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

  const currentBalance = selectedAccount?.currentBalance ?? selectedAccount?.startingBalance

  const options = useMemo(() => {
    const groupNames = new Map(accountGroups.map((g) => [g.id, g.name]))
    return filteredAccounts
      .map((a) => ({
        value: a.id ?? '',
        label: a.name,
        group: groupNames.get(a.accountGroupId) || 'Other',
      }))
      .sort(
        (a, b) =>
          a.group.localeCompare(b.group) || a.label.localeCompare(b.label)
      )
  }, [filteredAccounts, accountGroups])

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {label}
          {required && <span className="text-rose-500"> *</span>}
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

      {/* Combobox instead of a native <select>: the browser popup can flash
          open/closed on mousedown; the styled dropdown selects only on a
          full click (mousedown + mouseup on the same option). */}
      <Combobox
        id={id}
        options={options}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  )
}
