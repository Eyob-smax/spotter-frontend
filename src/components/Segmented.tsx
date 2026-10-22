interface Props<T extends string | number> {
  label: string
  value: T
  options: T[]
  format: (value: T) => string
  onChange: (value: T) => void
  disabled?: boolean
}

export function Segmented<T extends string | number>({ label, value, options, format, onChange, disabled }: Props<T>) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={option === value ? 'on' : undefined}
          aria-pressed={option === value}
          disabled={disabled}
          onClick={() => option !== value && onChange(option)}
        >
          {format(option)}
        </button>
      ))}
    </div>
  )
}
