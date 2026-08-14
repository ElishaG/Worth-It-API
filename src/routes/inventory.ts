import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireIdempotencyKey } from "../lib/auth.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { runIdempotent } from "../lib/idempotency.js";
import { createUserSupabase, serviceSupabase } from "../lib/supabase.js";
import { MoneySchema, UuidSchema, parseBody } from "../lib/validation.js";
import { getInventorySummary, mapInventory, requireInventoryRead } from "../services/inventoryService.js";

const CreateInventoryBody = z.object({
  scan_id: UuidSchema.optional(),
  title: z.string().min(1).max(300).optional(),
  cost_basis: MoneySchema,
  purchase_date: z.string().date().default(() => new Date().toISOString().slice(0, 10)),
  condition: z.enum(["new", "open_box", "like_new", "excellent", "good", "fair", "poor", "for_parts", "unknown"]).default("unknown"),
  category: z.string().max(100).nullable().optional(),
  notes: z.string().max(2_000).nullable().optional(),
}).refine((value) => value.scan_id || value.title, "scan_id or title is required.");

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get("/inventory", { preHandler: requireAuth }, async (request) => {
    await requireInventoryRead(request.auth.userId);
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), status: z.enum(["acquired", "listed", "sold", "archived"]).optional() }).parse(request.query);
    let builder = serviceSupabase
      .from("inventory_item_summaries")
      .select("*")
      .eq("user_id", request.auth.userId)
      .order("created_at", { ascending: false })
      .limit(query.limit);
    if (query.status) builder = builder.eq("status", query.status);
    const { data, error } = await builder;
    if (error) throw mapDatabaseError(error);
    return { items: await Promise.all((data ?? []).map((row) => mapInventory(request.auth.userId, row))), next_cursor: null };
  });

  app.get("/inventory/:inventory_id", { preHandler: requireAuth }, async (request) => {
    await requireInventoryRead(request.auth.userId);
    const { inventory_id } = z.object({ inventory_id: UuidSchema }).parse(request.params);
    return getInventorySummary(request.auth.userId, inventory_id);
  });

  app.post("/inventory", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(CreateInventoryBody, request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/inventory",
      key,
      requestBody: body,
      execute: async () => {
        let title = body.title ?? null;
        let category = body.category ?? null;
        let condition = body.condition;
        let sourceAnalysisId: string | null = null;
        if (body.scan_id) {
          const { data: scan, error: scanError } = await serviceSupabase.from("scans").select("id, current_analysis_revision").eq("id", body.scan_id).eq("user_id", request.auth.userId).maybeSingle();
          if (scanError) throw mapDatabaseError(scanError);
          if (!scan) throw new ApiError(404, "scan_not_found", "Scan not found.");
          const { data: item, error: itemError } = await serviceSupabase.from("scan_items").select("title, category, condition").eq("scan_id", body.scan_id).eq("user_id", request.auth.userId).maybeSingle();
          if (itemError) throw mapDatabaseError(itemError);
          title ??= item?.title ?? null;
          category ??= item?.category ?? null;
          condition = item?.condition ?? condition;
          if (scan.current_analysis_revision > 0) {
            const { data: analysis } = await serviceSupabase.from("scan_analyses").select("id").eq("scan_id", body.scan_id).eq("revision", scan.current_analysis_revision).eq("user_id", request.auth.userId).maybeSingle();
            sourceAnalysisId = analysis?.id ?? null;
          }
        }
        if (!title) throw new ApiError(400, "title_required", "A title is required for the inventory item.");
        const { data, error } = await serviceSupabase.from("inventory_items").insert({
          user_id: request.auth.userId,
          scan_id: body.scan_id ?? null,
          source_analysis_id: sourceAnalysisId,
          title,
          category,
          condition,
          cost_basis_amount_minor: body.cost_basis.amount_minor,
          cost_basis_components: { entered_total: body.cost_basis.amount_minor },
          currency: body.cost_basis.currency,
          purchase_date: body.purchase_date,
          notes: body.notes ?? null,
        }).select("id").single();
        if (error) throw mapDatabaseError(error);
        return { status: 201, body: await getInventorySummary(request.auth.userId, data.id), resourceType: "inventory_item", resourceId: data.id };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.patch("/inventory/:inventory_id", { preHandler: requireAuth }, async (request, reply) => {
    const { inventory_id } = z.object({ inventory_id: UuidSchema }).parse(request.params);
    const body = parseBody(z.object({
      status: z.enum(["acquired", "listed", "sold", "archived"]).optional(),
      listing_price: MoneySchema.optional(),
      listing_platform: z.string().max(100).nullable().optional(),
      listing_reference: z.string().max(500).nullable().optional(),
      listing_date: z.string().date().nullable().optional(),
      notes: z.string().max(2_000).nullable().optional(),
    }).refine((value) => Object.keys(value).length > 0, "At least one field is required."), request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/inventory/${inventory_id}`,
      key,
      requestBody: body,
      execute: async () => {
        const { data: existing, error: existingError } = await serviceSupabase.from("inventory_items").select("currency").eq("id", inventory_id).eq("user_id", request.auth.userId).maybeSingle();
        if (existingError) throw mapDatabaseError(existingError);
        if (!existing) throw new ApiError(404, "inventory_not_found", "Inventory item not found.");
        if (body.listing_price && body.listing_price.currency !== existing.currency) throw new ApiError(400, "currency_mismatch", "Listing price must use the inventory item's currency.");
        if (body.status === "sold") throw new ApiError(400, "use_sale_endpoint", "Use the /sale endpoint to mark an item as sold.");
        const { error } = await serviceSupabase.from("inventory_items").update({
          status: body.status,
          listing_price_amount_minor: body.listing_price?.amount_minor,
          listing_platform: body.listing_platform,
          listing_reference: body.listing_reference,
          listing_date: body.listing_date,
          notes: body.notes,
        }).eq("id", inventory_id).eq("user_id", request.auth.userId);
        if (error) throw mapDatabaseError(error);
        return { status: 200, body: await getInventorySummary(request.auth.userId, inventory_id) };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.delete("/inventory/:inventory_id", { preHandler: requireAuth }, async (request, reply) => {
    const { inventory_id } = z.object({ inventory_id: UuidSchema }).parse(request.params);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/inventory/${inventory_id}`,
      key,
      requestBody: { inventory_id },
      execute: async () => {
        const { error } = await serviceSupabase.from("inventory_items").delete().eq("id", inventory_id).eq("user_id", request.auth.userId);
        if (error) throw mapDatabaseError(error);
        return { status: 204, body: { deleted: true } };
      },
    });
    return result.status === 204 ? reply.status(204).send() : reply.status(result.status).send(result.body);
  });

  app.post("/inventory/:inventory_id/sale", { preHandler: requireAuth }, async (request, reply) => {
    const { inventory_id } = z.object({ inventory_id: UuidSchema }).parse(request.params);
    const body = parseBody(z.object({
      sale_price: MoneySchema,
      sale_date: z.string().date(),
      marketplace_fees: MoneySchema.optional(),
      outbound_shipping: MoneySchema.optional(),
      other_costs: MoneySchema.optional(),
      platform: z.string().max(100).nullable().optional(),
      transaction_reference: z.string().max(500).nullable().optional(),
    }), request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/inventory/${inventory_id}/sale`,
      key,
      requestBody: body,
      execute: async () => {
        for (const amount of [body.marketplace_fees, body.outbound_shipping, body.other_costs]) {
          if (amount && amount.currency !== body.sale_price.currency) throw new ApiError(400, "currency_mismatch", "All sale amounts must use one currency.");
        }
        const userClient = createUserSupabase(request.auth.accessToken);
        const { error } = await userClient.rpc("record_inventory_sale", {
          p_inventory_item_id: inventory_id,
          p_sale_price_amount_minor: body.sale_price.amount_minor,
          p_marketplace_fees_amount_minor: body.marketplace_fees?.amount_minor ?? 0,
          p_outbound_shipping_amount_minor: body.outbound_shipping?.amount_minor ?? 0,
          p_other_selling_costs_amount_minor: body.other_costs?.amount_minor ?? 0,
          p_sale_date: body.sale_date,
          p_platform: body.platform ?? "",
          p_transaction_reference: body.transaction_reference ?? "",
        });
        if (error) throw mapDatabaseError(error);
        return { status: 200, body: await getInventorySummary(request.auth.userId, inventory_id) };
      },
    });
    return reply.status(result.status).send(result.body);
  });
};
