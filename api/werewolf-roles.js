const mongoose = require("mongoose");
const path = require("path");

let cached = global.__werewolfMongo;
if (!cached) {
  cached = global.__werewolfMongo = { connection: null, promise: null };
}

async function connectDatabase() {
  if (cached.connection && cached.connection.readyState === 1) {
    return cached.connection;
  }

  if (!cached.promise) {
    const uri = process.env.WEREWOLF_MONGODB_URI;
    if (!uri) throw new Error("WEREWOLF_MONGODB_URI is not configured");

    const connection = mongoose.createConnection(uri, {
      serverSelectionTimeoutMS: 8000
    });

    cached.promise = connection.asPromise().then(() => {
      cached.connection = connection;
      return connection;
    }).catch((error) => {
      cached.promise = null;
      throw error;
    });
  }

  return cached.promise;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const connection = await connectDatabase();
    const Role = connection.models.WerewolfRole || connection.model(
      "WerewolfRole",
      new mongoose.Schema({
        roleId: String,
        name: String,
        category: String,
        description: String,
        imageName: String,
        emoji: String
      }, { collection: "werewolfroles", versionKey: false })
    );

    const documents = await Role.find({})
      .select({ _id: 0, roleId: 1, name: 1, category: 1, description: 1, imageName: 1, emoji: 1 })
      .sort({ category: 1, name: 1 })
      .lean();

    const roles = documents.map((role) => {
      const safeRoleId = /^[a-zA-Z0-9_-]+$/.test(String(role.roleId || "")) ? role.roleId : "";
      const imageRoot = "https://raw.githubusercontent.com/Arthaagungg/Werewolf/feature/centralized-announcements/src/assets/roles/";
      const imageUrl = safeRoleId ? imageRoot + encodeURIComponent("card-" + safeRoleId + ".jpg") : null;
      const imageFallbackUrl = safeRoleId ? imageRoot + encodeURIComponent("card-" + safeRoleId + ".png") : null;

      const rawEmoji = String(role.emoji || "");
      const customEmoji = rawEmoji.match(/^<a?:[A-Za-z0-9_]+:(\d+)>$/);
      const emojiUrl = customEmoji
        ? "https://cdn.discordapp.com/emojis/" + customEmoji[1] + ".png?size=128&quality=lossless"
        : null;

      return {
        roleId: role.roleId,
        name: role.name,
        category: role.category,
        description: role.description,
        emoji: customEmoji ? "🃏" : (rawEmoji || "🃏"),
        emojiUrl,
        imageUrl,
        imageFallbackUrl
      };
    });

    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ roles, total: roles.length });
  } catch (error) {
    console.error("Failed to load Werewolf roles:", error.message);
    return res.status(503).json({ error: "Werewolf role database temporarily unavailable" });
  }
};
