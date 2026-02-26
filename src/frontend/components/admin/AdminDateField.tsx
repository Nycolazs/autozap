import { useMemo, useRef } from 'react';
import styles from '@/src/frontend/components/admin/admin.module.css';
import { formatIsoDateBr } from '@/src/frontend/components/admin/helpers';

type AdminDateFieldProps = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
};

export function AdminDateField({
  label,
  value,
  onChange,
  placeholder = 'Selecionar data',
  min,
  max,
}: AdminDateFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const displayValue = useMemo(() => {
    const formatted = formatIsoDateBr(value);
    return formatted || placeholder;
  }, [placeholder, value]);

  const openPicker = () => {
    const input = inputRef.current;
    if (!input) return;

    try {
      const maybePicker = (input as HTMLInputElement & { showPicker?: () => void }).showPicker;
      if (typeof maybePicker === 'function') {
        maybePicker.call(input);
        return;
      }
      input.focus();
      input.click();
    } catch (_) {
      input.focus();
      input.click();
    }
  };

  return (
    <div className={styles.dateFieldWrap}>
      <label className={styles.label}>{label}</label>
      <button type="button" className={styles.dateFieldButton} onClick={openPicker}>
        <span className={styles.dateFieldIcon} aria-hidden="true">📅</span>
        <span className={value ? styles.dateFieldValue : styles.dateFieldPlaceholder}>{displayValue}</span>
      </button>
      <input
        ref={inputRef}
        className={styles.dateFieldNativeInput}
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
