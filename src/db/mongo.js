const dns = require("node:dns");
const mongoose = require("mongoose");
const { env } = require("../config/env");

/** Node on Windows often lists 127.0.0.1 as the only DNS server; nothing listens there, so mongodb+srv SRV lookup fails with querySrv ECONNREFUSED. */
function ensureResolvableDns() {
  const servers = dns.getServers();
  const loopbackOnly = servers.every((server) => {
    const host = server.split("%")[0].replace(/^\[|\]$/g, "").replace(/:\d+$/, "");
    return host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  });
  if (!loopbackOnly) return;
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  console.warn(
    JSON.stringify({
      level: "warn",
      msg: "DNS servers were loopback-only; using public resolvers for MongoDB SRV lookup",
      previous: servers,
    }),
  );
}

async function connectMongo() {
  ensureResolvableDns();
  await mongoose.connect(env.MONGODB_URI);
}

module.exports = { connectMongo, mongoose };
