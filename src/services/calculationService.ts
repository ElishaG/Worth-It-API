import { env } from "../config/env.js";
import { clamp, percentile } from "../lib/money.js";
import type { Database, Json } from "../database.types.js";
import type { MarketComparable } from "../providers/market/types.js";

type ScanRow = Database["public"]["Tables"]["scans"]["Row"];
type ScanItemRow = Database["public"]["Tables"]["scan_items"]["Row"];

export type CalculationPreferences = {
  targetProfitAmountMinor?: number;
  targetRoiPercent?: number;
};

export type AnalysisCalculation = {
  worthScore: number;
  confidence: Database["public"]["Enums"]["confidence_level"];
  quickReturnAmountMinor: number;
  normalReturnAmountMinor: number;
  maximumReturnAmountMinor: number;
  totalCashInvestedAmountMinor: number;
  estimatedNetProfitAmountMinor: number;
  roiPercent: number | null;
  maximumBuyPriceAmountMinor: number;
  comparableCount: number;
  includedSoldCount: number;
  includedActiveCount: number;
  assumptions: Json;
  scoreComponents: Json;
  warnings: Json;
  includedComparables: Array<MarketComparable & { decision: "included" | "excluded"; exclusionReason: string | null }>;
};

const VARIANT_TERMS = [
  "edge", "limited edition", "anniversary", "collector", "custom", "modded",
  "bundle", "lot", "2 pack", "2-pack", "all colors", "all colours",
  "console", "box only", "empty box", "shell", "case only", "charger only",
  "parts", "repair", "not working", "broken", "untested", "for parts",
];

const CONDITION_RANK: Record<Database["public"]["Enums"]["item_condition"], number> = {
  unknown: 0,
  for_parts: 1,
  poor: 2,
  fair: 3,
  good: 4,
  excellent: 5,
  like_new: 6,
  open_box: 7,
  new: 8,
};

type FilterTier = "strict" | "balanced" | "broad";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasUnmatchedVariantTerm(targetTitle: string, comparableTitle: string): boolean {
  const target = normalize(targetTitle);
  const candidate = normalize(comparableTitle);
  return VARIANT_TERMS.some((term) => candidate.includes(normalize(term)) && !target.includes(normalize(term)));
}

function conditionIsCompatible(
  target: Database["public"]["Enums"]["item_condition"],
  candidate: Database["public"]["Enums"]["item_condition"],
  maximumDistance = 1,
): boolean {
  if (target === "unknown" || candidate === "unknown") return true;
  if (target === "for_parts" || candidate === "for_parts") return target === candidate;
  return Math.abs(CONDITION_RANK[target] - CONDITION_RANK[candidate]) <= maximumDistance;
}

function filterTierAccepts(
  tier: FilterTier,
  targetCondition: Database["public"]["Enums"]["item_condition"],
  comparable: MarketComparable,
): boolean {
  if (tier === "strict") return comparable.matchScore >= 0.62 && conditionIsCompatible(targetCondition, comparable.condition, 1);
  if (tier === "balanced") return comparable.matchScore >= 0.54 && conditionIsCompatible(targetCondition, comparable.condition, 2);
  return comparable.matchScore >= 0.48 && conditionIsCompatible(targetCondition, comparable.condition, 3);
}

function amountInDisplayCurrency(amount: number | null, currency: string | null, displayCurrency: string, warnings: string[]): number {
  if (amount === null) return 0;
  if (currency !== displayCurrency) {
    warnings.push(`A ${currency ?? "missing-currency"} cost was excluded because no FX provider is connected.`);
    return 0;
  }
  return amount;
}

