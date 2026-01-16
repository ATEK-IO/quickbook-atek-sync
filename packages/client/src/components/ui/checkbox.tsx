import * as React from 'react'
import { cn } from '@/lib/utils'
import { Check } from 'lucide-react'

interface CheckboxProps {
  checked?: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}

export function Checkbox({ checked = false, onChange, disabled, id, className }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      className={cn(
        'h-4 w-4 shrink-0 rounded-sm border border-primary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked && 'bg-primary text-primary-foreground',
        className
      )}
    >
      {checked && <Check className="h-3 w-3" />}
    </button>
  )
}
