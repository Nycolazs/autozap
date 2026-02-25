import { useCallback, useState } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export type ToastState = {
  id: number;
  message: string;
  type: ToastType;
  actionLabel?: string;
  onAction?: (() => void) | null;
};

let toastCounter = 1;

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((
    message: string,
    type: ToastType = 'info',
    timeoutMs = 3200,
    options?: { actionLabel?: string; onAction?: (() => void) | null }
  ) => {
    const id = toastCounter++;
    const actionLabel = String(options && options.actionLabel ? options.actionLabel : '').trim();
    const onAction = options && typeof options.onAction === 'function' ? options.onAction : null;
    setToasts((prev) => [...prev, {
      id,
      message,
      type,
      ...(actionLabel ? { actionLabel } : {}),
      ...(onAction ? { onAction } : {}),
    }]);
    if (timeoutMs > 0) {
      window.setTimeout(() => dismiss(id), timeoutMs);
    }
  }, [dismiss]);

  return {
    toasts,
    push,
    dismiss,
  };
}
