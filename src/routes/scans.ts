import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth, requireIdempotencyKey } from "../lib/auth.js";
import { ApiError, mapDatabaseError } from "../lib/errors.js";
import { sha256, stableJson } from "../lib/hash.js";
import { runIdempotent } from "../lib/idempotency.js";
import { createUserSupabase, serviceSupabase } from "../lib/supabase.js";
import { CurrencySchema, MoneySchema, UuidSchema, parseBody } from "../lib/validation.js";
import { getOwnedScan, getScanResponse, listScanResponses } from "../services/scanService.js";
import type { Json } from "../database.types.js";

const sourceContexts = ["thrift_store", "marketplace", "garage_sale", "swap_meet", "other"] as const;
const conditions = ["new", "open_box", "like_new", "excellent", "good", "fair", "poor", "for_parts", "unknown"] as const;

const CreateScanBody = z.object({
  preferred_currency: CurrencySchema,
  purchase_price: MoneySchema.optional(),
  category_hint: z.string().min(1).max(100).optional(),
  source_context: z.enum(sourceContexts).optional(),
});

const UploadBody = z.object({
  files: z.array(z.object({
    content_type: z.enum(["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]),
    size_bytes: z.number().int().positive().max(12_582_912),
    filename: z.string().max(255).optional(),
  })).min(1).max(6),
});

const ItemBody = z.object({
  title: z.string().min(1).max(300),
  brand: z.string().max(150).nullable().optional(),
  model: z.string().max(150).nullable().optional(),
  category: z.string().min(1).max(100),
  condition: z.enum(conditions),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  accessories: z.array(z.string().max(200)).max(30).default([]),
  repair_cost: MoneySchema.optional(),
  inbound_shipping: MoneySchema.optional(),
  outbound_shipping: MoneySchema.optional(),
  taxes_paid: MoneySchema.optional(),
  other_acquisition_costs: MoneySchema.optional(),
  notes: z.string().max(2_000).nullable().optional(),
});

function extensionFor(contentType: string, filename?: string): string {
  const fromName = filename ? extname(filename).toLowerCase() : "";
  if ([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"].includes(fromName)) return fromName;
  return ({
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
  } as Record<string, string>)[contentType] ?? ".jpg";
}

async function checkScanEntitlement(userId: string): Promise<void> {
  const { data, error } = await serviceSupabase
    .from("account_entitlements")
    .select("available_scan_credits, premium_active, premium_expires_at")
    .eq("user_id", userId)
    .single();
  if (error) throw mapDatabaseError(error);
  const premium = data.premium_active && (!data.premium_expires_at || new Date(data.premium_expires_at) > new Date());
  if (!premium && data.available_scan_credits <= 0) {
    throw new ApiError(402, "scan_entitlement_required", "No free scan credits remain. Watch a rewarded ad or upgrade to Premium.");
  }
}

export const scanRoutes: FastifyPluginAsync = async (app) => {
  app.post("/scans", { preHandler: requireAuth }, async (request, reply) => {
    const body = parseBody(CreateScanBody, request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: "/scans",
      key,
      requestBody: body,
      execute: async () => {
        await checkScanEntitlement(request.auth.userId);
        const { data, error } = await serviceSupabase
          .from("scans")
          .insert({
            user_id: request.auth.userId,
            preferred_currency: body.preferred_currency,
            purchase_price_amount_minor: body.purchase_price?.amount_minor ?? null,
            purchase_price_currency: body.purchase_price?.currency ?? null,
            category_hint: body.category_hint ?? null,
            source_context: body.source_context ?? null,
          })
          .select("id")
          .single();
        if (error) throw mapDatabaseError(error);
        return {
          status: 201,
          body: await getScanResponse(request.auth.userId, data.id),
          resourceType: "scan",
          resourceId: data.id,
        };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.get("/scans", { preHandler: requireAuth }, async (request) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().optional() }).parse(request.query);
    const items = await listScanResponses(request.auth.userId, query.limit, query.before);
    return { items, next_cursor: items.length === query.limit ? (items.at(-1) as Record<string, Json>)?.created_at ?? null : null };
  });

  app.get("/scans/:scan_id", { preHandler: requireAuth }, async (request) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    return getScanResponse(request.auth.userId, scan_id);
  });

  app.delete("/scans/:scan_id", { preHandler: requireAuth }, async (request, reply) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/scans/${scan_id}`,
      key,
      requestBody: { scan_id },
      execute: async () => {
        const scan = await getOwnedScan(request.auth.userId, scan_id);
        if (scan.status === "analyzing") {
          await serviceSupabase.rpc("release_scan_reservation", {
            p_scan_id: scan.id,
            p_analysis_revision: scan.current_analysis_revision,
            p_reason: "scan_deleted",
          });
        }
        const { data: images, error: imageError } = await serviceSupabase.from("scan_images").select("storage_bucket, storage_path").eq("scan_id", scan_id).eq("user_id", request.auth.userId);
        if (imageError) throw mapDatabaseError(imageError);
        const grouped = new Map<string, string[]>();
        for (const image of images ?? []) grouped.set(image.storage_bucket, [...(grouped.get(image.storage_bucket) ?? []), image.storage_path]);
        for (const [bucket, paths] of grouped) await serviceSupabase.storage.from(bucket).remove(paths);
        const { error } = await serviceSupabase.from("scans").delete().eq("id", scan_id).eq("user_id", request.auth.userId);
        if (error) throw mapDatabaseError(error);
        return { status: 204, body: { deleted: true } };
      },
    });
    return result.status === 204 ? reply.status(204).send() : reply.status(result.status).send(result.body);
  });

  app.post("/scans/:scan_id/upload-urls", { preHandler: requireAuth }, async (request, reply) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const body = parseBody(UploadBody, request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/scans/${scan_id}/upload-urls`,
      key,
      requestBody: body,
      execute: async () => {
        const scan = await getOwnedScan(request.auth.userId, scan_id);
        if (!["draft", "uploaded", "identification_failed"].includes(scan.status)) {
          throw new ApiError(409, "invalid_scan_state", "Images cannot be added in the scan's current state.");
        }
        const { count, error: countError } = await serviceSupabase.from("scan_images").select("id", { count: "exact", head: true }).eq("scan_id", scan_id);
        if (countError) throw mapDatabaseError(countError);
        if ((count ?? 0) + body.files.length > 6) throw new ApiError(400, "too_many_images", "A scan can contain at most 6 images.");

        const uploads: Json[] = [];
        for (const [offset, file] of body.files.entries()) {
          const imageId = randomUUID();
          const objectPath = `${request.auth.userId}/${scan_id}/${imageId}${extensionFor(file.content_type, file.filename)}`;
          const sortOrder = (count ?? 0) + offset;
          const { error: insertError } = await serviceSupabase.from("scan_images").insert({
            id: imageId,
            user_id: request.auth.userId,
            scan_id,
            storage_bucket: "scan-images",
            storage_path: objectPath,
            original_filename: file.filename ?? null,
            mime_type: file.content_type,
            byte_size: file.size_bytes,
            sort_order: sortOrder,
          });
          if (insertError) throw mapDatabaseError(insertError);
          const { data: signed, error: signedError } = await serviceSupabase.storage.from("scan-images").createSignedUploadUrl(objectPath);
          if (signedError || !signed) {
            await serviceSupabase.from("scan_images").delete().eq("id", imageId);
            throw new ApiError(502, "upload_url_failed", signedError?.message ?? "Could not create signed upload URL.", true);
          }
          uploads.push({
            image_id: imageId,
            upload_url: signed.signedUrl,
            upload_token: signed.token,
            object_path: objectPath,
            expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          });
        }
        return { status: 200, body: { uploads } };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.post("/scans/:scan_id/identify", { preHandler: requireAuth }, async (request, reply) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const body = parseBody(z.object({ barcode: z.string().max(100).optional() }), request.body ?? {});
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/scans/${scan_id}/identify`,
      key,
      requestBody: body,
      execute: async () => {
        const scan = await getOwnedScan(request.auth.userId, scan_id);
        if (!["draft", "uploaded", "identification_failed"].includes(scan.status)) {
          throw new ApiError(409, "invalid_scan_state", "The scan cannot be identified in its current state.");
        }
        const { data: images, error: imageError } = await serviceSupabase.from("scan_images").select("id, storage_path").eq("scan_id", scan_id).eq("user_id", request.auth.userId).order("sort_order");
        if (imageError) throw mapDatabaseError(imageError);
        if (!images?.length) throw new ApiError(400, "images_required", "Upload at least one image before identification.");

        const { data: objects, error: listError } = await serviceSupabase.storage.from("scan-images").list(`${request.auth.userId}/${scan_id}`, { limit: 100 });
        if (listError) throw new ApiError(502, "storage_check_failed", listError.message, true);
        const objectNames = new Set((objects ?? []).map((object) => object.name));
        const uploadedIds = images.filter((image) => objectNames.has(image.storage_path.split("/").at(-1) ?? "")).map((image) => image.id);
        if (!uploadedIds.length) throw new ApiError(400, "uploads_incomplete", "The image upload has not completed yet.");
        const { error: verifyError } = await serviceSupabase.from("scan_images").update({ upload_status: "verified", verified_at: new Date().toISOString() }).in("id", uploadedIds);
        if (verifyError) throw mapDatabaseError(verifyError);

        if (scan.status === "draft") {
          const { error } = await serviceSupabase.from("scans").update({ status: "uploaded" }).eq("id", scan_id);
          if (error) throw mapDatabaseError(error);
        }
        const { error: statusError } = await serviceSupabase.from("scans").update({ status: "identifying", status_reason: body.barcode ? `barcode:${body.barcode}` : null }).eq("id", scan_id);
        if (statusError) throw mapDatabaseError(statusError);

        const { data: existing, error: existingError } = await serviceSupabase.from("analysis_jobs").select("id").eq("scan_id", scan_id).eq("analysis_revision", 0).eq("job_type", "identification").maybeSingle();
        if (existingError) throw mapDatabaseError(existingError);
        let jobId = existing?.id;
        if (jobId) {
          const { error } = await serviceSupabase.from("analysis_jobs").update({ status: "queued", attempt_count: 0, error_code: null, error_detail: null, finished_at: null, lease_expires_at: null, idempotency_key: key, request_hash: sha256(stableJson(body)) }).eq("id", jobId);
          if (error) throw mapDatabaseError(error);
        } else {
          const { data, error } = await serviceSupabase.from("analysis_jobs").insert({
            user_id: request.auth.userId,
            scan_id,
            analysis_revision: 0,
            job_type: "identification",
            operation_key: `identification:${scan_id}:0`,
            idempotency_key: key,
            request_hash: sha256(stableJson(body)),
          }).select("id").single();
          if (error) throw mapDatabaseError(error);
          jobId = data.id;
        }
        return { status: 202, body: { ...(await getScanResponse(request.auth.userId, scan_id) as Record<string, Json>), job_id: jobId } };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.patch("/scans/:scan_id/item", { preHandler: requireAuth }, async (request, reply) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const body = parseBody(ItemBody, request.body);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/scans/${scan_id}/item`,
      key,
      requestBody: body,
      execute: async () => {
        const scan = await getOwnedScan(request.auth.userId, scan_id);
        if (!["uploaded", "identifying", "ready", "identification_failed"].includes(scan.status)) {
          throw new ApiError(409, "invalid_scan_state", "Item details cannot be changed in the scan's current state.");
        }
        const now = new Date().toISOString();
        if (scan.status === "identification_failed") {
          const { error } = await serviceSupabase.from("scans").update({ status: "identifying" }).eq("id", scan_id);
          if (error) throw mapDatabaseError(error);
        }
        const { error } = await serviceSupabase.from("scan_items").upsert({
          user_id: request.auth.userId,
          scan_id,
          title: body.title,
          brand: body.brand ?? null,
          model: body.model ?? null,
          category: body.category,
          condition: body.condition,
          attributes: body.attributes,
          accessories: body.accessories,
          repair_cost_amount_minor: body.repair_cost?.amount_minor ?? null,
          repair_cost_currency: body.repair_cost?.currency ?? null,
          inbound_shipping_amount_minor: body.inbound_shipping?.amount_minor ?? null,
          inbound_shipping_currency: body.inbound_shipping?.currency ?? null,
          outbound_shipping_amount_minor: body.outbound_shipping?.amount_minor ?? null,
          outbound_shipping_currency: body.outbound_shipping?.currency ?? null,
          taxes_paid_amount_minor: body.taxes_paid?.amount_minor ?? null,
          taxes_paid_currency: body.taxes_paid?.currency ?? null,
          other_acquisition_costs_amount_minor: body.other_acquisition_costs?.amount_minor ?? null,
          other_acquisition_costs_currency: body.other_acquisition_costs?.currency ?? null,
          notes: body.notes ?? null,
          user_confirmed: true,
          confirmed_at: now,
        }, { onConflict: "scan_id" });
        if (error) throw mapDatabaseError(error);
        if (scan.status !== "ready") {
          const { error: statusError } = await serviceSupabase.from("scans").update({ status: "ready", status_reason: null }).eq("id", scan_id);
          if (statusError) throw mapDatabaseError(statusError);
        }
        return { status: 200, body: await getScanResponse(request.auth.userId, scan_id) };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.post("/scans/:scan_id/analyze", { preHandler: requireAuth }, async (request, reply) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const body = parseBody(z.object({ target_profit: MoneySchema.optional(), target_roi_percent: z.number().min(0).max(10_000).optional() }), request.body ?? {});
    const key = requireIdempotencyKey(request);
    const scan = await getOwnedScan(request.auth.userId, scan_id);
    if (body.target_profit && body.target_profit.currency !== scan.preferred_currency) {
      throw new ApiError(400, "currency_mismatch", "target_profit must use the scan's preferred currency.");
    }
    const { data: item, error: itemError } = await serviceSupabase.from("scan_items").select("attributes").eq("scan_id", scan_id).eq("user_id", request.auth.userId).single();
    if (itemError) throw mapDatabaseError(itemError);
    const attributes = item.attributes && typeof item.attributes === "object" && !Array.isArray(item.attributes) ? item.attributes as Record<string, Json | undefined> : {};
    const { error: preferenceError } = await serviceSupabase.from("scan_items").update({
      attributes: {
        ...attributes,
        analysis_preferences: {
          target_profit_amount_minor: body.target_profit?.amount_minor ?? null,
          target_roi_percent: body.target_roi_percent ?? null,
        },
      },
    }).eq("scan_id", scan_id).eq("user_id", request.auth.userId);
    if (preferenceError) throw mapDatabaseError(preferenceError);

    const userClient = createUserSupabase(request.auth.accessToken);
    const { error } = await userClient.rpc("begin_market_analysis", {
      p_scan_id: scan_id,
      p_idempotency_key: key,
      p_request_hash: sha256(stableJson(body)),
    });
    if (error) throw mapDatabaseError(error);
    return reply.status(202).send(await getScanResponse(request.auth.userId, scan_id));
  });

  app.post("/scans/:scan_id/cancel", { preHandler: requireAuth }, async (request, reply) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const key = requireIdempotencyKey(request);
    const result = await runIdempotent({
      userId: request.auth.userId,
      endpoint: `/scans/${scan_id}/cancel`,
      key,
      requestBody: {},
      execute: async () => {
        const scan = await getOwnedScan(request.auth.userId, scan_id);
        if (["completed", "cancelled"].includes(scan.status)) return { status: 200, body: await getScanResponse(request.auth.userId, scan_id) };
        const { error: jobError } = await serviceSupabase.from("analysis_jobs").update({ status: "cancelled", finished_at: new Date().toISOString(), lease_expires_at: null }).eq("scan_id", scan_id).in("status", ["queued", "running"]);
        if (jobError) throw mapDatabaseError(jobError);
        if (scan.status === "analyzing") {
          const { error: releaseError } = await serviceSupabase.rpc("release_scan_reservation", {
            p_scan_id: scan.id,
            p_analysis_revision: scan.current_analysis_revision,
            p_reason: "user_cancelled",
          });
          if (releaseError) throw mapDatabaseError(releaseError);
        }
        const { error } = await serviceSupabase.from("scans").update({ status: "cancelled", status_reason: "user_cancelled" }).eq("id", scan_id);
        if (error) throw mapDatabaseError(error);
        return { status: 200, body: await getScanResponse(request.auth.userId, scan_id) };
      },
    });
    return reply.status(result.status).send(result.body);
  });

  app.get("/scans/:scan_id/comparables", { preHandler: requireAuth }, async (request) => {
    const { scan_id } = z.object({ scan_id: UuidSchema }).parse(request.params);
    const scan = await getOwnedScan(request.auth.userId, scan_id);
    if (scan.current_analysis_revision < 1) return { items: [], data_freshness_at: null };
    const { data: analysis, error: analysisError } = await serviceSupabase.from("scan_analyses").select("id, freshness_at").eq("scan_id", scan_id).eq("revision", scan.current_analysis_revision).eq("user_id", request.auth.userId).single();
    if (analysisError) throw mapDatabaseError(analysisError);
    const { data, error } = await serviceSupabase.from("market_comparables").select("*").eq("analysis_id", analysis.id).eq("user_id", request.auth.userId).order("match_score", { ascending: false });
    if (error) throw mapDatabaseError(error);
    return {
      items: (data ?? []).map((item) => ({
        id: item.id,
        source: item.source,
        source_reference: item.source_reference,
        title: item.title,
        condition: item.condition,
        price_original: { amount_minor: item.price_original_amount_minor, currency: item.price_original_currency },
        shipping_original: item.shipping_original_amount_minor === null ? null : { amount_minor: item.shipping_original_amount_minor, currency: item.shipping_original_currency },
        price_display: { amount_minor: item.total_display_amount_minor, currency: item.display_currency },
        status: item.listing_status,
        decision: item.decision,
        exclusion_reason: item.exclusion_reason,
        event_date: item.event_date,
        match_score: item.match_score,
        source_url: item.attributes && typeof item.attributes === "object" && !Array.isArray(item.attributes)
          ? ((item.attributes as Record<string, Json>).source_url as string | null ?? null)
          : null,
      })),
      data_freshness_at: analysis.freshness_at,
    };
  });
};
