import {z} from "zod";
import {defineTool} from "../define-tool.js";
import {
  commitInfo,
  jiraKeys,
  paginate,
  quoteQ,
  repo_slug,
  repoPath,
  workspace,
} from "../util.js";

const STATES = ["OPEN", "MERGED", "DECLINED"];
// 2 pages of 50 per state: merged history can run to thousands of PRs.
const PR_PAGES = 2;
const COMMENT_PAGES = 10;
const COMMIT_PAGES = 5;

const prSummary = (pr) => ({
  author: pr.author?.nickname,
  author_display_name: pr.author?.display_name,
  created_on: pr.created_on,
  destination_branch: pr.destination?.branch?.name,
  html_url: pr.links?.html?.href,
  id: pr.id,
  source_branch: pr.source?.branch?.name,
  state: pr.state,
  title: pr.title,
  updated_on: pr.updated_on,
});

const normalizeComment = (raw) => {
  const inline = raw.inline;
  return {
    author: raw.user?.display_name,
    content: raw.content?.raw ?? "",
    created_on: raw.created_on,
    deleted: raw.deleted ?? false,
    html_url: raw.links?.html?.href,
    id: raw.id,
    inline: inline
      ? {
          from: inline.from,
          outdated: inline.outdated,
          path: inline.path,
          to: inline.to,
        }
      : null,
    parent_id: raw.parent?.id,
    pending: raw.pending ?? false,
    updated_on: raw.updated_on,
  };
};

const endpoint = (ref) => ({
  branch: ref?.branch?.name,
  commit: ref?.commit?.hash,
});

export const registerPrTools = (server, bbRequest) => {
  defineTool(
    server,
    "list_prs",
    {
      description: `List pull requests by state, optionally by author. Returns up to ${PR_PAGES * 50} per state`,
      inputSchema: z.object({
        author: z.string().optional().describe("Author nickname or account ID"),
        repo_slug,
        state: z.enum(["OPEN", "MERGED", "DECLINED", "ALL"]).default("OPEN"),
        workspace,
      }),
    },
    async ({repo_slug, state = "OPEN", author, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const q = author
        ? `&q=${encodeURIComponent(`author.nickname=${quoteQ(author)} OR author.account_id=${quoteQ(author)}`)}`
        : "";
      const states = state === "ALL" ? STATES : [state];
      const pages = await Promise.all(
        states.map((s) =>
          paginate(
            bb,
            `${base}/pullrequests?state=${s}&pagelen=50${q}`,
            PR_PAGES,
          ),
        ),
      );
      return {
        pull_requests: pages.flatMap((p) => p.values.map(prSummary)),
        truncated: pages.some((p) => p.truncated),
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_pr",
    {
      description:
        "Get a pull request: description, reviewers and approvals, general and inline comments grouped by file, commits, and Jira keys found in the title, description and commits",
      inputSchema: z.object({
        pr_id: z.number().int().describe("Pull request ID, e.g. 123"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, pr_id, workspace}, bb) => {
      const base = `${repoPath(workspace, repo_slug)}/pullrequests/${pr_id}`;
      const [pr, comments, commits] = await Promise.all([
        bb("GET", base),
        paginate(bb, `${base}/comments?pagelen=100`, COMMENT_PAGES),
        paginate(bb, `${base}/commits?pagelen=100`, COMMIT_PAGES),
      ]);
      const all = comments.values.map(normalizeComment);
      const general = all.filter((c) => !c.inline);
      const byFile = new Map();
      for (const c of all.filter((c) => c.inline)) {
        const file = c.inline.path ?? "__unknown__";
        byFile.set(file, [...(byFile.get(file) ?? []), c]);
      }
      return {
        author: pr.author?.display_name,
        comment_count: all.length,
        comments_truncated: comments.truncated,
        commits: commits.values.map(commitInfo),
        commits_truncated: commits.truncated,
        created_on: pr.created_on,
        description: pr.description ?? "",
        destination: endpoint(pr.destination),
        general_comments: general,
        html_url: pr.links?.html?.href,
        id: pr.id,
        inline_comments: [...byFile]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, list]) => ({
            comment_count: list.length,
            comments: list,
            file,
          })),
        jira_tickets: jiraKeys([
          pr.title,
          pr.description,
          ...commits.values.map((c) => c.message),
        ]),
        participants: (pr.participants ?? []).map((p) => ({
          approved: p.approved,
          participated_on: p.participated_on,
          role: p.role,
          state: p.state,
          user: p.user?.display_name,
        })),
        reason: pr.reason,
        reviewers: (pr.reviewers ?? [])
          .map((r) => r.display_name)
          .filter(Boolean),
        source: endpoint(pr.source),
        state: pr.state,
        title: pr.title,
        updated_on: pr.updated_on,
      };
    },
    bbRequest,
  );
};
