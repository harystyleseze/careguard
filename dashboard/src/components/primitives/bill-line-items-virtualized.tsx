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
      className={`flex items-center justify-between p-3 rounded-lg text-sm ${
        item.status === "valid"
          ? "bg-slate-50"
          : item.status === "duplicate"
            ? "bg-red-50 border border-red-200"
            : "bg-amber-50 border border-amber-200"
      }`}
    >
      <div className="flex-1">
        <div className="font-medium">{item.description}</div>
        <div className="hidden md:block text-xs text-slate-500">
          CPT: {item.cptCode}
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
          <div className="text-xs text-red-600 mt-1">{item.errorDescription}</div>
        )}
      </div>
      <div className="text-right ml-4">
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

export function BillLineItemsVirtualized({ lineItems }: BillLineItemsVirtualizedProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: lineItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5,
  });

  if (lineItems.length <= 50) {
    return (
      <div className="overflow-x-auto rounded-lg shadow-[inset_-10px_0_12px_-12px_rgba(15,23,42,0.25)]">
        <div className="space-y-2 min-w-[640px]">
          {lineItems.map((item, j) => (
            <ItemRow key={j} item={item} />
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
    </div>
  );
}
