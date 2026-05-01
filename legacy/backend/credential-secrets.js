"use strict";

const crypto = require("crypto");

const PREFIX = "enc:v1:";

const deriveKey = () => {
  const source =
    process.env.API_SECRET_ENCRYPTION_KEY ||
    process.env.CREDENTIAL_SECRET_KEY ||
    process.env.JWT_KEY ||
    "";

  if (!source) {
    return null;
  }

  return crypto.createHash("sha256").update(String(source)).digest();
};

const isProtectedSecret = (value) => String(value || "").startsWith(PREFIX);

const protectSecret = (value) => {
  const raw = String(value || "").trim();
  if (!raw || isProtectedSecret(raw)) {
    return raw || null;
  }

  const key = deriveKey();
  if (!key) {
    return raw;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX.slice(0, -1),
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
};

const revealSecret = (value) => {
  const raw = String(value || "").trim();
  if (!raw || !isProtectedSecret(raw)) {
    return raw || null;
  }

  const key = deriveKey();
  if (!key) {
    throw new Error("credential secret key is not configured");
  }

  const [, version, ivText, tagText, encryptedText] = raw.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("invalid protected credential format");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

const maskCredential = (value) => {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  if (isProtectedSecret(raw)) {
    return "stored";
  }

  if (raw.length <= 8) {
    return raw;
  }

  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
};

module.exports = {
  isProtectedSecret,
  protectSecret,
  revealSecret,
  maskCredential,
};
