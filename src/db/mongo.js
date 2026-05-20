const mongoose = require("mongoose");
const { env } = require("../config/env");

async function connectMongo() {
  await mongoose.connect(env.MONGODB_URI);
}

module.exports = { connectMongo, mongoose };
