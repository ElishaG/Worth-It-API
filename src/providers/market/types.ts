import type { Database, Json } from "../../database.types.js";

export type MarketComparable = {
  source: string;
  sourceReference: string;
  title: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  condition: Database["public"]["Enums"]["item_condition"];
  listingStatus: Database["public"]["Enums"]["market_listing_status"];
  eventDate: string | null;
  priceOriginalAmountMinor: number;
  priceOriginalCurrency: string;
  shippingOriginalAmountMinor: number | null;
  shippingOriginalCurrency: string | null;
  totalDisplayAmountMinor: number;
  displayCurrency: string;
  matchScore: number;
  attributes: Json;
  sourceUrl: string | null;
};

export type MarketSearchInput = {
  title: string;
  brand: string | null;
  model: string | null;
  category: string;
  condition: Database["public"]["Enums"]["item_condition"];
  displayCurrency: string;
  purchasePriceAmountMinor: number | null;
};

export type MarketSearchResult = {
  comparables: MarketComparable[];
  warnings: string[];
  freshnessAt: string;
};

export interface MarketProvider {
  search(input: MarketSearchInput): Promise<MarketSearchResult>;
}
