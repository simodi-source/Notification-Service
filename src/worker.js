const { Worker } = require("bullmq");
const { createRedisConnection } = require("./queue/connection");
const { NOTIFICATIONS_QUEUE } = require("./queue/names");
const { env } = require("./config/env");
const { handleNotificationJob } = require("./job-handler");

function startWorker() {
  const connection = createRedisConnection();

  const worker = new Worker(NOTIFICATIONS_QUEUE, handleNotificationJob, {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  });

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

  worker.on("error", (err) => {
    console.error(JSON.stringify({ level: "error", msg: "worker error", error: err.message }));
  });

  return worker;
}

module.exports = { startWorker };
