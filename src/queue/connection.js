const Redis = require("ioredis");
const { env } = require("../config/env");

function createRedisConnection() {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

module.exports = { createRedisConnection };
