import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: resolve(__dirname, "../.env")});

// MCP client configs sometimes pass values with literal quotes around them.
const clean = (value) => (value ?? "").trim().replace(/^["']|["']$/g, "");

export const BASE = "https://api.bitbucket.org/2.0";
export const WORKSPACE = clean(process.env.BITBUCKET_WORKSPACE);
const EMAIL = clean(process.env.BITBUCKET_EMAIL || process.env.ATLASSIAN_EMAIL);
const TOKEN = clean(
  process.env.BITBUCKET_API_TOKEN || process.env.ATLASSIAN_API_TOKEN,
);
const AUTH = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;

// Bitbucket Cloud rate limits with 429 and has transient 5xx. A POST is not
// replayed: a 500 on create or merge may already have taken effect.
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const REPLAYABLE = new Set(["GET", "PUT", "DELETE"]);
const MAX_RETRIES = 2;
const MAX_RETRY_AFTER_S = 10;
const TIMEOUT_MS = 30_000;

const errorMessage = (text) => {
  try {
    return JSON.parse(text).error?.message ?? text;
  } catch {
    return text;
  }
};

/**
 * Paths are relative to BASE. The `next` link of a paginated answer is an
 * absolute URL on BASE and is passed through as is.
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {{text?: boolean}} [opts] text: return the raw body (diff, file source).
 */
export const bbRequest = async (method, path, body, {text = false} = {}) => {
  if (!EMAIL || !TOKEN) {
    throw new Error(
      "Missing credentials: set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN",
    );
  }
  const url = path.startsWith(BASE) ? path : `${BASE}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        Accept: "application/json",
        Authorization: AUTH,
        ...(body && {"Content-Type": "application/json"}),
      },
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const raw = await res.text();
    if (res.ok) {
      if (text) return raw;
      return raw ? JSON.parse(raw) : null;
    }
    if (
      attempt < MAX_RETRIES &&
      RETRY_STATUS.has(res.status) &&
      REPLAYABLE.has(method)
    ) {
      const after = Number(res.headers.get("retry-after"));
      const waitMs =
        after > 0
          ? Math.min(after, MAX_RETRY_AFTER_S) * 1000
          : 250 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`Bitbucket API ${res.status}: ${errorMessage(raw)}`);
  }
};
