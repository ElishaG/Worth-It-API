import { env } from "../config/env.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { sha256, stableJson } from "../lib/hash.js";
import { serviceSupabase } from "../lib/supabase.js";
import { createMarketProvider } from "../providers/market/index.js";
import { createRecognitionProvider } from "../providers/recognition/index.js";
import { calculateAnalysis, type CalculationPreferences } from "../services/calculationService.js";
import type { Database, Json } from "../database.types.js";

export type AnalysisJob = Database["public"]["Tables"]["analysis_jobs"]["Row"];

const recognitionProvider = createRecognitionProvider();
const marketProvider = createMarketProvider();

async function markJobSucceeded(jobId: string): Promise<void> {
  const { error } = await serviceSupabase.from("analysis_jobs").update({
    status: "succeeded",
    finished_at: new Date().toISOString(),
    lease_expires_at: null,
    error_code: null,
    error_detail: null,
  }).eq("id", jobId);
  if (error) throw mapDatabaseError(error);
}

async function recordProviderOperation(input: {
  job: AnalysisJob;
  provider: string;
  operation: string;
  status: "succeeded" | "failed";
  startedAt: number;
  errorCode?: string;
}): Promise<void> {
  await serviceSupabase.from("provider_operations").upsert({
    user_id: input.job.user_id,
    scan_id: input.job.scan_id,
    job_id: input.job.id,
    provider: input.provider,
    operation: input.operation,
    operation_key: `${input.operation}:${input.job.id}:${input.job.attempt_count}`,
    status: input.status,
    request_fingerprint: input.job.request_hash,
    attempt_count: input.job.attempt_count,
    duration_ms: Date.now() - input.startedAt,
    error_code: input.errorCode ?? null,
    payload_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  }, { onConflict: "operation_key" });
}

async function processIdentification(job: AnalysisJob): Promise<void> {
  const startedAt = Date.now();
  const { data: scan, error: scanError } = await serviceSupabase.from("scans").select("*").eq("id", job.scan_id).eq("user_id", job.user_id).single();
  if (scanError) throw mapDatabaseError(scanError);
  const { data: images, error: imageError } = await serviceSupabase.from("scan_images").select("storage_bucket, storage_path").eq("scan_id", job.scan_id).eq("user_id", job.user_id).eq("upload_status", "verified").order("sort_order");
  if (imageError) throw mapDatabaseError(imageError);
  if (!images?.length) throw new ApiError(400, "verified_images_required", "No verified scan images were found.");

  const imageUrls: string[] = [];
  for (const image of images) {
    const { data, error } = await serviceSupabase.storage.from(image.storage_bucket).createSignedUrl(image.storage_path, 600);
    if (error || !data) throw new ApiError(502, "signed_image_url_failed", error?.message ?? "Could not create image URL.", true);
    imageUrls.push(data.signedUrl);
  }
  const barcode = scan.status_reason?.startsWith("barcode:") ? scan.status_reason.slice("barcode:".length) : undefined;
  const candidates = await recognitionProvider.identify({ scanId: scan.id, imageUrls, barcode, categoryHint: scan.category_hint });

  const { error: deleteError } = await serviceSupabase.from("recognition_candidates").delete().eq("scan_id", scan.id).eq("user_id", job.user_id);
  if (deleteError) throw mapDatabaseError(deleteError);
  const { error: insertError } = await serviceSupabase.from("recognition_candidates").insert(candidates.map((candidate, index) => ({
    user_id: job.user_id,
    scan_id: scan.id,
    candidate_key: candidate.candidateKey,
    rank: index + 1,
    title: candidate.title,
    brand: candidate.brand,
    model: candidate.model,
    category: candidate.category,
    condition: candidate.condition,
    attributes: candidate.attributes,
    accessories_seen: candidate.accessoriesSeen,
    uncertainties: candidate.uncertainties,
    confidence: candidate.confidence,
    provider: candidate.provider,
    provider_model: candidate.providerModel,
    prompt_version: candidate.promptVersion,
  })));
  if (insertError) throw mapDatabaseError(insertError);

  const top = candidates[0];
  if (!top) throw new ApiError(502, "recognition_empty", "No recognition candidate was returned.", true);
  const { data: existing } = await serviceSupabase.from("scan_items").select("*").eq("scan_id", scan.id).eq("user_id", job.user_id).maybeSingle();
  const { error: itemError } = await serviceSupabase.from("scan_items").upsert({
    user_id: job.user_id,
    scan_id: scan.id,
    candidate_id: top.candidateKey,
    title: top.title,
    brand: top.brand,
    model: top.model,
    category: top.category === "other" ? (scan.category_hint ?? "other") : top.category,
    condition: top.condition,
    attributes: top.attributes,
    accessories: top.accessoriesSeen,
    recognition_confidence: top.confidence,
    user_confirmed: false,
    repair_cost_amount_minor: existing?.repair_cost_amount_minor ?? null,
    repair_cost_currency: existing?.repair_cost_currency ?? null,
    inbound_shipping_amount_minor: existing?.inbound_shipping_amount_minor ?? null,
    inbound_shipping_currency: existing?.inbound_shipping_currency ?? null,
    outbound_shipping_amount_minor: existing?.outbound_shipping_amount_minor ?? null,
    outbound_shipping_currency: existing?.outbound_shipping_currency ?? null,
    taxes_paid_amount_minor: existing?.taxes_paid_amount_minor ?? null,
    taxes_paid_currency: existing?.taxes_paid_currency ?? null,
    other_acquisition_costs_amount_minor: existing?.other_acquisition_costs_amount_minor ?? null,
    other_acquisition_costs_currency: existing?.other_acquisition_costs_currency ?? null,
    notes: existing?.notes ?? null,
  }, { onConflict: "scan_id" });
  if (itemError) throw mapDatabaseError(itemError);

  const { error: statusError } = await serviceSupabase.from("scans").update({ status: "ready", status_reason: null }).eq("id", scan.id).eq("user_id", job.user_id);
  if (statusError) throw mapDatabaseError(statusError);
  await markJobSucceeded(job.id);
  await recordProviderOperation({ job, provider: candidates[0]?.provider ?? "unknown", operation: "identification", status: "succeeded", startedAt });
}

