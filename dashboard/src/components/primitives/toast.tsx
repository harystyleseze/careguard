"use client";

import { useEffect } from "react";

export interface ToastProps {
  message: string | null;
  fallbackText?: string;
  durationMs?: number;
  onDismiss: () => void;
}

export function Toast({ message, fallbackText, durationMs = 5000, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(t);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-lg"
    >
      <div className="text-sm text-slate-700">{message}</div>
      {fallbackText && (
        <input
          aria-label="Text that could not be copied"
          readOnly
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={fallbackText}
          className="mt-2 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs"
        />
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs text-slate-500 hover:text-slate-700 underline cursor-pointer"
      >
        Dismiss
      </button>
    </div>
  );
}
