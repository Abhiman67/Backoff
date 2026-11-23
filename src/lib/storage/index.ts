import { createHash, createHmac } from "node:crypto";
import type { ObjectStorage } from "./types";
import { localStorage } from "./local";

const bucket = process.env.S3_BUCKET;
const accessKey = process.env.S3_ACCESS_KEY;
const secretKey = process.env.S3_SECRET_KEY;
const endpoint = process.env.S3_ENDPOINT || "https://s3.amazonaws.com";
const region = process.env.S3_REGION || "us-east-1";

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

async function s3Request(method: "PUT" | "GET" | "DELETE", key: string, data?: Uint8Array, contentType?: string) {
  if (!bucket || !accessKey || !secretKey) throw new Error("S3 storage credentials are incomplete.");
  const root = new URL(endpoint);
  if (root.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(root.hostname)) throw new Error("S3 endpoint must use HTTPS.");
  const path = `${root.pathname.replace(/\/$/, "")}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const url = new URL(path, root);
  const date = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const bodyHash = sha256(data ?? new Uint8Array());
  const token = process.env.S3_SESSION_TOKEN;
  const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": bodyHash, "x-amz-date": date };
  if (token) headers["x-amz-security-token"] = token;
  if (contentType && method === "PUT") headers["content-type"] = contentType;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [method, url.pathname, "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const scope = `${day}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), "s3"), "aws4_request");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${hmac(signingKey, stringToSign).toString("hex")}`;
  delete headers.host;
  const response = await fetch(url, { method, headers, body: data ? Buffer.from(data) : undefined, signal: AbortSignal.timeout(30_000) });
  if (response.status === 404 && method === "GET") return null;
  if (!response.ok) throw new Error(`S3 ${method} failed (${response.status}).`);
  return response;
}

const remoteStorage: ObjectStorage = {
  async put(key, data, contentType) {
    await s3Request("PUT", key, data, contentType);
    return { key };
  },
  async get(key) {
    const response = await s3Request("GET", key);
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  },
  async del(key) {
    await s3Request("DELETE", key);
  },
};

export const objectStorage: ObjectStorage = bucket ? remoteStorage : {
  async put(key, data, contentType) {
    if (process.env.NODE_ENV === "production") throw new Error("Configure S3_BUCKET before accepting production uploads.");
    return localStorage.put(key, data, contentType);
  },
  get: (key) => localStorage.get(key),
  del: (key) => localStorage.del(key),
};

export function storageKeyFor(ownerId: string, fileId: string, name: string) {
  const clean = (s: string) => s.replace(/\.\./g, "_").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${clean(ownerId)}/${clean(fileId)}/${clean(name)}`;
}
