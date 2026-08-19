import { z } from "zod";
import { env } from "../../config/env.js";
import { ApiError } from "../../lib/errors.js";
import type { Database } from "../../database.types.js";
import type { MarketProvider, MarketSearchInput } from "./types.js";

const Money = z.object({ value: z.string(), currency: z.string() });
const ShippingOption = z.object({ shippingCost: Money.optional() }).passthrough();
const ItemSummary = z.object({
  itemId: z.string(),
  title: z.string(),
  itemWebUrl: z.string().url().optional(),
  price: Money,
  condition: z.string().optional(),
  conditionId: z.string().optional(),
  buyingOptions: z.array(z.string()).optional(),
  shippingOptions: z.array(ShippingOption).optional(),
  itemEndDate: z.string().optional(),
}).passthrough();
const SearchResponse = z.object({ itemSummaries: z.array(ItemSummary).default([]) }).passthrough();

function mapCondition(value?: string): Database["public"]["Enums"]["item_condition"] {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("brand new") || normalized === "new") return "new";
  if (normalized.includes("open box")) return "open_box";
  if (normalized.includes("like new")) return "like_new";
  if (normalized.includes("excellent")) return "excellent";
  if (normalized.includes("good")) return "good";
  if (normalized.includes("fair")) return "fair";
  if (normalized.includes("poor")) return "poor";
  if (normalized.includes("parts") || normalized.includes("not working")) return "for_parts";
  return "unknown";
}

function toMinor(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

const SEARCH_STOP_WORDS = new Set([
  "the", "and", "for", "with", "new", "used", "item", "official", "genuine",
  "wireless", "controller", "console", "edition", "colour", "color", "black", "white",
  "red", "blue", "green", "silver", "gold", "gray", "grey", "inch", "inches",
]);

const APPLE_DEVICE_ACCESSORY_TERMS = [
  "case", "cover", "protector", "screen protector", "tempered glass", "privacy glass",
  "charger", "charging cable", "usb cable", "lightning cable", "usb-c cable", "adapter",
  "mount", "holder", "stand", "dock", "skin", "sticker", "wallet", "sleeve", "pouch",
  "replacement screen", "lcd", "digitizer", "housing", "back glass", "backglass", "rear glass",
  "replacement battery", "battery replacement", "repair kit", "parts only", "for parts",
  "keyboard case", "folio", "stylus", "apple pencil", "frame replacement", "camera lens replacement",
];

function cleanSearchWords(value: string): string[] {
  return value.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token));
}

function titleTokens(value: string): Set<string> {
  return new Set(cleanSearchWords(value));
}

function isApplePhoneOrTablet(input: MarketSearchInput): boolean {
  const identity = [input.brand, input.model, input.title, input.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\biphone\b|\bipad\b/.test(identity);
}

function isAppleDeviceAccessoryTitle(input: MarketSearchInput, listingTitle: string): boolean {
  if (!isApplePhoneOrTablet(input)) return false;
  const normalized = listingTitle.toLowerCase().replace(/[^a-z0-9+\- ]+/g, " ");

  return APPLE_DEVICE_ACCESSORY_TERMS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalized);
  });
}

function titleMatchScore(input: MarketSearchInput, listingTitle: string, index: number): number {
  const titleTarget = titleTokens(input.title);
  const candidate = titleTokens(listingTitle);
  const brandTokens = titleTokens(input.brand ?? "");
  const modelTokens = titleTokens(input.model ?? "");

  const overlapRatio = (target: Set<string>) => {
    if (target.size === 0) return 1;
    let matched = 0;
    for (const token of target) if (candidate.has(token)) matched += 1;
    return matched / target.size;
  };

  const titleOverlap = overlapRatio(titleTarget);
  const brandOverlap = overlapRatio(brandTokens);
  const modelOverlap = overlapRatio(modelTokens);
  const positionPenalty = Math.min(0.10, index * 0.0025);

  const identityWeight = modelTokens.size > 0 ? 0.42 : brandTokens.size > 0 ? 0.28 : 0;
  const brandWeight = brandTokens.size > 0 ? 0.20 : 0;
  const titleWeight = Math.max(0.38, 1 - identityWeight - brandWeight);
  const weighted = titleOverlap * titleWeight + brandOverlap * brandWeight + modelOverlap * identityWeight;
  return Math.max(0.30, Math.min(0.99, 0.34 + weighted * 0.64 - positionPenalty));
}

