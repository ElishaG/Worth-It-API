import { mapDatabaseError, notFound } from "../lib/errors.js";
import { serviceSupabase } from "../lib/supabase.js";
import type { Database, Json } from "../database.types.js";

type ScanRow = Database["public"]["Tables"]["scans"]["Row"];
type ItemRow = Database["public"]["Tables"]["scan_items"]["Row"];
type AnalysisRow = Database["public"]["Tables"]["scan_analyses"]["Row"];

function money(amount: number | null, currency: string | null): Json | null {
  return amount === null || currency === null ? null : { amount_minor: amount, currency };
}

function mapItem(item: ItemRow | null): Json | null {
  if (!item) return null;
  return {
    title: item.title,
    brand: item.brand,
    model: item.model,
    category: item.category,
    condition: item.condition,
    attributes: item.attributes,
    accessories: item.accessories,
    repair_cost: money(item.repair_cost_amount_minor, item.repair_cost_currency),
    inbound_shipping: money(item.inbound_shipping_amount_minor, item.inbound_shipping_currency),
    outbound_shipping: money(item.outbound_shipping_amount_minor, item.outbound_shipping_currency),
    taxes_paid: money(item.taxes_paid_amount_minor, item.taxes_paid_currency),
    other_acquisition_costs: money(item.other_acquisition_costs_amount_minor, item.other_acquisition_costs_currency),
    notes: item.notes,
    recognition_confidence: item.recognition_confidence,
    user_confirmed: item.user_confirmed,
  };
}

function mapAnalysis(analysis: AnalysisRow | null): Json | null {
  if (!analysis) return null;
  const currency = analysis.display_currency;
  return {
    id: analysis.id,
    revision: analysis.revision,
    worth_score: analysis.worth_score,
    confidence: analysis.confidence,
    quick_return: money(analysis.quick_return_amount_minor, currency),
    normal_return: money(analysis.normal_return_amount_minor, currency),
    maximum_return: money(analysis.maximum_return_amount_minor, currency),
    total_cash_invested: money(analysis.total_cash_invested_amount_minor, currency),
    estimated_net_profit: money(analysis.estimated_net_profit_amount_minor, currency),
    roi_percent: analysis.roi_percent,
    maximum_buy_price: money(analysis.maximum_buy_price_amount_minor, currency),
    comparable_count: analysis.comparable_count,
    data_freshness_at: analysis.freshness_at,
    calculation_version: analysis.calculation_version,
    assumptions: analysis.assumptions,
    warnings: analysis.warnings,
  };
}

async function getPrimaryImage(userId: string, scanId: string): Promise<{ image_url: string | null; image_count: number }> {
  const { data: images, error } = await serviceSupabase
    .from("scan_images")
    .select("storage_bucket, storage_path")
    .eq("scan_id", scanId)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true });
  if (error) throw mapDatabaseError(error);
  const first = images?.[0];
  if (!first) return { image_url: null, image_count: 0 };
  const { data: signed, error: signedError } = await serviceSupabase.storage
    .from(first.storage_bucket)
    .createSignedUrl(first.storage_path, 60 * 60);
  if (signedError) throw mapDatabaseError(signedError);
  return { image_url: signed?.signedUrl ?? null, image_count: images?.length ?? 0 };
}

export async function getOwnedScan(userId: string, scanId: string): Promise<ScanRow> {
  const { data, error } = await serviceSupabase
    .from("scans")
    .select("*")
    .eq("id", scanId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw notFound("Scan");
  return data;
}

export async function getScanResponse(userId: string, scanId: string): Promise<Json> {
  const scan = await getOwnedScan(userId, scanId);
  const [{ data: item, error: itemError }, { data: analysis, error: analysisError }, image] = await Promise.all([
    serviceSupabase.from("scan_items").select("*").eq("scan_id", scanId).eq("user_id", userId).maybeSingle(),
    scan.current_analysis_revision > 0
      ? serviceSupabase.from("scan_analyses").select("*").eq("scan_id", scanId).eq("user_id", userId).eq("revision", scan.current_analysis_revision).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    getPrimaryImage(userId, scanId),
  ]);
  if (itemError) throw mapDatabaseError(itemError);
  if (analysisError) throw mapDatabaseError(analysisError);

  return {
    id: scan.id,
    status: scan.status,
    status_reason: scan.status_reason,
    image_url: image.image_url,
    image_count: image.image_count,
    input: {
      preferred_currency: scan.preferred_currency,
      purchase_price: money(scan.purchase_price_amount_minor, scan.purchase_price_currency),
      category_hint: scan.category_hint,
      source_context: scan.source_context,
    },
    item: mapItem(item),
    analysis: mapAnalysis(analysis),
    created_at: scan.created_at,
    updated_at: scan.updated_at,
  };
}

export async function listScanResponses(userId: string, limit: number, before?: string): Promise<Json[]> {
  let query = serviceSupabase
    .from("scans")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw mapDatabaseError(error);
  return Promise.all((data ?? []).map(({ id }) => getScanResponse(userId, id)));
}
