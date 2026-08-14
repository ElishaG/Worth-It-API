import type { FastifyPluginAsync } from "fastify";
import { mapDatabaseError } from "../lib/errors.js";
import { serviceSupabase } from "../lib/supabase.js";

export const referenceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/currencies", async () => {
    const { data, error } = await serviceSupabase
      .from("currencies")
      .select("code, display_name, symbol, minor_units")
      .eq("enabled", true)
      .order("code");
    if (error) throw mapDatabaseError(error);
    return { items: data ?? [] };
  });

  app.get("/categories", async () => {
    const { data, error } = await serviceSupabase
      .from("supported_categories")
      .select("code, display_name, sort_order")
      .eq("enabled", true)
      .order("sort_order");
    if (error) throw mapDatabaseError(error);
    return { items: data ?? [] };
  });
};
