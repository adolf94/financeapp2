import { useState, useRef, useEffect } from 'react'
import { Calculator, Delete } from 'lucide-react'

interface CalculatorInputProps {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  className?: string
  required?: boolean
}

export default function CalculatorInput({ value, onChange, placeholder, className, required }: CalculatorInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [expression, setExpression] = useState(value)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Sync internal expression if external value changes (unless we are typing)
  useEffect(() => {
    if (!isOpen) {
      setExpression(value)
    }
  }, [value, isOpen])

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleEvaluate()
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, expression])

  const handleEvaluate = () => {
    try {
      if (!expression) {
        onChange('')
        return
      }
      // Extremely basic safe eval for math
      const sanitized = expression.replace(/[^0-9+\-*/.]/g, '')
      // eslint-disable-next-line no-new-func
      const result = new Function(`return ${sanitized}`)()
      if (result !== undefined && !isNaN(result)) {
        const formatted = Number(result).toFixed(2)
        setExpression(formatted)
        onChange(formatted)
      }
    } catch (e) {
      // If invalid, just leave as is or clear
    }
  }

  const append = (char: string) => {
    setExpression((prev) => prev + char)
  }

  const backspace = () => {
    setExpression((prev) => prev.slice(0, -1))
  }

  const clear = () => {
    setExpression('')
    onChange('')
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleEvaluate()
      setIsOpen(false)
    }
  }

  return (
    <div className="relative w-full" ref={popoverRef}>
      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="decimal"
          value={isOpen ? expression : value}
          onChange={(e) => {
            setExpression(e.target.value)
            if (!isOpen) onChange(e.target.value)
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          required={required}
          className={className || "w-full min-h-[44px] px-3 border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"}
          aria-label={placeholder || "Calculator Input"}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setIsOpen(!isOpen)}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-blue-600 transition-colors bg-transparent rounded-md flex items-center justify-center"
          aria-label="Toggle Calculator Pad"
        >
          <Calculator className="w-4 h-4" strokeWidth={1.5} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 top-full mt-2 right-0 w-[85vw] max-w-[300px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl rounded-xl p-2 select-none animate-in fade-in zoom-in-95">
          <div className="grid grid-cols-4 gap-1.5">
            <button type="button" onClick={clear} className="p-2.5 py-3 text-base bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 font-bold rounded-lg active:scale-95 transition-transform">C</button>
            <button type="button" onClick={() => append('/')} className="p-2.5 py-3 text-base bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg active:scale-95 transition-transform">÷</button>
            <button type="button" onClick={() => append('*')} className="p-2.5 py-3 text-base bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg active:scale-95 transition-transform">×</button>
            <button type="button" onClick={backspace} aria-label="Backspace" className="p-2.5 py-3 text-base flex justify-center items-center bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg active:scale-95 transition-transform"><Delete className="w-4.5 h-4.5" strokeWidth={1.5} /></button>

            <button type="button" onClick={() => append('7')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">7</button>
            <button type="button" onClick={() => append('8')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">8</button>
            <button type="button" onClick={() => append('9')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">9</button>
            <button type="button" onClick={() => append('-')} className="p-2.5 py-3 text-base bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg active:scale-95 transition-transform">−</button>

            <button type="button" onClick={() => append('4')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">4</button>
            <button type="button" onClick={() => append('5')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">5</button>
            <button type="button" onClick={() => append('6')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">6</button>
            <button type="button" onClick={() => append('+')} className="p-2.5 py-3 text-base bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg active:scale-95 transition-transform">+</button>

            <button type="button" onClick={() => append('1')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">1</button>
            <button type="button" onClick={() => append('2')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">2</button>
            <button type="button" onClick={() => append('3')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">3</button>
            <button type="button" onClick={() => { handleEvaluate(); setIsOpen(false) }} className="row-span-2 p-2.5 py-3 text-base bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-md active:scale-95 transition-transform flex items-center justify-center">=</button>

            <button type="button" onClick={() => append('0')} className="col-span-2 p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">0</button>
            <button type="button" onClick={() => append('.')} className="p-2.5 py-3 text-base bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold rounded-lg shadow-sm active:scale-95 transition-transform">.</button>
          </div>
        </div>
      )}
    </div>
  )
}
