import { env } from "../../config/env.js";
import { EbayMarketProvider } from "./ebay.js";
import { MockMarketProvider } from "./mock.js";
import type { MarketProvider } from "./types.js";

export function createMarketProvider(): MarketProvider {
  return env.MARKET_PROVIDER === "ebay" ? new EbayMarketProvider() : new MockMarketProvider();
}
