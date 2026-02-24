import { useCallback, useState } from 'react';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export type ToastState = {
  id: number;
  message: string;
  type: ToastType;
};

let toastCounter = 1;

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const push = useCallback((message: string, type: ToastType = 'info', timeoutMs = 3200) => {
    const id = toastCounter++;
    setToasts((prev) => [...prev, { id, message, type }]);
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
