import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";
import { authSupabase } from "./supabase.js";

function readBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "A valid Bearer token is required.");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiError(401, "unauthorized", "A valid Bearer token is required.");
  }
  return token;
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const accessToken = readBearerToken(request);
  const { data, error } = await authSupabase.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new ApiError(401, "unauthorized", "The access token is invalid or expired.");
  }
  request.auth = { userId: data.user.id, accessToken };
}

export function requireIdempotencyKey(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || value.length < 16 || value.length > 128) {
    throw new ApiError(400, "invalid_idempotency_key", "Idempotency-Key must contain 16 to 128 characters.");
  }
  return value;
}
