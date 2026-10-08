import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./errors.js";

export const ADMOB_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
const CACHE_MS = 6 * 60 * 60 * 1000;
const REFRESH_COOLDOWN_MS = 60_000;

const KeySetSchema = z.object({ keys: z.array(z.object({
  keyId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  pem: z.string().min(1).max(4096),
})).min(1).max(20) });

function invalidCallback(): ApiError {
  return new ApiError(400, "invalid_admob_callback", "The AdMob callback parameters are invalid.");
}

// Google sends a numeric ad-unit ID in SSV, while the SDK uses the full ID.
export function normalizeAdUnit(value: string): string {
  const match = /^(?:ca-app-pub-\d+\/)?(\d+)$/.exec(value);
  if (!match) throw invalidCallback();
  return match[1]!;
}

export type VerifiedAdMobReward = {
  challengeId: string;
  challengeToken: string;
  userId: string;
  transactionId: string;
  rewardedAt: string;
  adUnit: string;
  rewardItem: string;
  rewardAmount: number;
};

/** Uses only Google's pinned HTTPS key server; callback input cannot choose a URL. */
export class AdMobVerifier {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = -Infinity;
  private attemptedAt = -Infinity;
  private refresh: Promise<void> | undefined;

  constructor(
    private readonly fetchKeys: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async loadKeys(): Promise<void> {
    if (this.refresh) return this.refresh;
    this.attemptedAt = this.now();
    this.refresh = (async () => {
      try {
        const response = await this.fetchKeys(ADMOB_KEYS_URL, {
          signal: AbortSignal.timeout(5000), redirect: "error",
        });
        if (!response.ok) throw new Error("Key server unavailable");
        const text = await response.text();
        if (text.length > 65_536) throw new Error("Key response too large");
        const data = KeySetSchema.parse(JSON.parse(text));
        const keys = new Map<string, KeyObject>();
        for (const entry of data.keys) {
          const key = createPublicKey(entry.pem);
          if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
            throw new Error("Unexpected key type");
          }
          keys.set(String(entry.keyId), key);
        }
        this.keys = keys;
        this.fetchedAt = this.now();
      } catch {
        throw new ApiError(503, "admob_keys_unavailable", "AdMob signing keys are temporarily unavailable.", true);
      }
    })();
    try { await this.refresh; } finally { this.refresh = undefined; }
  }

  async verifyCallback(rawUrl: string, allowedAdUnits: string[]): Promise<VerifiedAdMobReward> {
    if (allowedAdUnits.length === 0) {
      throw new ApiError(503, "admob_not_configured", "AdMob rewarded ad units are not configured.");
    }
    const query = rawUrl.slice(rawUrl.indexOf("?") + 1);
    if (!rawUrl.includes("?") || query.length > 16_384 || query.includes("#")) throw invalidCallback();
    // Do not reserialize, reorder, or form-decode the signed content. Google/Tink
    // uses URI.getQuery(): percent-decode once, preserving literal '+' characters.
    const tail = /^(.*)&signature=([A-Za-z0-9_-]+={0,2})&key_id=(\d+)$/.exec(query);
    if (!tail || !tail[1]) throw invalidCallback();
    let signedContent: string;
    const params = new Map<string, string>();
    try {
      signedContent = decodeURIComponent(tail[1]);
      for (const part of query.split("&")) {
        const separator = part.indexOf("=");
        const name = part.slice(0, separator);
        if (separator < 1 || !/^[a-z_]+$/.test(name) || params.has(name)) throw invalidCallback();
        params.set(name, decodeURIComponent(part.slice(separator + 1)));
      }
    } catch { throw invalidCallback(); }

    const keyId = tail[3]!;
    const stale = this.now() - this.fetchedAt >= CACHE_MS;
    if (stale && this.now() - this.attemptedAt < REFRESH_COOLDOWN_MS && !this.refresh) {
      throw new ApiError(503, "admob_keys_unavailable", "AdMob signing keys are temporarily unavailable.", true);
    }
    if (this.refresh || stale || (!this.keys.has(keyId) && this.now() - this.attemptedAt >= REFRESH_COOLDOWN_MS)) {
      await this.loadKeys();
    }
    const key = this.keys.get(keyId);
    const signature = Buffer.from(tail[2]!, "base64url");
    let validSignature = false;
    try { validSignature = Boolean(key) && signature.length >= 8 && verify("sha256", Buffer.from(signedContent, "utf8"), key!, signature); }
    catch { /* Malformed DER is an invalid signature, never an internal error. */ }
    if (!validSignature) {
      throw new ApiError(401, "invalid_admob_signature", "The AdMob signature is invalid.");
    }

    const parsed = z.object({
      ad_unit: z.string().min(1),
      ad_network: z.string().regex(/^\d+$/),
      reward_amount: z.literal("1"),
      reward_item: z.literal("scan"),
      timestamp: z.string().regex(/^\d+$/),
      transaction_id: z.string().regex(/^[a-fA-F0-9]{16,256}$/),
      user_id: z.string().uuid(),
      custom_data: z.string().min(1).max(2048),
    }).safeParse(Object.fromEntries(params));
    if (!parsed.success) throw invalidCallback();
    const body = parsed.data;
    const adUnit = normalizeAdUnit(body.ad_unit);
    if (!allowedAdUnits.some((unit) => normalizeAdUnit(unit) === adUnit)) {
      throw new ApiError(403, "admob_ad_unit_not_allowed", "This AdMob ad unit is not permitted.");
    }
    let custom: { challenge_id: string; challenge_token: string };
    try {
      custom = z.object({
        challenge_id: z.string().uuid(), challenge_token: z.string().min(1).max(256),
      }).strict().parse(JSON.parse(body.custom_data));
    } catch { throw invalidCallback(); }
    const timestamp = Number(body.timestamp);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > 8.64e15) throw invalidCallback();
    return {
      challengeId: custom.challenge_id, challengeToken: custom.challenge_token,
      userId: body.user_id, transactionId: body.transaction_id,
      rewardedAt: new Date(timestamp).toISOString(), adUnit,
      rewardItem: body.reward_item, rewardAmount: 1,
    };
  }
}

export const adMobVerifier = new AdMobVerifier();
