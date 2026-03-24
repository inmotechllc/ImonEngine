import type { DigitalAssetType } from "./digital-assets.js";

export type GrowthChannel = "gumroad_update" | "facebook_page" | "x" | "linkedin" | "pinterest";

export type GrowthWorkItemStatus = "planned" | "queued" | "posted" | "skipped";

export interface GrowthWorkItem {
  id: string;
  businessId: string;
  packId: string;
  channel: GrowthChannel;
  title: string;
  caption: string;
  assetPath: string;
  destinationUrl: string;
  scheduledFor: string;
  status: GrowthWorkItemStatus;
  notes: string[];
  createdAt: string;
  updatedAt: string;
}

export type SalesTransactionSource = "gumroad" | "relay" | "manual";

export type SalesTransactionType =
  | "sale"
  | "refund"
  | "fee"
  | "payout"
  | "deposit"
  | "ad_spend"
  | "tool_cost"
  | "transfer"
  | "owner_draw";

export interface SalesTransaction {
  id: string;
  businessId?: string;
  packId?: string;
  source: SalesTransactionSource;
  externalId?: string;
  type: SalesTransactionType;
  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  currency: string;
  counterparty: string;
  note: string;
  occurredAt: string;
  importedAt: string;
  metadata?: Record<string, string>;
}

export interface RevenueAllocationPolicy {
  id: string;
  businessId: string;
  taxReserveRate: number;
  reinvestmentRate: number;
  refundBufferRate: number;
  cashoutThreshold: number;
  updatedAt: string;
}

export interface RevenueAllocationSnapshot {
  id: string;
  businessId: string;
  windowStart: string;
  windowEnd: string;
  saleCount: number;
  refundCount: number;
  grossRevenue: number;
  fees: number;
  refunds: number;
  netRevenue: number;
  relayDeposits: number;
  relaySpend: number;
  unmatchedRelayTransactions: number;
  recommendations: {
    taxReserve: number;
    growthReinvestment: number;
    refundBuffer: number;
    collectiveTransfer: number;
    ownerCashoutReady: boolean;
  };
  generatedAt: string;
}

export interface CollectiveFundSnapshot {
  id: string;
  generatedAt: string;
  businessCount: number;
  contributingBusinesses: Array<{
    businessId: string;
    collectiveTransfer: number;
    growthReinvestment: number;
  }>;
  totals: {
    collectiveTransfer: number;
    growthReinvestment: number;
  };
  recommendations: {
    sharedToolsReinvestmentCap: number;
    reserveAfterSharedReinvestment: number;
    ownerCashoutReady: boolean;
  };
}

export interface CatalogGrowthPolicy {
  id: string;
  businessId: string;
  maxNewPacksPer7Days: number;
  maxPublishedPacks: number;
  maxSharePerAssetType: number;
  maxOpenPackQueue: number;
  minPublishedByType: Partial<Record<DigitalAssetType, number>>;
  updatedAt: string;
}
