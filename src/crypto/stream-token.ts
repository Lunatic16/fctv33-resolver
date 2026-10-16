import { createCipheriv } from "node:crypto";

import { rot47 } from "./rot47.js";

const STREAM_KEY_B64 = "YTc5ODFjYzllYjJmNGQxOWRjZmVhNTdiMTAxZWNkODk=";
const STREAM_IV_B64 = "ODAxN2QzYThmMTQwMGQyZg==";
const STREAM_KEY = Buffer.from(STREAM_KEY_B64, "base64");
const STREAM_IV = Buffer.from(STREAM_IV_B64, "base64");

export function buildSignedStreamUrl(obfuscatedUrl: string, sessionToken: string): string {
  const decoded = rot47(obfuscatedUrl).slice(8);
  const parsed = new URL(decoded);
  const cipher = createCipheriv("aes-256-cbc", STREAM_KEY, STREAM_IV);
  const encrypted = Buffer.concat([cipher.update(sessionToken, "utf8"), cipher.final()]);
  const token = `${encodeURIComponent(encrypted.toString("base64"))}a`;
  return `${parsed.origin}/token-${token}${parsed.pathname}${parsed.search}`;
}
