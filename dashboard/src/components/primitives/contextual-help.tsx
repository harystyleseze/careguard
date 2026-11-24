"use client";

import { useState, useEffect } from "react";
import { getAgentHelpTopic, type AgentHelpTopic } from "../../lib/agent-help-content";

export interface ContextualHelpProps {
  topicKey: string;
  caregiverId?: string;
  variant?: "tooltip" | "inline";
  className?: string;
}

export function ContextualHelp({
  topicKey,
  caregiverId = "caregiver_default",
  variant = "tooltip",
  className = "",
}: ContextualHelpProps) {
  const topic: AgentHelpTopic = getAgentHelpTopic(topicKey);
  const storageKey = `careguard:help:dismissed:${caregiverId}:${topicKey}`;

  const [isDismissed, setIsDismissed] = useState<boolean>(true); // default true until hydrated
  const [isOpen, setIsOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      const dismissed = saved === "true";
      setIsDismissed(dismissed);
      if (!dismissed && variant === "inline") {
        setIsOpen(true);
      }
    } catch {
      // Fallback for restricted storage environments
      setIsDismissed(false);
    }
  }, [storageKey, variant]);

  const handleDismiss = () => {
    try {
      localStorage.setItem(storageKey, "true");
    } catch {
      // Ignored
    }
    setIsDismissed(true);
    setIsOpen(false);
  };

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  if (variant === "inline") {
    if (isDismissed && !isOpen) {
      return (
        <button
          type="button"
          onClick={handleToggle}
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium text-slate-500 hover:text-sky-700 bg-slate-100 hover:bg-sky-50 transition-colors cursor-pointer ${className}`}
          title={`Explain ${topic.title}`}
          aria-label={`Explain ${topic.title}`}
        >
          <span className="w-3.5 h-3.5 flex items-center justify-center rounded-full bg-slate-300 text-slate-800 font-bold text-[9px]">
            ?
          </span>
          <span>{topic.badge} help</span>
        </button>
      );
    }

    return (
      <div
        className={`relative p-3.5 rounded-xl border border-sky-100 bg-gradient-to-r from-sky-50/80 to-indigo-50/50 text-slate-700 text-xs shadow-xs ${className}`}
        role="region"
        aria-label={topic.title}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 flex items-center justify-center rounded-full bg-sky-600 text-white font-bold text-[10px]">
              i
            </span>
            <span className="font-semibold text-slate-900">{topic.title}</span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
              {topic.badge}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            className="text-[11px] text-slate-400 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-slate-200/50 cursor-pointer"
            title="Dismiss help"
          >
            Dismiss ✕
          </button>
        </div>

        <div className="mt-2.5 space-y-1.5 leading-relaxed">
          <p>
            <strong className="text-slate-800 font-medium">What triggered this:</strong>{" "}
            {topic.whatTriggered}
          </p>
          <p>
            <strong className="text-sky-900 font-medium">What you can do:</strong>{" "}
            {topic.whatYouCanDo}
          </p>
        </div>
      </div>
    );
  }

  // Tooltip / Popover variant (purely additive, non-blocking)
  return (
    <div className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={handleToggle}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 hover:bg-sky-500 hover:text-white text-slate-600 text-[10px] font-bold transition-colors cursor-pointer ml-1.5 align-middle focus:outline-none focus:ring-2 focus:ring-sky-400"
        title={`What is this? Click for plain-language help on ${topic.title}`}
        aria-label={`Help about ${topic.title}`}
      >
        ?
      </button>

      {isOpen && (
        <div
          className="absolute z-30 left-0 sm:left-auto sm:right-0 mt-2 w-72 sm:w-80 p-3.5 bg-white rounded-xl shadow-lg border border-slate-200 text-slate-700 text-xs animation-fade-in"
          role="dialog"
          aria-modal="false"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-900 text-xs">{topic.title}</span>
              <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">
                {topic.badge}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-xs px-1 cursor-pointer"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="space-y-2 text-xs leading-relaxed">
            <div>
              <span className="font-semibold text-slate-800 block text-[11px] mb-0.5">
                What triggered this:
              </span>
              <span className="text-slate-600">{topic.whatTriggered}</span>
            </div>
            <div>
              <span className="font-semibold text-sky-800 block text-[11px] mb-0.5">
                What you can do:
              </span>
              <span className="text-slate-600">{topic.whatYouCanDo}</span>
            </div>
          </div>

          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[10px] text-slate-400">Plain-language guide</span>
            <button
              type="button"
              onClick={handleDismiss}
              className="px-2 py-1 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded text-[11px] font-medium cursor-pointer transition-colors"
            >
              Don't show again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
