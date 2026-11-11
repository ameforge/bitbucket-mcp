import {z} from "zod";
import {defineTool} from "../define-tool.js";
import {
  paginate,
  repo_slug,
  repoPath,
  workspace,
  workspaceOf,
} from "../util.js";

const pr_id = z.number().int().describe("Pull request ID, e.g. 123");
const reviewers = z
  .array(z.string())
  .describe("Reviewer display names or account IDs");

// Workspace members change rarely; one fetch serves every create and update
// for a while instead of walking the member list on each call.
const MEMBERS_TTL_MS = 10 * 60 * 1000;
const MEMBER_PAGES = 20;
const membersCache = new Map();

const membersOf = async (bb, ws) => {
  const hit = membersCache.get(ws);
  if (hit && Date.now() - hit.at < MEMBERS_TTL_MS) return hit.users;
  const {values} = await paginate(
    bb,
    `/workspaces/${encodeURIComponent(ws)}/members?pagelen=100`,
    MEMBER_PAGES,
  );
  const users = values.map((m) => m.user ?? {});
  membersCache.set(ws, {at: Date.now(), users});
  return users;
};

/**
 * Maps names or account IDs to {account_id}: an account ID first, then a
 * unique exact display name, then a unique substring. Throws before any write
 * when a name matches no one or several people, so a PR never goes out
 * quietly missing a reviewer.
 */
export const resolveReviewers = async (bb, ws, names) => {
  const users = await membersOf(bb, ws);
  const problems = [];
  const resolved = names.map((name) => {
    const needle = name.toLowerCase();
    const byId = users.find((u) => u.account_id === name);
    if (byId) return {account_id: byId.account_id};
    const exact = users.filter(
      (u) => (u.display_name ?? "").toLowerCase() === needle,
    );
    const hits = exact.length
      ? exact
      : users.filter((u) =>
          (u.display_name ?? "").toLowerCase().includes(needle),
        );
    if (hits.length === 1) return {account_id: hits[0].account_id};
    problems.push(
      hits.length
        ? `"${name}" matches ${hits.map((u) => u.display_name).join(", ")}`
        : `"${name}" matches no workspace member`,
    );
    return null;
  });
  if (problems.length) {
    throw new Error(
      `Reviewers not resolved, nothing was changed: ${problems.join("; ")}`,
    );
  }
  return resolved;
};

const prResult = (pr) => ({
  author: pr.author?.display_name,
  description: pr.description ?? "",
  destination_branch: pr.destination?.branch?.name,
  html_url: pr.links?.html?.href,
  id: pr.id,
  participants: (pr.participants ?? []).map((p) => ({
    approved: p.approved,
    role: p.role,
    state: p.state,
    user: p.user?.display_name,
  })),
  reviewers: (pr.reviewers ?? []).map((r) => r.display_name),
  source_branch: pr.source?.branch?.name,
  state: pr.state,
  title: pr.title,
  updated_on: pr.updated_on,
});

const prPath = (workspace, slug, id) =>
  `${repoPath(workspace, slug)}/pullrequests/${id}`;

