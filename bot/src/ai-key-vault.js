const crypto = require("node:crypto");

function encryptionKey() {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) {
    const error = new Error("AI_KEY_ENCRYPTION_SECRET must be set to a random secret of at least 32 characters.");
    error.code = "AI_VAULT_NOT_CONFIGURED";
    throw error;
  }
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function encryptApiKey(apiKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(apiKey), "utf8"), cipher.final()]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function decryptApiKey(record) {
  if (!record || record.version !== 1 || record.algorithm !== "aes-256-gcm") {
    throw new Error("Stored AI key format is unsupported.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}

module.exports = { encryptApiKey, decryptApiKey };
