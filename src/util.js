import {z} from "zod";
import {WORKSPACE} from "./bitbucket-client.js";

export const workspace = z
  .string()
  .optional()
  .describe("Workspace slug; defaults to BITBUCKET_WORKSPACE");
export const repo_slug = z
  .string()
  .describe("Repository slug, e.g. my-service");

export const workspaceOf = (workspace) => {
  const ws = workspace || WORKSPACE;
  if (!ws) {
    throw new Error(
      "workspace is required: pass it or set BITBUCKET_WORKSPACE",
    );
  }
  return ws;
};

const enc = encodeURIComponent;

export const repoPath = (workspace, slug) =>
  `/repositories/${enc(workspaceOf(workspace))}/${enc(slug)}`;

// A diff spec keeps its "/" and ".." so branch names like feature/x stay readable to Bitbucket.
export const specPath = (from, to) => encodeURI(`${from}..${to}`);

/** A value for Bitbucket's `q` filter, quoted so user input cannot end the string. */
export const quoteQ = (value) => `"${value.replace(/[\\"]/g, "\\$&")}"`;

export const firstLine = (message) =>
  (message ?? "").split("\n")[0].slice(0, 120);

export const fileStat = (entry) => ({
  lines_added: entry.lines_added ?? 0,
  lines_removed: entry.lines_removed ?? 0,
  path: (entry.new ?? entry.old)?.path,
  status: entry.status,
});

export const commitInfo = (commit) => ({
  author: commit.author?.raw,
  date: commit.date,
  hash: commit.hash?.slice(0, 12),
  message: firstLine(commit.message),
});

// Follows `next` up to maxPages. Walking every page of a long history (a stale
// branch, all merged PRs) times out instead of answering, so the cap is
// reported as truncated rather than hidden.
export const paginate = async (bb, path, maxPages = 10) => {
  const values = [];
  let url = path;
  for (let page = 0; url && page < maxPages; page++) {
    const data = await bb("GET", url);
    values.push(...(data?.values ?? []));
    url = data?.next;
  }
  return {truncated: Boolean(url), values};
};

/** A count that may have stopped at the page cap, e.g. "100+". */
export const countOf = ({truncated, values}) =>
  truncated ? `${values.length}+` : values.length;

const JIRA_KEY = /\b[A-Z][A-Z0-9]+-\d+\b/g;

export const jiraKeys = (texts) => [
  ...new Set(texts.flatMap((text) => (text ?? "").match(JIRA_KEY) ?? [])),
];

/** Cuts long text so one diff or file cannot flood the model's context. */
export const capText = (text, max) =>
  text.length > max
    ? {content: text.slice(0, max), truncated: true}
    : {content: text, truncated: false};
