const { connectMongo, mongoose } = require("./db/mongo");
const { createRedisConnection } = require("./queue/connection");
const { NOTIFICATIONS_QUEUE } = require("./queue/names");
const { env, isAdminOtpSlackEnv } = require("./config/env");
const { startWorker } = require("./worker");
const { assertCertificateAssets } = require("./services/certificate.service");
const { sendEngineeringIncident } = require("./providers/slack.webhook");

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

function registerProcessHandlers() {
  let shuttingDown = false;
  const alertAndExit = async (title, err) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await Promise.race([
      sendEngineeringIncident({ title, errorMessage, stack }),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    process.exit(1);
  };

  process.on("uncaughtException", (err) => {
    console.error(JSON.stringify({ level: "error", msg: "uncaughtException", error: err.message }));
    void alertAndExit("Notification-Service crash: uncaughtException", err);
  });

  process.on("unhandledRejection", (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error(JSON.stringify({ level: "error", msg: "unhandledRejection", error: err.message }));
    void alertAndExit("Notification-Service crash: unhandledRejection", err);
  });
}

async function main() {
  registerProcessHandlers();
  console.log(
    JSON.stringify({
      level: "info",
      msg: "notification-service starting",
      nodeEnv: env.NODE_ENV,
      slackChannels: Object.keys(env.SLACK_WEBHOOKS || {}),
      slackAdminOtp: env.SLACK_ADMIN_OTP_ENABLED && isAdminOtpSlackEnv(),
      engineeringSlack: env.ENGINEERING_SLACK_ALERTS_ENABLED,
    }),
  );
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

main().catch(async (err) => {
  console.error(JSON.stringify({ level: "error", msg: "fatal", error: err.message }));
  await Promise.race([
    sendEngineeringIncident({
      title: "Notification-Service startup failure",
      errorMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  process.exit(1);
});
