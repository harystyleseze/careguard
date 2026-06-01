"use client";

import { ReactNode } from "react";

export interface MetadataItem {
  label: string;
  value: string | number | ReactNode;
  copyable?: boolean;
  highlight?: boolean;
}

export interface MetadataCardProps {
  title: string;
  items: MetadataItem[];
  footer?: ReactNode;
  className?: string;
}

export function MetadataCard({ title, items, footer, className = "" }: MetadataCardProps) {
  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <div className={`bg-white rounded-lg border border-slate-200 overflow-hidden ${className}`}>
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      </div>
      
      <div className="divide-y divide-slate-100">
        {items.map((item, index) => (
          <div
            key={index}
            className={`px-6 py-3 flex items-center justify-between ${
              item.highlight ? "bg-sky-50" : ""
            }`}
          >
            <span className="text-sm font-medium text-slate-600">{item.label}</span>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${item.highlight ? "font-semibold text-sky-700" : "text-slate-900"}`}>
                {item.value}
              </span>
              {item.copyable && typeof item.value === "string" && (
                <button
                  onClick={() => handleCopy(item.value as string)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={`Copy ${item.label}`}
                  title="Copy to clipboard"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {footer && (
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
          {footer}
        </div>
      )}
    </div>
  );
}
