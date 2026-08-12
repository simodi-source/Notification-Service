const { Worker } = require("bullmq");
const { createRedisConnection } = require("./queue/connection");
const { NOTIFICATIONS_QUEUE } = require("./queue/names");
const { env } = require("./config/env");
const { handleNotificationJob } = require("./job-handler");

/**
 * Trade confirmation jobs render a ~1MB certificate PDF then POST it to Bird.
 * BullMQ's default lockDuration (30s) is too short for that path — the lock
 * expires, the job is marked stalled, and after maxStalledCount it fails with
 * "job stalled more than allowable limit".
 */
const LOCK_DURATION_MS = 5 * 60 * 1000;

function startWorker() {
  const connection = createRedisConnection();

  const worker = new Worker(
    NOTIFICATIONS_QUEUE,
    async (job) => {
      const started = Date.now();
      try {
        return await handleNotificationJob(job);
      } finally {
        console.log(
          JSON.stringify({
            level: "info",
            msg: "job duration",
            jobId: job.id,
            event: job.data?.event,
            templateCode: job.data?.templateCode,
            durationMs: Date.now() - started,
          }),
        );
      }
    },
    {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: LOCK_DURATION_MS,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    },
  );

  worker.on("completed", (job) => {
    console.log(JSON.stringify({ level: "info", msg: "job completed", jobId: job.id, event: job.data?.event }));
  });

  worker.on("failed", (job, err) => {
    console.error(
      JSON.stringify({
        level: "error",
        msg: "job failed",
        jobId: job?.id,
        event: job?.data?.event,
        error: err?.message,
      }),
    );
  });

  worker.on("stalled", (jobId) => {
    console.error(JSON.stringify({ level: "warn", msg: "job stalled", jobId }));
  });

  worker.on("error", (err) => {
    console.error(JSON.stringify({ level: "error", msg: "worker error", error: err.message }));
  });

  return worker;
}

module.exports = { startWorker };
