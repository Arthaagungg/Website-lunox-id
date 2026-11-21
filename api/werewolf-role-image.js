const mongoose = require("mongoose");

let cached = global.__werewolfImageMongo;
if (!cached) cached = global.__werewolfImageMongo = { connection: null, promise: null };

async function connectDatabase() {
  if (cached.connection && cached.connection.readyState === 1) return cached.connection;
  if (!cached.promise) {
    const uri = process.env.WEREWOLF_MONGODB_URI;
    if (!uri) throw new Error("WEREWOLF_MONGODB_URI is not configured");
    const connection = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 8000 });
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
    return res.status(405).end("Method not allowed");
  }

  const roleId = String(req.query.roleId || "");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(roleId) ||
      ["the_candle", "troublemaker", "cupid", "lonewolf"].includes(roleId)) {
    return res.status(400).end("Invalid role");
  }

  try {
    const token = process.env.WEREWOLF_GITHUB_TOKEN;
    if (!token) throw new Error("WEREWOLF_GITHUB_TOKEN is not configured");

    const connection = await connectDatabase();
    const Role = connection.models.WerewolfRole || connection.model(
      "WerewolfRole",
      new mongoose.Schema({
        roleId: String,
        category: String,
        imageName: String
      }, { collection: "werewolfroles", versionKey: false })
    );

    const role = await Role.findOne({
      roleId,
      category: { $in: ["Good Side", "Bad Side", "Neutral", "No Side"] }
    }).select({ _id: 0, imageName: 1 }).lean();

    if (!role) return res.status(404).end("Role image not found");

    const candidates = [
      role.imageName,
      "card-" + roleId + ".png",
      "card-" + roleId + ".jpg",
      "card-" + roleId + ".webp"
    ].filter((name, index, list) =>
      typeof name === "string" &&
      /^card-[a-zA-Z0-9_-]+\.(png|jpe?g|webp|gif)$/i.test(name) &&
      list.indexOf(name) === index
    );

    for (const filename of candidates) {
      const url = "https://api.github.com/repos/Arthaagungg/Werewolf/contents/src/assets/roles/" +
        encodeURIComponent(filename) + "?ref=feature%2Fcentralized-announcements";
      const response = await fetch(url, {
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github.raw",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });

      if (response.status === 404) continue;
      if (!response.ok) throw new Error("GitHub image fetch failed: " + response.status);

      const responseType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const extensionType = /\.png$/i.test(filename) ? "image/png"
        : /\.jpe?g$/i.test(filename) ? "image/jpeg"
        : /\.webp$/i.test(filename) ? "image/webp"
        : /\.gif$/i.test(filename) ? "image/gif" : null;
      if (!extensionType || (responseType && !/^image\/(png|jpeg|webp|gif)$/i.test(responseType) &&
          !["application/octet-stream", "application/vnd.github.raw"].includes(responseType))) {
        throw new Error("Unsupported role image content type: " + responseType);
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error("GitHub returned an empty role image");
      res.setHeader("Content-Type", extensionType);
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(bytes);
    }

    return res.status(404).end("Role image not found");
  } catch (error) {
    console.error("Failed to load Werewolf role image:", error.message);
    return res.status(503).end("Role image temporarily unavailable");
  }
};
