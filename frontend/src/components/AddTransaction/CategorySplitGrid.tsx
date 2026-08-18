import { Account, AccountGroup } from '@/hooks/useAccounts'
import Combobox from '@/components/ui/Combobox'
import { SplitLine, PendingNewAccountType } from './AddTransactionContext'

interface CategorySplitGridProps {
  splits: SplitLine[]
  categoryGroups: AccountGroup[]
  accounts: Account[]
  accountGroups: AccountGroup[]
  onUpdateSplit: (id: string, updates: Partial<SplitLine>) => void
  onPendingNewAccount: (acc: PendingNewAccountType) => void
}

export default function CategorySplitGrid({
  splits,
  categoryGroups,
  accounts,
  accountGroups,
  onUpdateSplit,
  onPendingNewAccount,
}: CategorySplitGridProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between items-center">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Category & Subcategory
        </label>
      </div>

      {splits.map((split) => {
        const subCategoryOptions = accounts
          .filter((a) => a.accountGroupId === split.categoryId)
          .sort((a, b) => a.name.localeCompare(b.name))
        return (
          <div key={split.id} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Combobox
              options={categoryGroups.map((g) => ({ value: g.id, label: g.name }))}
              value={split.categoryId}
              onChange={(val) => onUpdateSplit(split.id, { categoryId: val })}
              placeholder="Select Category..."
              className="w-full"
            />

            <Combobox
              options={subCategoryOptions.map((a) => ({
                value: a.id!,
                label: a.name,
              }))}
              value={split.subCategoryId}
              onChange={(val) => onUpdateSplit(split.id, { subCategoryId: val })}
              placeholder="Select Sub-Category..."
              className="w-full"
              disabled={!split.categoryId}
              onCreate={(val) => {
                const group = accountGroups.find((g) => g.id === split.categoryId)
                onPendingNewAccount({
                  name: val,
                  categoryId: split.categoryId,
                  type: group?.accountType || 'Expense',
                  splitId: split.id,
                  description: '',
                  tags: [],
                })
              }}
            />
          </div>
        )
      })}
    </div>
  )
}
