"use client";

import { useEffect, useState } from "react";
import { AnalyticsCard } from "./ui/analytics-card";

export interface MarketplaceMetrics {
  totalListings: number;
  activeListings: number;
  totalSales: number;
  volumeXLM: number;
}

export interface MarketplaceAnalyticsProps {
  apiUrl?: string;
}

export function MarketplaceAnalytics({ apiUrl }: MarketplaceAnalyticsProps) {
  const [metrics, setMetrics] = useState<MarketplaceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMetrics() {
      try {
        setLoading(true);
        setError(null);
        
        // For careguard, we'll fetch agent statistics instead of marketplace data
        const baseUrl = apiUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004";
        const response = await fetch(`${baseUrl}/agent/metrics`);
        
        if (!response.ok) {
          throw new Error("Failed to fetch metrics");
        }
        
        const data = await response.json();
        setMetrics(data);
      } catch (err) {
        console.error("Error fetching marketplace metrics:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchMetrics();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const unavailable = !loading && (error !== null || metrics === null);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <AnalyticsCard
        title="Total Tasks"
        value={metrics?.totalListings ?? 0}
        subtitle="All time"
        loading={loading}
        unavailable={unavailable}
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        }
      />
      
      <AnalyticsCard
        title="Active Tasks"
        value={metrics?.activeListings ?? 0}
        subtitle="In progress"
        loading={loading}
        unavailable={unavailable}
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        }
      />
      
      <AnalyticsCard
        title="Completed Tasks"
        value={metrics?.totalSales ?? 0}
        subtitle="Successfully executed"
        loading={loading}
        unavailable={unavailable}
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
      
      <AnalyticsCard
        title="Total Volume"
        value={metrics?.volumeXLM ? `${metrics.volumeXLM.toFixed(2)} XLM` : "0 XLM"}
        subtitle="Estimated value"
        loading={loading}
        unavailable={unavailable}
        icon={
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        }
      />
    </div>
  );
}
