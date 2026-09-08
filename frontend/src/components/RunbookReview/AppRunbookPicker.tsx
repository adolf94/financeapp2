import { Smartphone } from 'lucide-react'

export interface AppRunbookOption {
  packageId: string
  label?: string
  configured: boolean
}

interface AppRunbookPickerProps {
  selectedPkg: string
  options: AppRunbookOption[]
  onChange: (pkg: string) => void
  disabled?: boolean
}

export function AppRunbookPicker({ selectedPkg, options, onChange, disabled }: AppRunbookPickerProps) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="app-runbook-picker"
        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 shrink-0"
      >
        <Smartphone className="w-4 h-4" />
        Target
      </label>
      <select
        id="app-runbook-picker"
        value={selectedPkg}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 max-w-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50 cursor-pointer"
      >
        <option value="">App Runbook (Global)</option>
        {options.map((opt) => (
          <option key={opt.packageId} value={opt.packageId}>
            {opt.label ? `${opt.label} — ${opt.packageId}` : opt.packageId}
            {opt.configured ? '' : ' (no runbook yet)'}
          </option>
        ))}
      </select>
    </div>
  )
}
