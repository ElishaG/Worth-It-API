import { ApiError, mapDatabaseError, notFound } from "../lib/errors.js";
import { serviceSupabase } from "../lib/supabase.js";
import type { Database, Json } from "../database.types.js";

type SummaryRow = Database["public"]["Views"]["inventory_item_summaries"]["Row"];

export async function requireInventoryRead(userId: string): Promise<void> {
  const { data, error } = await serviceSupabase.rpc("can_read_inventory", { p_user_id: userId });
  if (error) throw mapDatabaseError(error);
  if (!data) throw new ApiError(403, "premium_required", "Inventory access is unavailable for this account.");
}

export async function requireActivePremium(userId: string): Promise<void> {
  const { data, error } = await serviceSupabase.rpc("is_premium_active", { p_user_id: userId });
  if (error) throw mapDatabaseError(error);
  if (!data) throw new ApiError(403, "premium_required", "An active Premium subscription is required.");
}

async function signedImageForScan(userId: string, scanId: string | null): Promise<string | null> {
  if (!scanId) return null;
  const { data: image, error } = await serviceSupabase
    .from("scan_images")
    .select("storage_bucket, storage_path")
    .eq("scan_id", scanId)
    .eq("user_id", userId)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!image) return null;
  const { data: signed, error: signedError } = await serviceSupabase.storage
    .from(image.storage_bucket)
    .createSignedUrl(image.storage_path, 60 * 60);
  if (signedError) throw mapDatabaseError(signedError);
  return signed?.signedUrl ?? null;
}

async function estimatedValueForAnalysis(
  userId: string,
  analysisId: string | null,
): Promise<{ amount_minor: number; currency: string } | null> {
  if (!analysisId) return null;
  const { data, error } = await serviceSupabase
    .from("scan_analyses")
    .select("normal_return_amount_minor, display_currency")
    .eq("id", analysisId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) return null;
  return {
    amount_minor: data.normal_return_amount_minor,
    currency: data.display_currency,
  };
}

function money(amountMinor: number | null, currency: string | null): Json {
  if (amountMinor === null || currency === null) return null;
  return { amount_minor: amountMinor, currency };
}

export async function mapInventory(userId: string, row: SummaryRow): Promise<Json> {
  const [imageUrl, estimatedValue] = await Promise.all([
    signedImageForScan(userId, row.scan_id),
    estimatedValueForAnalysis(userId, row.source_analysis_id),
  ]);

  const costBasis = row.cost_basis_amount_minor === null || row.currency === null
    ? null
    : { amount_minor: row.cost_basis_amount_minor, currency: row.currency };

  const estimatedProfit = estimatedValue && costBasis && estimatedValue.currency === costBasis.currency
    ? { amount_minor: estimatedValue.amount_minor - costBasis.amount_minor, currency: costBasis.currency }
    : null;

  return {
    id: row.id,
    scan_id: row.scan_id,
    image_url: imageUrl,
    source_analysis_id: row.source_analysis_id,
    status: row.status,
    title: row.title,
    category: row.category,
    condition: row.condition,
    cost_basis: costBasis,
    estimated_value: estimatedValue,
    estimated_profit: estimatedProfit,
    listing_price: money(row.listing_price_amount_minor, row.currency),
    listing_platform: row.listing_platform,
    listing_reference: row.listing_reference,
    purchase_date: row.purchase_date,
    listing_date: row.listing_date,
    sale_date: row.sale_date,
    sale_price: money(row.sale_price_amount_minor, row.currency),
    marketplace_fees: money(row.marketplace_fees_amount_minor, row.currency),
    outbound_shipping: money(row.outbound_shipping_amount_minor, row.currency),
    other_selling_costs: money(row.other_selling_costs_amount_minor, row.currency),
    realized_profit: money(row.realized_profit_amount_minor, row.currency),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getInventorySummary(userId: string, id: string): Promise<Json> {
  const { data, error } = await serviceSupabase
    .from("inventory_item_summaries")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw mapDatabaseError(error);
  if (!data) throw notFound("Inventory item");
  return mapInventory(userId, data);
}
