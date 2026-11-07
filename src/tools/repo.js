import {z} from "zod";
import {defineTool} from "../define-tool.js";
import {
  capText,
  commitInfo,
  paginate,
  quoteQ,
  repo_slug,
  repoPath,
  workspace,
  workspaceOf,
} from "../util.js";

const MAX_FILE_CHARS = 100_000;

const normalizeRepo = (raw, ws) => {
  const links = raw.links ?? {};
  const clone = Object.fromEntries(
    (links.clone ?? []).map((link) => [link.name, link.href]),
  );
  return {
    clone_https: clone.https,
    clone_ssh: clone.ssh,
    created_on: raw.created_on,
    description: raw.description ?? "",
    full_name: raw.full_name,
    html_url: links.html?.href,
    name: raw.name,
    project_key: raw.project?.key,
    project_name: raw.project?.name,
    slug: raw.slug,
    updated_on: raw.updated_on,
    workspace: ws,
  };
};

export const registerRepoTools = (server, bbRequest) => {
  defineTool(
    server,
    "list_repos",
    {
      description:
        "List repositories the account can access in a workspace, sorted by slug",
      inputSchema: z.object({
        name_filter: z
          .string()
          .optional()
          .describe("Case-insensitive substring of repo name or slug"),
        project_key: z.string().optional().describe("Project key, e.g. MYPROJ"),
        workspace,
      }),
    },
    async ({workspace, project_key, name_filter}, bb) => {
      const ws = workspaceOf(workspace);
      const q = project_key
        ? `&q=${encodeURIComponent(`project.key=${quoteQ(project_key)}`)}`
        : "";
      const {truncated, values} = await paginate(
        bb,
        `/repositories/${encodeURIComponent(ws)}?sort=slug&pagelen=100${q}`,
      );
      const needle = name_filter?.toLowerCase();
      const repositories = values
        .filter(
          (r) =>
            !needle ||
            r.name?.toLowerCase().includes(needle) ||
            r.slug?.toLowerCase().includes(needle),
        )
        .map((r) => normalizeRepo(r, ws));
      return {repositories, truncated};
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_repo",
    {
      description:
        "Get a repository: default branch, clone URLs, 5 recent commits and open PR count",
      inputSchema: z.object({repo_slug, workspace}),
    },
    async ({repo_slug, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const raw = await bb("GET", base);
      const main = raw.mainbranch?.name;
      // An empty repository has no main branch and no commits to list.
      const [commits, prs] = await Promise.all([
        main
          ? bb("GET", `${base}/commits/${encodeURIComponent(main)}?pagelen=5`)
          : null,
        bb("GET", `${base}/pullrequests?state=OPEN&pagelen=1`),
      ]);
      return {
        ...normalizeRepo(raw, workspaceOf(workspace)),
        default_branch: main,
        open_pull_requests: prs?.size,
        recent_commits: (commits?.values ?? []).map(commitInfo),
      };
    },
    bbRequest,
  );

  defineTool(
    server,
    "search_code",
    {
      description:
        'Search code in a workspace or one repo. Supports Bitbucket code search syntax: "exact phrase", NOT, ext:, lang:, path:, repo:, project:',
      inputSchema: z.object({
        max_results: z.number().int().min(1).max(100).default(20),
        query: z.string().describe("Search query"),
        repo_slug: z
          .string()
          .optional()
          .describe("Limit the search to this repository"),
        workspace,
      }),
    },
    async ({query, repo_slug, workspace, max_results = 20}, bb) => {
      const ws = workspaceOf(workspace);
      const search = repo_slug ? `${query} repo:${repo_slug}` : query;
      const data = await bb(
        "GET",
        `/workspaces/${encodeURIComponent(ws)}/search/code?search_query=${encodeURIComponent(search)}&pagelen=${Math.min(max_results, 100)}`,
      );
      return (data?.values ?? []).map((match) => {
        const file = match.file ?? {};
        // .../repositories/{ws}/{slug}/src/... names the repo of each hit.
        const parts = (file.links?.self?.href ?? "").split("/");
        const at = parts.indexOf("repositories");
        const repo = at >= 0 ? parts[at + 2] : repo_slug;
        return {
          file: file.path,
          html_url: `https://bitbucket.org/${ws}/${repo}/src/HEAD/${file.path}`,
          lines: (match.content_matches ?? []).flatMap((cm) =>
            (cm.lines ?? []).map((line) => ({
              content: (line.segments ?? [])
                .map((s) => s.text ?? "")
                .join("")
                .trimEnd(),
              line: line.line,
            })),
          ),
          repo,
        };
      });
    },
    bbRequest,
  );

  defineTool(
    server,
    "get_file",
    {
      description: `Read a file at a branch, tag or commit. Text over ${MAX_FILE_CHARS} characters is cut and marked truncated; binary files return no content`,
      inputSchema: z.object({
        path: z.string().describe("Path from the repo root, e.g. src/app.js"),
        ref: z
          .string()
          .optional()
          .describe("Branch, tag or commit; defaults to the default branch"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, path, ref, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const wanted = ref || (await bb("GET", base)).mainbranch?.name || "HEAD";
      let resolved = wanted;
      // The src endpoint cannot take a branch name with "/" in the path, so
      // such a branch is read at its head commit. A tag with "/" is not a
      // branch and falls through as is.
      if (wanted.includes("/")) {
        try {
          const branch = await bb(
            "GET",
            `${base}/refs/branches/${encodeURIComponent(wanted)}?fields=target.hash`,
          );
          resolved = branch?.target?.hash ?? wanted;
        } catch {}
      }
      const filePath = path
        .replace(/^\/+/, "")
        .split("/")
        .map(encodeURIComponent)
        .join("/");
      const text = await bb(
        "GET",
        `${base}/src/${encodeURIComponent(resolved)}/${filePath}`,
        undefined,
        {text: true},
      );
      const binary = text.includes("\u0000");
      return {
        ...(binary
          ? {binary: true, content: null, truncated: false}
          : capText(text, MAX_FILE_CHARS)),
        html_url: `https://bitbucket.org/${workspaceOf(workspace)}/${repo_slug}/src/${resolved}/${path}`,
        path,
        ref: wanted,
        resolved_ref: resolved,
        // A binary body decoded as UTF-8 grows, so its byte count is not the file size.
        size: binary ? null : Buffer.byteLength(text),
      };
    },
    bbRequest,
  );
};