function quartileBounds(prices: number[]): { low: number; high: number } | null {
  if (prices.length < 4) return null;
  const q1 = percentile(prices, 0.25);
  const q3 = percentile(prices, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return null;
  return { low: Math.max(1, q1 - 1.5 * iqr), high: q3 + 1.5 * iqr };
}

export function calculateAnalysis(input: {
  scan: ScanRow;
  item: ScanItemRow;
  comparables: MarketComparable[];
  providerWarnings?: string[];
  preferences?: CalculationPreferences;
}): AnalysisCalculation {
  const warnings = [...(input.providerWarnings ?? [])];
  const displayCurrency = input.scan.preferred_currency;

  // Hard safety filters never relax. These stop clearly wrong variants, parts-only
  // listings, invalid prices and currencies from contaminating an estimate.
  const hardClassified = input.comparables.map((comparable) => {
    if (comparable.displayCurrency !== displayCurrency) return { ...comparable, decision: "excluded" as const, exclusionReason: "currency_mismatch" };
    if (comparable.totalDisplayAmountMinor <= 0) return { ...comparable, decision: "excluded" as const, exclusionReason: "invalid_price" };
    if (hasUnmatchedVariantTerm(input.item.title, comparable.title)) return { ...comparable, decision: "excluded" as const, exclusionReason: "variant_or_accessory_mismatch" };
    return { ...comparable, decision: "included" as const, exclusionReason: null };
  });

  const eligible = hardClassified.filter((item) => item.decision === "included");
  const strictCount = eligible.filter((item) => filterTierAccepts("strict", input.item.condition, item)).length;
  const balancedCount = eligible.filter((item) => filterTierAccepts("balanced", input.item.condition, item)).length;

  // Prefer precision, but do not return zero just because recognition included too
  // many descriptive details. Relax only relevance/condition tolerance, never the
  // hard variant/accessory safety rules above.
  const filterTier: FilterTier = strictCount >= 3
    ? "strict"
    : balancedCount >= 3
      ? "balanced"
      : "broad";

  if (filterTier === "balanced") warnings.push("Marketplace filtering was slightly broadened because fewer than three strict matches were found.");
  if (filterTier === "broad") warnings.push("Marketplace filtering used a broad fallback because the item had very few close matches. Review the comparables before relying on the estimate.");

  const initiallyClassified = hardClassified.map((comparable) => {
    if (comparable.decision === "excluded") return comparable;
    if (!filterTierAccepts(filterTier, input.item.condition, comparable)) {
      const conditionCompatible = conditionIsCompatible(input.item.condition, comparable.condition, filterTier === "strict" ? 1 : filterTier === "balanced" ? 2 : 3);
      return {
        ...comparable,
        decision: "excluded" as const,
        exclusionReason: conditionCompatible ? "low_match_score" : "condition_mismatch",
      };
    }
    return comparable;
  });

  const preliminary = initiallyClassified.filter((item) => item.decision === "included");
  const preliminaryPrices = preliminary.map((item) => item.totalDisplayAmountMinor).sort((a, b) => a - b);
  const bounds = quartileBounds(preliminaryPrices);

  const classified = initiallyClassified.map((comparable) => {
    if (comparable.decision === "excluded" || !bounds) return comparable;
    if (comparable.totalDisplayAmountMinor < bounds.low || comparable.totalDisplayAmountMinor > bounds.high) {
      return { ...comparable, decision: "excluded" as const, exclusionReason: "price_outlier" };
    }
    return comparable;
  });

  const included = classified
    .filter((item) => item.decision === "included")
    .sort((a, b) => b.matchScore - a.matchScore || a.totalDisplayAmountMinor - b.totalDisplayAmountMinor)
    .slice(0, 20);

  const selectedReferences = new Set(included.map((item) => `${item.source}:${item.sourceReference}`));
  const finalClassified = classified.map((item) => {
    if (item.decision === "included" && !selectedReferences.has(`${item.source}:${item.sourceReference}`)) {
      return { ...item, decision: "excluded" as const, exclusionReason: "lower_ranked_match" };
    }
    return item;
  });

  const sortedPrices = included.map((item) => item.totalDisplayAmountMinor).sort((a, b) => a - b);
  if (sortedPrices.length < 3) warnings.push("Not enough strong marketplace comparables were found for a reliable estimate.");

  const median = percentile(sortedPrices, 0.5);
  const activeOnly = included.length > 0 && included.every((item) => item.listingStatus === "active");
  const activeListingAdjustment = activeOnly ? 0.92 : 1;
  const quickReturn = sortedPrices.length >= 3 ? Math.round(median * 0.80) : 0;
  const normalReturn = sortedPrices.length >= 3 ? Math.round(median * activeListingAdjustment) : 0;
  const upperQuartile = percentile(sortedPrices, 0.75);
  const maximumReturn = sortedPrices.length >= 3 ? Math.max(normalReturn, Math.round(Math.min(upperQuartile, median * 1.25))) : 0;

  const purchasePrice = amountInDisplayCurrency(input.scan.purchase_price_amount_minor, input.scan.purchase_price_currency, displayCurrency, warnings);
  const inboundShipping = amountInDisplayCurrency(input.item.inbound_shipping_amount_minor, input.item.inbound_shipping_currency, displayCurrency, warnings);
  const taxes = amountInDisplayCurrency(input.item.taxes_paid_amount_minor, input.item.taxes_paid_currency, displayCurrency, warnings);
  const repair = amountInDisplayCurrency(input.item.repair_cost_amount_minor, input.item.repair_cost_currency, displayCurrency, warnings);
  const otherAcquisition = amountInDisplayCurrency(input.item.other_acquisition_costs_amount_minor, input.item.other_acquisition_costs_currency, displayCurrency, warnings);
  const outboundShipping = amountInDisplayCurrency(input.item.outbound_shipping_amount_minor, input.item.outbound_shipping_currency, displayCurrency, warnings);

  const totalInvested = purchasePrice + inboundShipping + taxes + repair + otherAcquisition;
  const marketplaceFee = Math.round(normalReturn * env.DEFAULT_MARKETPLACE_FEE_RATE) + (normalReturn > 0 ? env.DEFAULT_FIXED_FEE_AMOUNT_MINOR : 0);
  const netProfit = normalReturn > 0 ? normalReturn - marketplaceFee - outboundShipping - totalInvested : 0;
  const roiPercent = normalReturn > 0 && totalInvested > 0 ? Number(((netProfit / totalInvested) * 100).toFixed(4)) : null;

  const defaultTargetProfit = Math.round(normalReturn * env.DEFAULT_TARGET_MARGIN_RATE);
  const roiTargetProfit = input.preferences?.targetRoiPercent !== undefined && totalInvested > 0 ? Math.round(totalInvested * (input.preferences.targetRoiPercent / 100)) : 0;
  const desiredProfit = Math.max(input.preferences?.targetProfitAmountMinor ?? 0, roiTargetProfit, defaultTargetProfit);
  const nonPurchaseCosts = inboundShipping + taxes + repair + otherAcquisition;
  const maximumBuyPrice = normalReturn > 0 ? Math.max(0, normalReturn - marketplaceFee - outboundShipping - nonPurchaseCosts - desiredProfit) : 0;

  const soldCount = included.filter((item) => item.listingStatus === "sold").length;
  const activeCount = included.filter((item) => item.listingStatus === "active").length;
  const confidence: AnalysisCalculation["confidence"] = included.length >= 12 ? "high" : included.length >= 5 ? "medium" : "low";

  const roiScore = clamp(((roiPercent ?? 0) / 100) * 35, 0, 35);
  const marginPercent = normalReturn > 0 ? (netProfit / normalReturn) * 100 : 0;
  const marginScore = clamp((marginPercent / 40) * 25, 0, 25);
  const comparableScore = clamp((included.length / 12) * 20, 0, 20);
  const confidenceScore = confidence === "high" ? 20 : confidence === "medium" ? 13 : 6;
  const spread = normalReturn > 0 ? (maximumReturn - quickReturn) / normalReturn : 1;
  const spreadPenalty = clamp(spread * 15, 0, 15);
  const worthScore = normalReturn > 0 ? Math.round(clamp(roiScore + marginScore + comparableScore + confidenceScore - spreadPenalty, 0, 100)) : 0;

  return {
    worthScore,
    confidence,
    quickReturnAmountMinor: quickReturn,
    normalReturnAmountMinor: normalReturn,
    maximumReturnAmountMinor: maximumReturn,
    totalCashInvestedAmountMinor: totalInvested,
    estimatedNetProfitAmountMinor: netProfit,
    roiPercent,
    maximumBuyPriceAmountMinor: maximumBuyPrice,
    comparableCount: included.length,
    includedSoldCount: soldCount,
    includedActiveCount: activeCount,
    assumptions: {
      marketplace_fee_rate: env.DEFAULT_MARKETPLACE_FEE_RATE,
      fixed_fee_amount_minor: env.DEFAULT_FIXED_FEE_AMOUNT_MINOR,
      target_margin_rate: env.DEFAULT_TARGET_MARGIN_RATE,
      desired_profit_amount_minor: desiredProfit,
      pricing_method: "progressive_filtered_median_v3",
      filter_tier: filterTier,
      active_listing_adjustment: activeListingAdjustment,
      quick_sale_multiplier: 0.80,
      maximum_median_multiplier: 1.25,
      outlier_method: bounds ? "iqr_1_5" : "not_applied",
      maximum_comparables: 20,
    },
    scoreComponents: {
      roi_score: Number(roiScore.toFixed(2)),
      margin_score: Number(marginScore.toFixed(2)),
      comparable_score: Number(comparableScore.toFixed(2)),
      confidence_score: confidenceScore,
      spread_penalty: Number(spreadPenalty.toFixed(2)),
    },
    warnings,
    includedComparables: finalClassified,
  };
}
