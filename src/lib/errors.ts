import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function notFound(resource = "Resource"): ApiError {
  return new ApiError(404, "not_found", `${resource} not found.`);
}

export function mapDatabaseError(error: unknown): ApiError {
  const value = error as { code?: string; message?: string; details?: string };
  const message = value?.message ?? "Database operation failed.";
  switch (value?.code) {
    case "42501":
      return new ApiError(403, "forbidden", message);
    case "P0001":
      return new ApiError(402, "scan_entitlement_required", message);
    case "P0002":
      return new ApiError(404, "not_found", message);
    case "23505":
      return new ApiError(409, "conflict", message);
    case "23514":
      return new ApiError(409, "invalid_state", message);
    case "55P03":
      return new ApiError(409, "request_in_progress", message, true);
    case "22023":
      return new ApiError(400, "invalid_request", message);
    default:
      return new ApiError(500, "database_error", message, true, { database_code: value?.code });
  }
}

export function sendError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const apiError = error instanceof ApiError
    ? error
    : error instanceof ZodError
      ? new ApiError(400, "invalid_request", "The request parameters are invalid.", false, { issues: error.issues })
      : new ApiError(500, "internal_error", "An unexpected error occurred.", true);
  if (!(error instanceof ApiError) && !(error instanceof ZodError)) {
    request.log.error({ err: error }, "Unhandled request error");
  }
  void reply.status(apiError.statusCode).send({
    error: {
      code: apiError.code,
      message: apiError.message,
      retryable: apiError.retryable,
      details: apiError.details,
    },
    request_id: request.id,
    timestamp: new Date().toISOString(),
  });
}
