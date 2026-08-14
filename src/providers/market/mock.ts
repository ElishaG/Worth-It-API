import type { MarketProvider } from "./types.js";

export class MockMarketProvider implements MarketProvider {
  async search(input: Parameters<MarketProvider["search"]>[0]) {
    const base = Math.max(input.purchasePriceAmountMinor ?? 10_000, 2_500);
    const multipliers = [1.45, 1.6, 1.75, 1.85, 2.0, 2.15, 2.3, 1.9, 1.7, 2.05];
    const now = Date.now();
    const comparables = multipliers.map((multiplier, index) => {
      const amount = Math.round(base * multiplier);
      return {
        source: "mock",
        sourceReference: `mock-${index + 1}`,
        title: `${input.title} comparable ${index + 1}`,
        brand: input.brand,
        model: input.model,
        category: input.category,
        condition: input.condition,
        listingStatus: index < 6 ? "sold" as const : "active" as const,
        eventDate: new Date(now - index * 3 * 86_400_000).toISOString(),
        priceOriginalAmountMinor: amount,
        priceOriginalCurrency: input.displayCurrency,
        shippingOriginalAmountMinor: 0,
        shippingOriginalCurrency: input.displayCurrency,
        totalDisplayAmountMinor: amount,
        displayCurrency: input.displayCurrency,
        matchScore: Math.max(0.7, 0.97 - index * 0.025),
        attributes: { mode: "mock" },
        sourceUrl: null,
      };
    });

    return {
      comparables,
      warnings: ["Mock marketplace data is enabled; these are not real listings."],
      freshnessAt: new Date().toISOString(),
    };
  }
}
