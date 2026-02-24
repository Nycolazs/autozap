import type { ToastState } from '@/src/frontend/hooks/useToast';
import styles from '@/src/frontend/components/chat/chat.module.css';

type ToastViewportProps = {
  toasts: ToastState[];
};

function resolveToastClass(type: ToastState['type']): string {
  if (type === 'success') return styles.toastSuccess;
  if (type === 'warning') return styles.toastWarning;
  if (type === 'error') return styles.toastError;
  return styles.toastInfo;
}

export function ToastViewport({ toasts }: ToastViewportProps) {
  if (!toasts.length) return null;

  return (
    <div className={styles.toastViewport} aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`${styles.toastItem} ${resolveToastClass(toast.type)}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
