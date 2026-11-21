const mongoose = require("mongoose");
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

    const documents = await Role.find({
      roleId: { $nin: ["the_candle", "troublemaker", "cupid", "lonewolf"] },
      category: { $in: ["Good Side", "Bad Side", "Neutral", "No Side"] }
    })
      .select({ _id: 0, roleId: 1, name: 1, category: 1, description: 1, imageName: 1, emoji: 1 })
      .sort({ category: 1, name: 1 })
      .lean();

    const roles = documents.map((role) => {
      const roleId = String(role.roleId || "");
      const safeRoleId = /^[a-zA-Z0-9_-]+$/.test(roleId) ? roleId : "";
      const extension = ["king", "politician"].includes(safeRoleId) ? "png" : "jpg";
      const alternateExtension = extension === "jpg" ? "png" : "jpg";
      const imageUrl = safeRoleId
        ? "/assets/werewolf-roles/" + encodeURIComponent(`card-${safeRoleId}.${extension}`)
        : null;
      const imageFallbackUrl = safeRoleId
        ? "/api/werewolf-role-image?roleId=" + encodeURIComponent(safeRoleId)
        : null;

      const rawEmoji = String(role.emoji || "");
      const customEmoji = rawEmoji.match(/^<a?:[A-Za-z0-9_]+:(\\d+)>$/);
      const emojiUrl = customEmoji
        ? "https://cdn.discordapp.com/emojis/" + customEmoji[2] + (customEmoji[1] ? ".gif" : ".png") + "?size=128&quality=lossless"
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
