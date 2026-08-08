const { connectMongo, mongoose } = require("./db/mongo");
const { createRedisConnection } = require("./queue/connection");
const { NOTIFICATIONS_QUEUE } = require("./queue/names");
const { env } = require("./config/env");
const { startWorker } = require("./worker");
const { assertCertificateAssets } = require("./services/certificate.service");

async function logHealth() {
  const redis = createRedisConnection();
  try {
    const pong = await redis.ping();
    console.log(
      JSON.stringify({
        level: "info",
        msg: "health",
        redis: pong === "PONG" ? "ok" : pong,
        mongo: mongoose.connection.readyState === 1 ? "ok" : mongoose.connection.readyState,
        queue: NOTIFICATIONS_QUEUE,
        concurrency: env.WORKER_CONCURRENCY,
      }),
    );
  } finally {
    redis.disconnect();
  }
}

async function main() {
  console.log(JSON.stringify({ level: "info", msg: "notification-service starting", nodeEnv: env.NODE_ENV }));
  assertCertificateAssets();
  await connectMongo();
  await logHealth();
  const worker = startWorker();
  console.log(JSON.stringify({ level: "info", msg: "notification worker listening", queue: NOTIFICATIONS_QUEUE }));

  const shutdown = async (signal) => {
    console.log(JSON.stringify({ level: "info", msg: "shutting down", signal }));
    await worker.close();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: "fatal", error: err.message }));
  process.exit(1);
});