function preferencesFromAttributes(attributes: Json): CalculationPreferences {
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) return {};
  const raw = (attributes as Record<string, Json | undefined>).analysis_preferences;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const object = raw as Record<string, Json | undefined>;
  const targetProfit = typeof object.target_profit_amount_minor === "number" ? object.target_profit_amount_minor : undefined;
  const targetRoi = typeof object.target_roi_percent === "number" ? object.target_roi_percent : undefined;
  return {
    ...(targetProfit !== undefined ? { targetProfitAmountMinor: targetProfit } : {}),
    ...(targetRoi !== undefined ? { targetRoiPercent: targetRoi } : {}),
  };
}

async function processMarketAnalysis(job: AnalysisJob): Promise<void> {
  const startedAt = Date.now();
  const [{ data: scan, error: scanError }, { data: item, error: itemError }] = await Promise.all([
    serviceSupabase.from("scans").select("*").eq("id", job.scan_id).eq("user_id", job.user_id).single(),
    serviceSupabase.from("scan_items").select("*").eq("scan_id", job.scan_id).eq("user_id", job.user_id).single(),
  ]);
  if (scanError) throw mapDatabaseError(scanError);
  if (itemError) throw mapDatabaseError(itemError);
  if (scan.status === "cancelled") {
    await serviceSupabase.from("analysis_jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), lease_expires_at: null }).eq("id", job.id);
    return;
  }

  const marketResult = await marketProvider.search({
    title: item.title,
    brand: item.brand,
    model: item.model,
    category: item.category,
    condition: item.condition,
    displayCurrency: scan.preferred_currency,
    purchasePriceAmountMinor: scan.purchase_price_amount_minor,
  });
  const calculation = calculateAnalysis({
    scan,
    item,
    comparables: marketResult.comparables,
    providerWarnings: marketResult.warnings,
    preferences: preferencesFromAttributes(item.attributes),
  });

  let analysisId: string;
  const { data: existingAnalysis, error: existingError } = await serviceSupabase.from("scan_analyses").select("id").eq("scan_id", scan.id).eq("revision", job.analysis_revision).maybeSingle();
  if (existingError) throw mapDatabaseError(existingError);
  if (existingAnalysis) {
    analysisId = existingAnalysis.id;
  } else {
    const { data: analysis, error: analysisError } = await serviceSupabase.from("scan_analyses").insert({
      user_id: job.user_id,
      scan_id: scan.id,
      revision: job.analysis_revision,
      display_currency: scan.preferred_currency,
      worth_score: calculation.worthScore,
      confidence: calculation.confidence,
      quick_return_amount_minor: calculation.quickReturnAmountMinor,
      normal_return_amount_minor: calculation.normalReturnAmountMinor,
      maximum_return_amount_minor: calculation.maximumReturnAmountMinor,
      total_cash_invested_amount_minor: calculation.totalCashInvestedAmountMinor,
      estimated_net_profit_amount_minor: calculation.estimatedNetProfitAmountMinor,
      roi_percent: calculation.roiPercent,
      maximum_buy_price_amount_minor: calculation.maximumBuyPriceAmountMinor,
      comparable_count: calculation.comparableCount,
      included_sold_count: calculation.includedSoldCount,
      included_active_count: calculation.includedActiveCount,
      freshness_at: marketResult.freshnessAt,
      calculation_version: "worth-score-v2.0",
      fee_assumption_version: "environment-v1",
      recognition_snapshot: {
        title: item.title,
        brand: item.brand,
        model: item.model,
        category: item.category,
        condition: item.condition,
        recognition_confidence: item.recognition_confidence,
      },
      input_snapshot: {
        scan_id: scan.id,
        purchase_price_amount_minor: scan.purchase_price_amount_minor,
        purchase_price_currency: scan.purchase_price_currency,
        item_costs: {
          repair: item.repair_cost_amount_minor,
          inbound_shipping: item.inbound_shipping_amount_minor,
          outbound_shipping: item.outbound_shipping_amount_minor,
          taxes: item.taxes_paid_amount_minor,
          other: item.other_acquisition_costs_amount_minor,
        },
      },
      assumptions: calculation.assumptions,
      score_components: calculation.scoreComponents,
      warnings: calculation.warnings,
    }).select("id").single();
    if (analysisError) throw mapDatabaseError(analysisError);
    analysisId = analysis.id;
  }

  const comparableRows = calculation.includedComparables.map((comparable) => ({
    user_id: job.user_id,
    scan_id: scan.id,
    analysis_id: analysisId,
    source: comparable.source,
    source_reference: comparable.sourceReference,
    source_url_hash: comparable.sourceUrl ? sha256(comparable.sourceUrl) : null,
    title: comparable.title,
    brand: comparable.brand,
    model: comparable.model,
    category: comparable.category,
    condition: comparable.condition,
    attributes: comparable.sourceUrl
      ? { ...(comparable.attributes as Record<string, Json>), source_url: comparable.sourceUrl }
      : comparable.attributes,
    listing_status: comparable.listingStatus,
    price_original_amount_minor: comparable.priceOriginalAmountMinor,
    price_original_currency: comparable.priceOriginalCurrency,
    shipping_original_amount_minor: comparable.shippingOriginalAmountMinor,
    shipping_original_currency: comparable.shippingOriginalCurrency,
    total_display_amount_minor: comparable.totalDisplayAmountMinor,
    display_currency: comparable.displayCurrency,
    event_date: comparable.eventDate,
    listing_age_days: comparable.eventDate ? Math.max(0, Math.floor((Date.now() - new Date(comparable.eventDate).getTime()) / 86_400_000)) : null,
    match_score: comparable.matchScore,
    decision: comparable.decision,
    exclusion_reason: comparable.exclusionReason,
    deduplication_key: sha256(stableJson({ source: comparable.source, reference: comparable.sourceReference })),
    raw_payload_retention_until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  }));
  if (comparableRows.length) {
    const { error: comparableError } = await serviceSupabase.from("market_comparables").upsert(comparableRows, { onConflict: "analysis_id,source,source_reference", ignoreDuplicates: true });
    if (comparableError) throw mapDatabaseError(comparableError);
  }

  const { error: consumeError } = await serviceSupabase.rpc("consume_scan_reservation", { p_scan_id: scan.id, p_analysis_revision: job.analysis_revision });
  if (consumeError) throw mapDatabaseError(consumeError);
  const { error: statusError } = await serviceSupabase.from("scans").update({ status: "completed", status_reason: null }).eq("id", scan.id).eq("user_id", job.user_id);
  if (statusError) throw mapDatabaseError(statusError);
  await markJobSucceeded(job.id);
  await recordProviderOperation({ job, provider: env.MARKET_PROVIDER, operation: "market_analysis", status: "succeeded", startedAt });
}

export async function processJob(job: AnalysisJob): Promise<void> {
  if (job.job_type === "identification") return processIdentification(job);
  return processMarketAnalysis(job);
}

export async function handleJobFailure(job: AnalysisJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown worker error";
  const code = error instanceof ApiError ? error.code : "worker_error";
  const shouldRetry = job.attempt_count < job.max_attempts;

  const { error: jobError } = await serviceSupabase.from("analysis_jobs").update({
    status: shouldRetry ? "queued" : "failed",
    error_code: code,
    error_detail: message.slice(0, 4_000),
    lease_expires_at: null,
    finished_at: shouldRetry ? null : new Date().toISOString(),
  }).eq("id", job.id);
  if (jobError) console.error("Failed to update job failure state", jobError);

  await recordProviderOperation({
    job,
    provider: job.job_type === "identification" ? env.RECOGNITION_PROVIDER : env.MARKET_PROVIDER,
    operation: job.job_type,
    status: "failed",
    startedAt: Date.now(),
    errorCode: code,
  });

  if (!shouldRetry) {
    const failureStatus = job.job_type === "identification" ? "identification_failed" : "analysis_failed";
    await serviceSupabase.from("scans").update({ status: failureStatus, status_reason: message.slice(0, 1_000) }).eq("id", job.scan_id).eq("user_id", job.user_id);
    if (job.job_type === "market_analysis") {
      await serviceSupabase.rpc("release_scan_reservation", {
        p_scan_id: job.scan_id,
        p_analysis_revision: job.analysis_revision,
        p_reason: code,
      });
    }
  }
}
