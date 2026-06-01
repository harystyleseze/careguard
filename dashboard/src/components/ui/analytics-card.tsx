"use client";

import { ReactNode } from "react";

export interface AnalyticsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  loading?: boolean;
  unavailable?: boolean;
  trend?: {
    value: number;
    label: string;
    positive?: boolean;
  };
}

export function AnalyticsCard({
  title,
  value,
  subtitle,
  icon,
  loading,
  unavailable,
  trend,
}: AnalyticsCardProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <h3 className="text-sm font-medium text-slate-600">{title}</h3>
        {icon && <div className="text-slate-400">{icon}</div>}
      </div>

      {loading ? (
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-24 mb-2"></div>
          <div className="h-4 bg-slate-100 rounded w-32"></div>
        </div>
      ) : unavailable ? (
        <div>
          <p className="text-2xl font-bold text-slate-300 mb-1">—</p>
          <p className="text-xs text-slate-400">Data unavailable</p>
        </div>
      ) : (
        <>
          <p className="text-3xl font-bold text-slate-900 mb-1">{value}</p>
          {subtitle && (
            <p className="text-sm text-slate-500">{subtitle}</p>
          )}
          {trend && (
            <div className="mt-3 flex items-center gap-1">
              <span
                className={`text-xs font-medium ${
                  trend.positive ? "text-green-600" : "text-red-600"
                }`}
              >
                {trend.positive ? "↑" : "↓"} {Math.abs(trend.value)}%
              </span>
              <span className="text-xs text-slate-500">{trend.label}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
