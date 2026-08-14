import { env } from "../config/env.js";
import { mapDatabaseError } from "../lib/errors.js";
import { serviceSupabase } from "../lib/supabase.js";
import { handleJobFailure, processJob, type AnalysisJob } from "./processJob.js";

let stopping = false;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function claimJob(): Promise<AnalysisJob | null> {
  const { data, error } = await serviceSupabase.rpc("claim_analysis_job", {
    p_worker_name: env.WORKER_NAME,
    p_lease_seconds: env.WORKER_LEASE_SECONDS,
  });
  if (error) throw mapDatabaseError(error);
  return data?.[0] ?? null;
}

async function main(): Promise<void> {
  console.log(`[worker] ${env.WORKER_NAME} started with recognition=${env.RECOGNITION_PROVIDER}, market=${env.MARKET_PROVIDER}`);
  while (!stopping) {
    try {
      const job = await claimJob();
      if (!job) {
        await sleep(env.WORKER_POLL_INTERVAL_MS);
        continue;
      }
      console.log(`[worker] processing ${job.job_type} job ${job.id} attempt ${job.attempt_count}/${job.max_attempts}`);
      try {
        await processJob(job);
        console.log(`[worker] completed job ${job.id}`);
      } catch (error) {
        console.error(`[worker] job ${job.id} failed`, error);
        await handleJobFailure(job, error);
      }
    } catch (error) {
      console.error("[worker] claim loop error", error);
      await sleep(Math.max(env.WORKER_POLL_INTERVAL_MS, 5_000));
    }
  }
  console.log("[worker] stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

void main();
