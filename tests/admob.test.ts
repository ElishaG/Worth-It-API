import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AdMobVerifier, ADMOB_KEYS_URL } from "../src/lib/admob.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const user = "00000000-0000-4000-8000-000000000001";
const challenge = "00000000-0000-4000-8000-000000000002";
const keyResponse = (id = 1234) => new Response(JSON.stringify({ keys: [{ keyId: id, pem }] }));

export function callback(overrides: Record<string, string> = {}, keyId = 1234): string {
  const params = {
    ad_network: "5450213213286189855", ad_unit: "8982386338",
    custom_data: JSON.stringify({ challenge_id: challenge, challenge_token: "hello+world&signature=literal" }),
    reward_amount: "1", reward_item: "scan", timestamp: String(Date.now()),
    transaction_id: "abcdef0123456789abcdef0123456789", user_id: user, ...overrides,
  };
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  // Match Google's official Tink verifier and its percent-escaped-query test.
  const signature = sign("sha256", Buffer.from(decodeURIComponent(query)), privateKey).toString("base64url");
  return `/v1/webhooks/admob/ssv?${query}&signature=${signature}&key_id=${keyId}`;
}

describe("AdMob ECDSA verification", () => {
  it("verifies SHA256/DER and decodes custom data once without changing plus signs", async () => {
    const fetcher = vi.fn(async () => keyResponse());
    const verifier = new AdMobVerifier(fetcher);
    const result = await verifier.verifyCallback(callback(), ["ca-app-pub-7651425836406503/8982386338"]);
    expect(result.challengeId).toBe(challenge);
    expect(result.challengeToken).toBe("hello+world&signature=literal");
    expect(result.transactionId).toBe("abcdef0123456789abcdef0123456789");
    await verifier.verifyCallback(callback(), ["8982386338"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(ADMOB_KEYS_URL);
  });

  it("rejects changes to reward amount, custom data, user, transaction, and order", async () => {
    const verifier = new AdMobVerifier(async () => keyResponse());
    const url = callback();
    const invalid = [url.replace("reward_amount=1", "reward_amount=2"),
      url.replace(user, challenge), url.replace("abcdef0123456789", "1111111111111111"),
      url.replace("hello", "bye"), url.replace("ad_network=5450213213286189855&ad_unit=8982386338", "ad_unit=8982386338&ad_network=5450213213286189855")];
    for (const changed of invalid) await expect(verifier.verifyCallback(changed, ["8982386338"])).rejects.toMatchObject({ statusCode: 401 });
  });

  it.each([
    ["unapproved unit", { ad_unit: "111" }], ["wrong reward item", { reward_item: "coins" }],
    ["wrong amount", { reward_amount: "2" }], ["missing custom data", { custom_data: "" }],
    ["bad custom JSON", { custom_data: "{}" }], ["bad transaction", { transaction_id: "client-fake" }],
    ["bad user", { user_id: "other" }], ["bad timestamp", { timestamp: "Infinity" }],
  ])("rejects signed but invalid %s", async (_name, overrides) => {
    const verifier = new AdMobVerifier(async () => keyResponse());
    await expect(verifier.verifyCallback(callback(overrides), ["8982386338"])).rejects.toBeDefined();
  });

  it("rejects duplicate fields, trailing data, missing signature, and malformed escapes", async () => {
    const verifier = new AdMobVerifier(async () => keyResponse());
    for (const url of [callback() + "&user_id=" + user, callback().replace("?ad_network", "?user_id=" + user + "&ad_network"),
      callback().replace(/&signature=.*$/, ""), callback().replace("hello", "%ZZ")]) {
      await expect(verifier.verifyCallback(url, ["8982386338"])).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it("refreshes rotated keys with a cooldown and bounds cache lifetime", async () => {
    let now = 0;
    const fetcher = vi.fn().mockImplementationOnce(async () => keyResponse())
      .mockImplementation(async () => keyResponse(5678));
    const verifier = new AdMobVerifier(fetcher, () => now);
    await verifier.verifyCallback(callback(), ["8982386338"]);
    await expect(verifier.verifyCallback(callback({}, 5678), ["8982386338"])).rejects.toMatchObject({ statusCode: 401 });
    now = 61_000;
    await verifier.verifyCallback(callback({}, 5678), ["8982386338"]);
    now += 6 * 60 * 60 * 1000;
    await verifier.verifyCallback(callback({}, 5678), ["8982386338"]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("fails closed on key server failure or non-EC key material", async () => {
    const offline = new AdMobVerifier(async () => new Response("offline", { status: 503 }));
    await expect(offline.verifyCallback(callback(), ["8982386338"])).rejects.toMatchObject({ statusCode: 503, retryable: true });
    const invalid = new AdMobVerifier(async () => new Response(JSON.stringify({ keys: [{ keyId: 1234, pem: "invalid" }] })));
    await expect(invalid.verifyCallback(callback(), ["8982386338"])).rejects.toMatchObject({ statusCode: 503 });
    await expect(offline.verifyCallback(callback(), [])).rejects.toMatchObject({ code: "admob_not_configured" });
  });
});
