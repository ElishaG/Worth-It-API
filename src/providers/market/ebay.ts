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
  "wireless", "controller", "console", "edition", "colour", "color",
]);

function titleTokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token)),
  );
}

function titleMatchScore(input: MarketSearchInput, listingTitle: string, index: number): number {
  const target = titleTokens([input.brand, input.model, input.title].filter(Boolean).join(" "));
  const candidate = titleTokens(listingTitle);
  if (target.size === 0) return Math.max(0.5, 0.84 - index * 0.008);

  let matched = 0;
  for (const token of target) if (candidate.has(token)) matched += 1;
  const overlap = matched / target.size;
  const positionPenalty = Math.min(0.12, index * 0.003);
  return Math.max(0.35, Math.min(0.98, 0.48 + overlap * 0.5 - positionPenalty));
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
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    });
    if (!response.ok) {
      throw new ApiError(502, "ebay_auth_failed", `eBay authentication failed with status ${response.status}.`, true);
    }
    const body = z.object({ access_token: z.string(), expires_in: z.number() }).parse(await response.json());
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  async search(input: MarketSearchInput) {
    const token = await this.getToken();
    const query = [input.brand, input.model, input.title].filter(Boolean).join(" ").slice(0, 200);
    const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
    url.searchParams.set("q", query);
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

    const parsed = SearchResponse.parse(await response.json());
    const comparables = parsed.itemSummaries.flatMap((item, index) => {
      if (item.price.currency !== input.displayCurrency) return [];
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
        },
        sourceUrl: item.itemWebUrl ?? null,
      }];
    });

    return {
      comparables,
      warnings: [
        "eBay Browse API results are active listings, not verified sold prices.",
        "Cross-currency listings are excluded until an FX provider is connected.",
      ],
      freshnessAt: new Date().toISOString(),
    };
  }
}
