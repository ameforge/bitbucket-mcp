import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {productRequest} from "@ameforge/atlassian-request";
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

// A POST is not replayed: a 500 on create or merge may already have taken effect.
const {send} = productRequest({
  effect: "taken effect",
  errorText: (text) => {
    try {
      return JSON.parse(text).error?.message ?? text;
    } catch {
      return text;
    }
  },
  name: "Bitbucket",
  replayable: ["GET", "PUT"],
  retryAfter: true,
});

/**
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {{text?: boolean}} [opts]
 */
export const bbRequest = async (method, path, body, {text = false} = {}) => {
  if (!EMAIL || !TOKEN) {
    throw new Error(
      "Missing credentials: set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN",
    );
  }
  return send(method, path.startsWith(BASE) ? path : `${BASE}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Accept: "application/json",
      Authorization: AUTH,
      ...(body && {"Content-Type": "application/json"}),
    },
    raw: text,
  });
};
