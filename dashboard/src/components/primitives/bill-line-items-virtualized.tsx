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
}

export interface BillLineItemsVirtualizedProps {
  lineItems: BillLineItem[];
}

function ItemRow({ item }: { item: BillLineItem }) {
  return (
    <div
      className={`rounded-lg p-3 text-sm ${
        item.status === "valid"
          ? "bg-slate-50"
          : item.status === "duplicate"
            ? "border border-red-200 bg-red-50"
            : "border border-amber-200 bg-amber-50"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-medium break-words">{item.description}</div>
          <div className="hidden text-xs text-slate-500 sm:block">
            CPT: {item.cptCode || "N/A"}
          </div>
          <details className="mt-1 sm:hidden">
            <summary className="cursor-pointer text-xs text-slate-500">
              More details
            </summary>
            <div className="mt-1 text-xs text-slate-500">
              CPT: {item.cptCode || "N/A"}
            </div>
          </details>
          {item.errorDescription && (
            <div className="mt-1 text-xs text-red-600">
              {item.errorDescription}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
          <div
            className={`font-mono ${item.status !== "valid" ? "line-through text-red-500" : ""}`}
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
    </div>
  );
}

export function BillLineItemsVirtualized({
  lineItems,
}: BillLineItemsVirtualizedProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // TanStack Virtual returns functions that React Compiler will not memoize safely.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: lineItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 5,
  });

  if (lineItems.length <= 50) {
    return (
      <div className="space-y-2">
        {lineItems.map((item, j) => (
          <ItemRow key={j} item={item} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="rounded-lg"
      style={{
        height: `${Math.min(400, virtualizer.getTotalSize())}px`,
        overflowY: "auto",
        overflowX: "hidden",
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
          return (
            <div
              key={virtualItem.index}
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
                <ItemRow item={item} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
