import {z} from "zod";
import {defineTool} from "../define-tool.js";
import {
  capText,
  commitInfo,
  countOf,
  fileStat,
  paginate,
  quoteQ,
  repo_slug,
  repoPath,
  specPath,
  workspace,
} from "../util.js";

const MAX_DIFF_CHARS = 100_000;
// 5 pages of 100: enough to say "500+ commits behind" without walking years of history.
const COUNT_PAGES = 5;
// Commit lists in compare_branches stop at 2 pages of 50.
const LIST_PAGES = 2;
const MAX_COMMIT_PAGES = 20;

const enc = encodeURIComponent;

/** Commits reachable from include but not from exclude. */
const commitsBetween = (bb, base, include, exclude, pagelen, pages) =>
  paginate(
    bb,
    `${base}/commits?include=${enc(include)}&exclude=${enc(exclude)}&pagelen=${pagelen}`,
    pages,
  );

/** A commit hash as is, or the head commit of a branch. */
const commitOf = async (bb, base, ref) =>
  /^[0-9a-f]{7,40}$/i.test(ref)
    ? ref
    : (await bb("GET", `${base}/refs/branches/${enc(ref)}?fields=target.hash`))
        .target.hash;

export const registerBranchTools = (server, bbRequest) => {
  defineTool(
    server,
    "list_branches",
    {
      description:
        "List branches, most recently updated first, optionally only those whose name contains name_filter. Returns the 50 newest; when truncated, narrow with name_filter. Use get_branch for one branch's details",
      inputSchema: z.object({
        name_filter: z
          .string()
          .optional()
          .describe("Part of the branch name, e.g. KJMTP2-7024 or release"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, name_filter, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const q = name_filter ? `&q=${enc(`name ~ ${quoteQ(name_filter)}`)}` : "";
      const {truncated, values} = await paginate(
        bb,
        `${base}/refs/branches?sort=-target.date&pagelen=50${q}`,
        1,
      );
      return {
        branches: values.map((b) => ({
          last_commit: commitInfo(b.target ?? {}),
          name: b.name,
        })),
        truncated,
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_branch",
    {
      description:
        "Get a branch: head commit, whether it is the default branch, and how many commits it is behind the default branch",
      inputSchema: z.object({
        branch_name: z
          .string()
          .describe("Exact branch name, e.g. develop or feature/x"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, branch_name, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const [branch, repo] = await Promise.all([
        bb("GET", `${base}/refs/branches/${enc(branch_name)}`),
        bb("GET", base),
      ]);
      const main = repo.mainbranch?.name;
      const isDefault = branch_name === main;
      let behind = null;
      if (!isDefault && main) {
        behind = countOf(
          await commitsBetween(bb, base, main, branch_name, 100, COUNT_PAGES),
        );
      }
      const target = branch.target ?? {};
      return {
        behind_default: behind,
        default_branch: main,
        is_default_branch: isDefault,
        latest_commit: commitInfo(target),
        name: branch_name,
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "compare_branches",
    {
      description:
        "Compare source with target before a merge: commits ahead and behind, and files changed",
      inputSchema: z.object({
        repo_slug,
        source: z.string().describe("Branch merged FROM, e.g. feature/x"),
        target: z.string().describe("Branch merged INTO, e.g. main"),
        workspace,
      }),
    },
    async ({repo_slug, source, target, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const [ahead, behind, files] = await Promise.all([
        commitsBetween(bb, base, source, target, 50, LIST_PAGES),
        commitsBetween(bb, base, target, source, 50, LIST_PAGES),
        paginate(
          bb,
          `${base}/diffstat/${specPath(source, target)}?pagelen=100`,
        ),
      ]);
      return {
        commits_ahead: countOf(ahead),
        commits_ahead_info: ahead.values.map(commitInfo),
        commits_behind: countOf(behind),
        commits_behind_info: behind.values.map(commitInfo),
        files_changed: files.values.map(fileStat),
        files_truncated: files.truncated,
        source,
        target,
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_diff",
    {
      description: `Unified diff for from_ref..to_ref, where from_ref is the new side and to_ref the base, plus per-file stats. Diff text over ${MAX_DIFF_CHARS} characters is cut and marked truncated`,
      inputSchema: z.object({
        context: z
          .number()
          .int()
          .min(0)
          .default(3)
          .describe("Context lines around each change"),
        from_ref: z
          .string()
          .describe("New side: branch, tag or commit, e.g. feature/x"),
        ignore_whitespace: z.boolean().default(false),
        repo_slug,
        to_ref: z
          .string()
          .describe("Base side: branch, tag or commit, e.g. main"),
        workspace,
      }),
    },
    async (
      {
        repo_slug,
        from_ref,
        to_ref,
        workspace,
        ignore_whitespace = false,
        context = 3,
      },
      bb,
    ) => {
      const base = repoPath(workspace, repo_slug);
      const spec = specPath(from_ref, to_ref);
      const [files, diff] = await Promise.all([
        paginate(
          bb,
          `${base}/diffstat/${spec}?ignore_whitespace=${ignore_whitespace}&pagelen=100`,
        ),
        bb(
          "GET",
          `${base}/diff/${spec}?context=${context}&ignore_whitespace=${ignore_whitespace}`,
          undefined,
          {text: true},
        ),
      ]);
      const {content, truncated} = capText(diff ?? "", MAX_DIFF_CHARS);
      return {
        diff: content,
        diff_truncated: truncated,
        files_changed: files.values.map(fileStat),
        files_truncated: files.truncated,
        from_ref,
        to_ref,
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_commits",
    {
      description:
        "List recent commits, newest first, optionally from a branch, since a date, or by an author",
      inputSchema: z.object({
        author: z
          .string()
          .optional()
          .describe("Case-insensitive substring of author name or email"),
        branch: z
          .string()
          .optional()
          .describe(
            "Branch, tag or commit to start from; defaults to the default branch",
          ),
        max_results: z.number().int().min(1).max(200).default(30),
        repo_slug,
        since: z
          .string()
          .optional()
          .describe(
            "ISO 8601 date, e.g. 2024-01-01 (UTC midnight) or 2024-01-01T09:00:00+07:00",
          ),
        workspace,
      }),
    },
    async (
      {repo_slug, branch, since, author, max_results = 30, workspace},
      bb,
    ) => {
      const base = repoPath(workspace, repo_slug);
      let sinceMs = null;
      if (since) {
        sinceMs = Date.parse(
          since.includes("T") ? since : `${since}T00:00:00Z`,
        );
        if (Number.isNaN(sinceMs)) {
          throw new Error(`since is not an ISO 8601 date: ${since}`);
        }
      }
      const needle = author?.toLowerCase();
      const commits = [];
      let url = `${base}/commits${branch ? `/${enc(branch)}` : ""}?pagelen=50`;
      // The page cap bounds an author filter that rarely matches.
      for (let page = 0; url && page < MAX_COMMIT_PAGES; page++) {
        const data = await bb("GET", url);
        url = data?.next;
        // History order is not date order: a rebased or cherry-picked commit
        // keeps its old date among newer ones, so one old commit is skipped and
        // only a page with nothing since the cutoff ends the walk.
        let pageHasNew = false;
        for (const c of data?.values ?? []) {
          if (sinceMs !== null && Date.parse(c.date) < sinceMs) continue;
          pageHasNew = true;
          if (needle && !(c.author?.raw ?? "").toLowerCase().includes(needle)) {
            continue;
          }
          commits.push({
            ...commitInfo(c),
            html_url: c.links?.html?.href,
          });
          if (commits.length >= max_results) {
            url = null;
            break;
          }
        }
        if (sinceMs !== null && !pageHasNew) url = null;
      }
      return {commits, truncated: Boolean(url)};
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_build_status",
    {
      description:
        "Build and CI results (Pipelines, Jenkins, ...) reported on the head commit of a branch or on a commit",
      inputSchema: z.object({
        ref: z.string().describe("Branch name or commit hash"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, ref, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const hash = await commitOf(bb, base, ref);
      const {values} = await paginate(
        bb,
        `${base}/commit/${enc(hash)}/statuses?pagelen=100`,
      );
      return {
        commit: hash.slice(0, 12),
        ref,
        statuses: values.map((s) => ({
          name: s.name ?? s.key,
          state: s.state,
          updated_on: s.updated_on,
          url: s.url,
        })),
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "create_branch",
    {
      description:
        "Create a branch from another branch or a commit. Fails if the branch already exists",
      inputSchema: z.object({
        from: z
          .string()
          .optional()
          .describe(
            "Branch or commit to start from; defaults to the default branch",
          ),
        name: z.string().describe("New branch name, e.g. feature/x"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, name, from, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const start = from || (await bb("GET", base)).mainbranch?.name;
      if (!start)
        throw new Error("The repository has no default branch; pass from");
      const hash = await commitOf(bb, base, start);
      const branch = await bb("POST", `${base}/refs/branches`, {
        name,
        target: {hash},
      });
      return {
        commit: branch.target?.hash?.slice(0, 12),
        from: start,
        html_url: branch.links?.html?.href,
        name: branch.name,
      };
    },
    bbRequest,
  );
};
