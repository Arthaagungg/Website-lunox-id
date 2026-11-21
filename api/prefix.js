const mongoose = require("mongoose");

const MAIN_GUILD_ID = "1305143692935561258";
const DEFAULT_PREFIX = "!!";

let cached = global.__lunoxMongo;
if (!cached) {
  cached = global.__lunoxMongo = { connection: null, promise: null };
}

async function connectDatabase() {
  if (cached.connection) return cached.connection;

  if (!cached.promise) {
    const uri = process.env.LUNOX_MONGODB_URI;
    if (!uri) throw new Error("LUNOX_MONGODB_URI is not configured");

    cached.promise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    }).then(connection => connection).catch(error => {
      cached.promise = null;
      throw error;
    });
  }

  cached.connection = await cached.promise;
  return cached.connection;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await connectDatabase();

    const GuildSchema = mongoose.models.GuildSchema ||
      mongoose.model("GuildSchema", new mongoose.Schema({
        guild: String,
        prefix: String
      }));

    const guildData = await GuildSchema.findOne({ guild: MAIN_GUILD_ID })
      .select({ prefix: 1, _id: 0 })
      .lean();

    const prefix = guildData && guildData.prefix
      ? guildData.prefix
      : (process.env.LUNOX_DEFAULT_PREFIX || DEFAULT_PREFIX);

    res.setHeader("Cache-Control", "public, s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json({
      prefix,
      source: guildData && guildData.prefix ? "mongodb" : "default"
    });
  } catch (error) {
    console.error("Failed to read the LUNOX server prefix:", error.message);
    return res.status(503).json({ error: "Prefix temporarily unavailable" });
  }
};
