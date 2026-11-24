"use client";

import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

export interface BillLineItem {
  description: string;
  cptCode?: string;
  status: "valid" | "duplicate" | "upcoded" | "unbundled" | "error";
  chargedAmount: number;
  suggestedAmount?: number;
  errorDescription?: string;
  annotation?: string;
}

export interface BillLineItemsVirtualizedProps {
  lineItems: BillLineItem[];
  annotations?: Record<string, string>;
  onAnnotate?: (description: string, annotation: string) => void;
}

function ItemRow({
  item,
  annotation,
  onAnnotate,
}: {
  item: BillLineItem;
  annotation?: string;
  onAnnotate?: (description: string, annotation: string) => void;
}) {
  const effectiveAnnotation = annotation ?? item.annotation ?? "";
  const hasAnnotation = effectiveAnnotation.length > 0;

  return (
    <div
      className={`flex items-start justify-between p-3 rounded-lg text-sm ${
        item.status === "valid"
          ? hasAnnotation
            ? "bg-sky-50 border border-sky-200"
            : "bg-slate-50"
          : item.status === "duplicate"
            ? "bg-red-50 border border-red-200"
            : "bg-amber-50 border border-amber-200"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">{item.description}</span>
          {hasAnnotation && (
            <span
              className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 text-sky-700"
              title="Has caregiver note"
            >
              Note
            </span>
          )}
        </div>
        <div className="hidden md:block text-xs text-slate-500">
          CPT: {item.cptCode || "N/A"}
        </div>
        <details className="md:hidden mt-1">
          <summary className="cursor-pointer text-xs text-slate-500">
            More details
          </summary>
          <div className="text-xs text-slate-500 mt-1">
            CPT: {item.cptCode || "N/A"}
          </div>
        </details>
        {item.errorDescription && (
          <div className="text-xs text-red-600 mt-1">
            {item.errorDescription}
          </div>
        )}
        {/* Annotation area */}
        {onAnnotate ? (
          <div className="mt-2">
            <input
              type="text"
              maxLength={280}
              value={effectiveAnnotation}
              placeholder="Add a note (e.g. call to confirm this was billed once)"
              onChange={(e) => onAnnotate(item.description, e.target.value)}
              aria-label={`Note for ${item.description}`}
              className={`w-full text-xs px-2 py-1 rounded border focus:outline-none focus:ring-1 focus:ring-sky-400 ${
                hasAnnotation
                  ? "border-sky-300 bg-white text-slate-700"
                  : "border-slate-200 bg-white/60 text-slate-500"
              }`}
            />
          </div>
        ) : (
          hasAnnotation && (
            <div className="mt-1 text-xs text-sky-700 italic">
              {effectiveAnnotation}
            </div>
          )
        )}
      </div>
      <div className="text-right ml-4 shrink-0">
        <div
          className={item.status !== "valid" ? "line-through text-red-500" : ""}
        >
          ${item.chargedAmount}
        </div>
        {item.status !== "valid" && (
          <div className="text-green-600 font-medium">
            ${item.suggestedAmount}
          </div>
        )}
      </div>
    </div>
  );
}

export function BillLineItemsVirtualized({
  lineItems,
  annotations,
  onAnnotate,
}: BillLineItemsVirtualizedProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: lineItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (onAnnotate ? 110 : 80),
    overscan: 5,
  });

  if (lineItems.length <= 50) {
    return (
      <div className="overflow-x-auto rounded-lg shadow-[inset_-10px_0_12px_-12px_rgba(15,23,42,0.25)]">
        <div className="space-y-2 min-w-[640px]">
          {lineItems.map((item, j) => (
            <div key={j}>
              <ItemRow
                item={item}
                annotation={annotations?.[item.description]}
                onAnnotate={onAnnotate}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg shadow-[inset_-10px_0_12px_-12px_rgba(15,23,42,0.25)]">
      <div
        ref={parentRef}
        className="min-w-[640px]"
        style={{
          height: `${Math.min(400, virtualizer.getTotalSize())}px`,
          overflow: "auto",
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = lineItems[virtualItem.index];
            const stableKey = `${item.description}:${item.cptCode ?? ""}:${item.chargedAmount}`;
            return (
              <div
                key={stableKey}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: `${virtualItem.size}px`,
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <div className="m-1">
                  <ItemRow
                    item={item}
                    annotation={annotations?.[item.description]}
                    onAnnotate={onAnnotate}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
