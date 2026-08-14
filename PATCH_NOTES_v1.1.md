# Worth It API — Pricing & Clickable Comparables v1.1

## Included changes

- Adds each eBay listing's `itemWebUrl` to the comparable API response as `source_url`.
- Preserves the URL inside the comparable `attributes` JSON when storing results.
- Improves eBay title-match scoring using recognized brand/model/title tokens.
- Excludes mismatched variants, bundles, accessories, parts/repair listings, and incompatible conditions.
- Removes extreme high and low prices with an IQR outlier filter.
- Uses at most the 20 strongest accepted comparables.
- Uses a filtered median rather than a raw average.
- Applies a 0.92 adjustment when all data comes from active asking prices.
- Sets quick sale to 80% of the filtered median.
- Caps the high estimate at the lower of the upper quartile or 125% of the median.
- Returns zero estimates with a warning when fewer than three strong comparables remain.
- Updates the calculation version to `worth-score-v2.0`.

## Mobile-app requirement

The mobile comparable card should read `source_url` from `GET /scans/:scan_id/comparables` and open it using React Native `Linking.openURL`. The mobile source code was not included in this archive, so that UI change is not part of this package.

## Install

Copy these updated files into the matching locations in the live API project, or replace the project with this folder while preserving your private `.env`:

- `src/providers/market/ebay.ts`
- `src/services/calculationService.ts`
- `src/worker/processJob.ts`
- `src/routes/scans.ts`
- `tests/calculation.test.ts`

Then run:

```powershell
npm.cmd run check
```

Restart both processes:

```powershell
npm.cmd run dev
npm.cmd run dev:worker
```

Run a new scan rather than reopening an old analysis, because existing comparable rows were calculated with the previous version.
