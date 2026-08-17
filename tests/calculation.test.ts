import { describe, expect, it } from "vitest";
import { calculateAnalysis } from "../src/services/calculationService.js";
import type { Database } from "../src/database.types.js";

const scan = {
  id: "00000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000002",
  status: "analyzing",
  preferred_currency: "CAD",
  purchase_price_amount_minor: 10_000,
  purchase_price_currency: "CAD",
  category_hint: "electronics",
  source_context: null,
  current_analysis_revision: 1,
  status_reason: null,
  cancelled_at: null,
  completed_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} satisfies Database["public"]["Tables"]["scans"]["Row"];

const item = {
  id: "00000000-0000-4000-8000-000000000003",
  user_id: scan.user_id,
  scan_id: scan.id,
  candidate_id: null,
  title: "Test item",
  brand: "Brand",
  model: "Model",
  category: "electronics",
  condition: "good",
  attributes: {},
  accessories: [],
  repair_cost_amount_minor: 1_000,
  repair_cost_currency: "CAD",
  outbound_shipping_amount_minor: 1_500,
  outbound_shipping_currency: "CAD",
  taxes_paid_amount_minor: 0,
  taxes_paid_currency: "CAD",
  inbound_shipping_amount_minor: 500,
  inbound_shipping_currency: "CAD",
  other_acquisition_costs_amount_minor: 0,
  other_acquisition_costs_currency: "CAD",
  notes: null,
  recognition_confidence: 0.9,
  user_confirmed: true,
  confirmed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
} satisfies Database["public"]["Tables"]["scan_items"]["Row"];

const comparables = [15_000, 18_000, 20_000, 22_000, 24_000, 25_000, 27_000, 30_000].map((amount, index) => ({
  source: "test",
  sourceReference: `${index}`,
  title: "Test item",
  brand: "Brand",
  model: "Model",
  category: "electronics",
  condition: "good" as const,
  listingStatus: index < 4 ? "sold" as const : "active" as const,
  eventDate: new Date().toISOString(),
  priceOriginalAmountMinor: amount,
  priceOriginalCurrency: "CAD",
  shippingOriginalAmountMinor: 0,
  shippingOriginalCurrency: "CAD",
  totalDisplayAmountMinor: amount,
  displayCurrency: "CAD",
  matchScore: 0.9,
  attributes: {},
  sourceUrl: null,
}));

describe("calculateAnalysis", () => {
  it("calculates a bounded score and resale estimates", () => {
    const result = calculateAnalysis({ scan, item, comparables });
    expect(result.comparableCount).toBe(8);
    expect(result.normalReturnAmountMinor).toBeGreaterThan(0);
    expect(result.estimatedNetProfitAmountMinor).toBeLessThan(result.normalReturnAmountMinor);
    expect(result.worthScore).toBeGreaterThanOrEqual(0);
    expect(result.worthScore).toBeLessThanOrEqual(100);
    expect(result.confidence).toBe("high");
    expect((result.assumptions as Record<string, unknown>).filter_tier).toBe("strict");
  });

  it("excludes mismatched currencies", () => {
    const result = calculateAnalysis({ scan, item, comparables: [{ ...comparables[0]!, displayCurrency: "USD" }] });
    expect(result.comparableCount).toBe(0);
    expect(result.normalReturnAmountMinor).toBe(0);
  });

  it("uses a balanced fallback instead of returning zero when strict matches are sparse", () => {
    const relaxed = [16_000, 17_000, 18_000, 19_000].map((amount, index) => ({
      ...comparables[0]!,
      sourceReference: `relaxed-${index}`,
      totalDisplayAmountMinor: amount,
      priceOriginalAmountMinor: amount,
      matchScore: 0.58,
      condition: "like_new" as const,
    }));
    const result = calculateAnalysis({ scan, item, comparables: relaxed });
    expect(result.comparableCount).toBe(4);
    expect(result.normalReturnAmountMinor).toBeGreaterThan(0);
    expect((result.assumptions as Record<string, unknown>).filter_tier).toBe("balanced");
  });
});

it("removes extreme outliers and discounts active asking prices", () => {
  const active = [5_500, 6_000, 6_500, 7_000, 7_500, 8_000, 50_000].map((amount, index) => ({
    ...comparables[0]!,
    sourceReference: `active-${index}`,
    totalDisplayAmountMinor: amount,
    priceOriginalAmountMinor: amount,
    listingStatus: "active" as const,
  }));
  const result = calculateAnalysis({ scan: { ...scan, purchase_price_amount_minor: 2_000 }, item, comparables: active });
  expect(result.comparableCount).toBe(6);
  expect(result.normalReturnAmountMinor).toBeLessThan(7_000);
  expect(result.includedComparables.some((entry) => entry.exclusionReason === "price_outlier")).toBe(true);
});

it("excludes unmatched premium variants and parts listings", () => {
  const variants = [
    { ...comparables[0]!, sourceReference: "standard", title: "Sony DualSense Wireless Controller White", totalDisplayAmountMinor: 6_500 },
    { ...comparables[0]!, sourceReference: "edge", title: "Sony DualSense Edge Wireless Controller", totalDisplayAmountMinor: 18_000 },
    { ...comparables[0]!, sourceReference: "parts", title: "PS5 Controller for parts repair", totalDisplayAmountMinor: 2_000 },
  ];
  const controllerItem = { ...item, title: "Sony DualSense Wireless Controller White", condition: "good" as const };
  const result = calculateAnalysis({ scan, item: controllerItem, comparables: variants });
  expect(result.comparableCount).toBe(1);
  expect(result.normalReturnAmountMinor).toBe(0);
  expect(result.includedComparables.filter((entry) => entry.decision === "excluded")).toHaveLength(2);
});
