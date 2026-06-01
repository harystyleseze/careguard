"use client";

import { MetadataCard, type MetadataItem } from "./ui/metadata-card";

export interface EnhancedDetailViewProps {
  type: "medication" | "bill";
  data: {
    id?: string;
    name: string;
    creator?: string;
    price?: number;
    salesCount?: number;
    contentHash?: string;
    status?: "active" | "inactive" | "purchased" | "unavailable";
    preview?: string;
    metadata?: Record<string, string | number>;
  };
  onAction?: (action: "buy" | "unlock") => void;
  actionDisabled?: boolean;
  actionLoading?: boolean;
}

export function EnhancedDetailView({
  type,
  data,
  onAction,
  actionDisabled,
  actionLoading,
}: EnhancedDetailViewProps) {
  const getStatusBadge = () => {
    const statusColors = {
      active: "bg-green-100 text-green-800",
      inactive: "bg-gray-100 text-gray-800",
      purchased: "bg-blue-100 text-blue-800",
      unavailable: "bg-red-100 text-red-800",
    };

    const status = data.status || "active";
    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColors[status]}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getActionButton = () => {
    if (!onAction) return null;

    const isPurchased = data.status === "purchased";
    const isUnavailable = data.status === "unavailable" || data.status === "inactive";

    if (isUnavailable) {
      return (
        <div className="text-center py-3 text-sm text-slate-500">
          This {type} is currently unavailable
        </div>
      );
    }

    return (
      <button
        onClick={() => onAction(isPurchased ? "unlock" : "buy")}
        disabled={actionDisabled || actionLoading}
        className="w-full bg-sky-500 text-white py-3 rounded-lg font-semibold hover:bg-sky-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
      >
        {actionLoading ? "Processing..." : isPurchased ? "Unlock" : `Purchase for ${data.price} USDC`}
      </button>
    );
  };

  const metadataItems: MetadataItem[] = [
    ...(data.creator ? [{ label: "Creator", value: data.creator, copyable: true }] : []),
    ...(data.price !== undefined ? [{ label: "Price", value: `${data.price} USDC`, highlight: true }] : []),
    ...(data.salesCount !== undefined ? [{ label: "Sales", value: data.salesCount }] : []),
    ...(data.contentHash ? [{ label: "Content Hash", value: data.contentHash.slice(0, 16) + "...", copyable: true }] : []),
    ...(data.metadata ? Object.entries(data.metadata).map(([key, value]) => ({
      label: key.charAt(0).toUpperCase() + key.slice(1),
      value: value,
    })) : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-2xl font-bold text-slate-900">{data.name}</h2>
          {getStatusBadge()}
        </div>
        
        {data.preview && (
          <div className="mt-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <p className="text-sm font-medium text-slate-600 mb-2">Preview</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{data.preview}</p>
          </div>
        )}
      </div>

      {/* Metadata */}
      {metadataItems.length > 0 && (
        <MetadataCard
          title={`${type.charAt(0).toUpperCase() + type.slice(1)} Details`}
          items={metadataItems}
          footer={getActionButton()}
        />
      )}

      {/* Trust Indicators */}
      {data.contentHash && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-900 mb-1">Verified Content</p>
              <p className="text-xs text-blue-700">
                This {type} has been cryptographically verified. The content hash ensures authenticity and prevents tampering.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
