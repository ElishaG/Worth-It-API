import { ApiError, mapDatabaseError } from "./errors.js";
import { serviceSupabase } from "./supabase.js";
import { sha256, stableJson } from "./hash.js";
import type { Json } from "../database.types.js";

export type IdempotentResult<T extends Json> = {
  status: number;
  body: T;
  resourceType?: string;
  resourceId?: string;
};

export async function runIdempotent<T extends Json>(input: {
  userId: string;
  endpoint: string;
  key: string;
  requestBody: unknown;
  execute: () => Promise<IdempotentResult<T>>;
}): Promise<IdempotentResult<T>> {
  const requestHash = sha256(stableJson(input.requestBody));
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const lockedUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const { data: inserted, error: insertError } = await serviceSupabase
    .from("idempotency_records")
    .insert({
      user_id: input.userId,
      endpoint: input.endpoint,
      idempotency_key: input.key,
      request_hash: requestHash,
      expires_at: expiresAt,
      locked_until: lockedUntil,
    })
    .select("id, request_hash, response_status, response_body, locked_until")
    .maybeSingle();

  if (insertError && insertError.code !== "23505") throw mapDatabaseError(insertError);

  let record = inserted;
  if (!record) {
    const { data, error } = await serviceSupabase
      .from("idempotency_records")
      .select("id, request_hash, response_status, response_body, locked_until")
      .eq("user_id", input.userId)
      .eq("endpoint", input.endpoint)
      .eq("idempotency_key", input.key)
      .single();
    if (error) throw mapDatabaseError(error);
    record = data;

    if (record.request_hash !== requestHash) {
      throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    if (record.response_body !== null && record.response_status !== null) {
      return { status: record.response_status, body: record.response_body as T };
    }
    if (record.locked_until && new Date(record.locked_until).getTime() > Date.now()) {
      throw new ApiError(409, "request_in_progress", "The matching request is still being processed.", true);
    }

    const { error: lockError } = await serviceSupabase
      .from("idempotency_records")
      .update({ locked_until: lockedUntil })
      .eq("id", record.id);
    if (lockError) throw mapDatabaseError(lockError);
  }

  try {
    const result = await input.execute();
    const { error } = await serviceSupabase
      .from("idempotency_records")
      .update({
        response_status: result.status,
        response_body: result.body,
        resource_type: result.resourceType ?? null,
        resource_id: result.resourceId ?? null,
        completed_at: new Date().toISOString(),
        locked_until: null,
      })
      .eq("id", record.id);
    if (error) throw mapDatabaseError(error);
    return result;
  } catch (error) {
    await serviceSupabase
      .from("idempotency_records")
      .update({ locked_until: null })
      .eq("id", record.id);
    throw error;
  }
}
