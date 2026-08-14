# Provider status

## Working now in mock mode

The complete scan state machine, queue worker, database writes, Worth Score calculation, scan-credit reservation/consumption/release, inventory routes, and webhook endpoints are implemented. Mock recognition and mock marketplace providers let the full workflow run without paid API credentials.

## Live OpenAI recognition

Set:

```env
RECOGNITION_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.6
```

The worker sends private, short-lived Supabase signed image URLs to the OpenAI Responses API and requests strict structured output.

## Live eBay active listings

Set:

```env
MARKET_PROVIDER=ebay
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
EBAY_MARKETPLACE_ID=EBAY_CA
```

The included adapter uses the eBay Browse API. Browse provides active listings. It does not by itself provide verified sold-price history, so the result carries a warning and the confidence score remains conservative. A sold-comparables provider must be approved and connected before production claims are made.

## Currency conversion

The live eBay adapter currently excludes listings whose currency differs from the scan display currency. Connect an approved FX data provider before enabling multi-currency marketplace aggregation in production.

## Marketplace fees

The database intentionally contains no seeded marketplace fee assumptions. Local mock calculations use the environment values. Replace them with reviewed, dated fee records before production.