function uniqueQueries(input: MarketSearchInput): string[] {
  const cleanTitle = cleanSearchWords(input.title).slice(0, 8).join(" ");
  const productFamily = cleanSearchWords(input.title).slice(0, 5).join(" ");
  const raw = [
    [input.brand, input.model, input.title].filter(Boolean).join(" "),
    [input.brand, input.model].filter(Boolean).join(" "),
    [input.brand, cleanTitle].filter(Boolean).join(" "),
    [input.brand, productFamily].filter(Boolean).join(" "),
    cleanTitle,
  ];
  return [...new Set(raw.map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 5);
}

export class EbayMarketProvider implements MarketProvider {
  private token: { value: string; expiresAt: number } | null = null;

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) {
      throw new ApiError(500, "provider_not_configured", "EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required when MARKET_PROVIDER=ebay.");
    }
    const basic = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
    const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    });
    if (!response.ok) throw new ApiError(502, "ebay_auth_failed", `eBay authentication failed with status ${response.status}.`, true);
    const body = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private async searchQuery(token: string, query: string): Promise<z.infer<typeof ItemSummary>[]> {
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", query.slice(0, 200));
    url.searchParams.set("limit", "50");
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": env.EBAY_MARKETPLACE_ID,
        "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DCA",
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new ApiError(502, "ebay_search_failed", `eBay search failed with status ${response.status}.`, true, { detail: detail.slice(0, 500) });
    }
    return SearchResponse.parse(await response.json()).itemSummaries;
  }

  async search(input: MarketSearchInput) {
    const token = await this.getToken();
    const queries = uniqueQueries(input);
    const collected = new Map<string, z.infer<typeof ItemSummary>>();
    const attempts: string[] = [];
    const appleDeviceSearch = isApplePhoneOrTablet(input);
    let accessoryListingsRemoved = 0;

    for (const query of queries) {
      attempts.push(query);
      const items = await this.searchQuery(token, query);
      for (const item of items) {
        if (appleDeviceSearch && isAppleDeviceAccessoryTitle(input, item.title)) {
          accessoryListingsRemoved += 1;
          continue;
        }
        collected.set(item.itemId, item);
      }

      // For phones/tablets, count only actual device-looking results before stopping.
      // The previous raw-result threshold could stop after the first query when most
      // of those results were cases or repair parts, leaving almost no usable comps.
      const targetCandidateCount = appleDeviceSearch ? 18 : 24;
      if (collected.size >= targetCandidateCount) break;
    }

    const comparables = [...collected.values()].flatMap((item, index) => {
      if (item.price.currency !== input.displayCurrency) return [];
      // Keep this second guard in case a future query path bypasses collection filtering.
      if (isAppleDeviceAccessoryTitle(input, item.title)) {
        accessoryListingsRemoved += 1;
        return [];
      }
      const shipping = item.shippingOptions?.[0]?.shippingCost;
      const shippingMinor = shipping?.currency === input.displayCurrency ? toMinor(shipping.value) : 0;
      const priceMinor = toMinor(item.price.value);
      return [{
        source: "ebay",
        sourceReference: item.itemId,
        title: item.title,
        brand: input.brand,
        model: input.model,
        category: input.category,
        condition: mapCondition(item.condition),
        listingStatus: "active" as const,
        eventDate: item.itemEndDate ?? null,
        priceOriginalAmountMinor: priceMinor,
        priceOriginalCurrency: item.price.currency,
        shippingOriginalAmountMinor: shippingMinor,
        shippingOriginalCurrency: input.displayCurrency,
        totalDisplayAmountMinor: priceMinor + shippingMinor,
        displayCurrency: input.displayCurrency,
        matchScore: titleMatchScore(input, item.title, index),
        attributes: {
          buying_options: item.buyingOptions ?? [],
          condition_id: item.conditionId ?? null,
          source_url: item.itemWebUrl ?? null,
          search_attempts: attempts,
        },
        sourceUrl: item.itemWebUrl ?? null,
      }];
    });

    return {
      comparables,
      warnings: [
        "eBay Browse API results are active listings, not verified sold prices.",
        `Progressive marketplace search used ${attempts.length} query level${attempts.length === 1 ? "" : "s"}.`,
        ...(accessoryListingsRemoved > 0
          ? [`Filtered ${accessoryListingsRemoved} likely iPhone/iPad accessory or replacement-part listing${accessoryListingsRemoved === 1 ? "" : "s"}.`]
          : []),
        "Cross-currency listings are excluded until an FX provider is connected.",
      ],
      freshnessAt: new Date().toISOString(),
    };
  }
}
