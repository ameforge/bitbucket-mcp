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

/** The ref to put in a src URL, defaulting to the default branch. */
const srcRef = async (bb, base, ref) => {
  const wanted = ref || (await bb("GET", base)).mainbranch?.name || "HEAD";
  // The src endpoint cannot take a branch name with "/" in the path, so
  // such a branch is read at its head commit. A tag with "/" is not a
  // branch and falls through as is.
  if (wanted.includes("/")) {
    try {
      const branch = await bb(
        "GET",
        `${base}/refs/branches/${encodeURIComponent(wanted)}?fields=target.hash`,
      );
      return {resolved: branch?.target?.hash ?? wanted, wanted};
    } catch {}
  }
  return {resolved: wanted, wanted};
};

const srcPath = (path) =>
  path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");

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
      const {wanted, resolved} = await srcRef(bb, base, ref);
      const filePath = srcPath(path);
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

  defineTool(
    server,
    "list_files",
    {
      description:
        "List the files and folders directly inside a folder at a branch, tag or commit. Pass a folder from the result as path to go deeper",
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe(
            "Folder from the repo root, e.g. src; defaults to the root",
          ),
        ref: z
          .string()
          .optional()
          .describe("Branch, tag or commit; defaults to the default branch"),
        repo_slug,
        workspace,
      }),
    },
    async ({repo_slug, path = "", ref, workspace}, bb) => {
      const base = repoPath(workspace, repo_slug);
      const {wanted, resolved} = await srcRef(bb, base, ref);
      const dir = srcPath(path);
      const {truncated, values} = await paginate(
        bb,
        `${base}/src/${encodeURIComponent(resolved)}/${dir ? `${dir}/` : ""}?pagelen=100`,
      );
      return {
        entries: values.map((e) => ({
          path: e.path,
          size: e.size,
          type: e.type === "commit_directory" ? "folder" : "file",
        })),
        path,
        ref: wanted,
        resolved_ref: resolved,
        truncated,
      };
    },
    bbRequest,
  );
};