export const registerPrWriteTools = (server, bbRequest) => {
  defineTool(
    server,
    "create_pr",
    {
      description: "Open a pull request from source_branch into target_branch",
      inputSchema: z.object({
        description: z.string().optional(),
        repo_slug,
        reviewers: reviewers.optional(),
        source_branch: z
          .string()
          .describe("Branch merged FROM, e.g. feature/x"),
        target_branch: z.string().describe("Branch merged INTO, e.g. main"),
        title: z.string(),
        workspace,
      }),
    },
    async (
      {
        repo_slug,
        title,
        source_branch,
        target_branch,
        description,
        reviewers,
        workspace,
      },
      bb,
    ) => {
      const ws = workspaceOf(workspace);
      const resolved = reviewers?.length
        ? await resolveReviewers(bb, ws, reviewers)
        : undefined;
      const pr = await bb("POST", `${repoPath(ws, repo_slug)}/pullrequests`, {
        description,
        destination: {branch: {name: target_branch}},
        reviewers: resolved,
        source: {branch: {name: source_branch}},
        title,
      });
      return prResult(pr);
    },
    bbRequest,
  );

  defineTool(
    server,
    "update_pr",
    {
      description:
        "Edit a pull request's title, description or reviewers. reviewers replaces the whole list. Use approve_pr, merge_pr or decline_pr to change its state",
      inputSchema: z.object({
        description: z.string().optional(),
        pr_id,
        repo_slug,
        reviewers: reviewers.optional(),
        title: z.string().optional(),
        workspace,
      }),
    },
    async (
      {repo_slug, pr_id, title, description, reviewers, workspace},
      bb,
    ) => {
      if (title === undefined && description === undefined && !reviewers) {
        throw new Error("Pass at least one of title, description, reviewers");
      }
      const ws = workspaceOf(workspace);
      const path = prPath(ws, repo_slug, pr_id);
      // Resolve before reading so a bad name fails with no request sent.
      const resolved = reviewers
        ? await resolveReviewers(bb, ws, reviewers)
        : undefined;
      const current = await bb("GET", path);
      // The PUT body replaces these fields, so unchanged ones are sent back as they are.
      const pr = await bb("PUT", path, {
        description: description ?? current.description ?? "",
        reviewers:
          resolved ??
          (current.reviewers ?? []).map((r) => ({account_id: r.account_id})),
        title: title ?? current.title,
      });
      return prResult(pr);
    },
    bbRequest,
  );

  defineTool(
    server,
    "add_pr_comment",
    {
      description:
        "Comment on a pull request. With path and line the comment is inline on that line of the new version of the file; with parent_id it replies to that comment",
      inputSchema: z.object({
        content: z.string().describe("Comment text, Markdown"),
        line: z
          .number()
          .int()
          .optional()
          .describe("Line in the new version of the file; needs path"),
        parent_id: z
          .number()
          .int()
          .optional()
          .describe("ID of the comment to reply to, from get_pr"),
        path: z
          .string()
          .optional()
          .describe("File path from the repo root, for an inline comment"),
        pr_id,
        repo_slug,
        workspace,
      }),
    },
    async (
      {repo_slug, pr_id, content, path, line, parent_id, workspace},
      bb,
    ) => {
      if (line !== undefined && !path) {
        throw new Error("line needs path: pass the file the line belongs to");
      }
      const comment = await bb(
        "POST",
        `${prPath(workspace, repo_slug, pr_id)}/comments`,
        {
          content: {raw: content},
          inline: path ? {path, to: line} : undefined,
          parent: parent_id ? {id: parent_id} : undefined,
        },
      );
      return {
        html_url: comment.links?.html?.href,
        id: comment.id,
        inline: comment.inline,
      };
    },
    bbRequest,
  );

  const stateTool = (name, description, method, suffix) =>
    defineTool(
      server,
      name,
      {description, inputSchema: z.object({pr_id, repo_slug, workspace})},
      async ({repo_slug, pr_id, workspace}, bb) => {
        const path = prPath(workspace, repo_slug, pr_id);
        await bb(method, `${path}/${suffix}`);
        // approve answers with a participant, not the PR, so read the PR back.
        return prResult(await bb("GET", path));
      },
      bbRequest,
    );

  stateTool(
    "approve_pr",
    "Approve a pull request as the token's user",
    "POST",
    "approve",
  );
  stateTool(
    "unapprove_pr",
    "Withdraw your approval of a pull request",
    "DELETE",
    "approve",
  );
  stateTool(
    "request_changes_pr",
    "Request changes on a pull request as the token's user",
    "POST",
    "request-changes",
  );
  stateTool(
    "unrequest_changes_pr",
    "Withdraw your change request on a pull request",
    "DELETE",
    "request-changes",
  );
  stateTool(
    "merge_pr",
    "Merge a pull request with the repository's default merge strategy",
    "POST",
    "merge",
  );
  stateTool(
    "decline_pr",
    "Decline (close without merging) a pull request",
    "POST",
    "decline",
  );
};
