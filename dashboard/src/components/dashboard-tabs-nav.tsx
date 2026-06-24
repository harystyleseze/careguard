"use client";

import Link from "next/link";
import { useState } from "react";
import { DASHBOARD_TABS, type Tab } from "./types";

export interface DashboardTabsNavProps {
  activeTab: Tab;
  pathname: string;
}

export function DashboardTabsNav({ activeTab, pathname }: DashboardTabsNavProps) {
  const [focusedTab, setFocusedTab] = useState<Tab>(activeTab);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const currentIndex = DASHBOARD_TABS.indexOf(focusedTab);
    let newIndex = currentIndex;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        newIndex = (currentIndex + 1) % DASHBOARD_TABS.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        newIndex =
          currentIndex === 0 ? DASHBOARD_TABS.length - 1 : currentIndex - 1;
        break;
      case "Home":
        e.preventDefault();
        newIndex = 0;
        break;
      case "End":
        e.preventDefault();
        newIndex = DASHBOARD_TABS.length - 1;
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const tab = DASHBOARD_TABS[newIndex];
        window.location.href =
          tab === "overview" ? pathname : `${pathname}?tab=${tab}`;
        return;
      }
      default:
        return;
    }
    setFocusedTab(DASHBOARD_TABS[newIndex]);
  };

  return (
    <nav
      role="tablist"
      aria-label="Dashboard tabs"
      className="mb-6 grid w-full grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2 sm:flex sm:w-fit sm:flex-wrap"
      onKeyDown={handleKeyDown}
    >
      {DASHBOARD_TABS.map((tab) => {
        const isActive = activeTab === tab;
        const href = tab === "overview" ? pathname : `${pathname}?tab=${tab}`;
        return (
          <Link
            key={tab}
            href={href}
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab}`}
            id={`tab-${tab}`}
            tabIndex={isActive ? 0 : -1}
            onFocus={() => setFocusedTab(tab)}
            className={`inline-flex min-h-11 w-full items-center justify-center rounded-md px-3 py-2.5 text-center text-sm font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 sm:w-auto ${isActive ? "bg-sky-500 text-white" : "text-slate-600 hover:bg-slate-100 active:bg-slate-200"}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Link>
        );
      })}
    </nav>
  );
}
