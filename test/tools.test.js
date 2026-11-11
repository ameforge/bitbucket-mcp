import assert from "node:assert/strict";
import {test} from "node:test";
import {registerBranchTools} from "../src/tools/branch.js";
import {registerPrTools} from "../src/tools/pr.js";
import {registerRepoTools} from "../src/tools/repo.js";
import {runTool} from "./helpers/fake-server.js";

const REPO = "/repositories/ws/svc";
const ws = {repo_slug: "svc", workspace: "ws"};

test("get_file reads a branch with a slash at its head commit", async () => {
  const {out, requests} = await runTool(
    registerRepoTools,
    "get_file",
    {path: "src/a b.js", ref: "feature/x", ...ws},
    [
      [`${REPO}/refs/branches/`, {target: {hash: "abc123"}}],
      [`${REPO}/src/`, "hello"],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${REPO}/refs/branches/feature%2Fx?fields=target.hash`,
    `GET ${REPO}/src/abc123/src/a%20b.js`,
  ]);
  assert.equal(out.content, "hello");
  assert.equal(out.resolved_ref, "abc123");
});

test("get_file returns no content for a binary file", async () => {
  const {out} = await runTool(
    registerRepoTools,
    "get_file",
    {path: "logo.png", ref: "main", ...ws},
    [[`${REPO}/src/`, "\u0089PNG\u0000\u0000"]],
  );
  assert.equal(out.binary, true);
  assert.equal(out.content, null);
});

test("get_diff sends context and ignore_whitespace to the diff itself", async () => {
  const {requests} = await runTool(
    registerBranchTools,
    "get_diff",
    {
      context: 10,
      from_ref: "feature/x",
      ignore_whitespace: true,
      to_ref: "main",
      ...ws,
    },
    [
      [`${REPO}/diffstat/`, {values: []}],
      [`${REPO}/diff/`, "diff --git"],
    ],
  );
  assert.ok(
    requests.includes(
      `GET ${REPO}/diff/feature/x..main?context=10&ignore_whitespace=true`,
    ),
    requests.join("\n"),
  );
});

test("get_branch stops counting behind commits at the page cap", async () => {
  const page = {
    next: "https://api.bitbucket.org/2.0/next",
    values: Array(100).fill({}),
  };
  const {out, requests} = await runTool(
    registerBranchTools,
    "get_branch",
    {branch_name: "old", ...ws},
    [
      [`${REPO}/refs/branches/old`, {target: {hash: "h", message: ""}}],
      [`${REPO}/commits?`, page],
      ["https://api.bitbucket.org/2.0/next", page],
      [REPO, {mainbranch: {name: "main"}}],
    ],
  );
  assert.equal(out.behind_default, "500+");
  assert.equal(requests.length, 2 + 5);
});

test("get_commits skips an old commit among newer ones and stops at a page with nothing since", async () => {
  const commit = (hash, date) => ({author: {raw: "A <a@x>"}, date, hash});
  const {out, requests} = await runTool(
    registerBranchTools,
    "get_commits",
    {since: "2024-01-01", ...ws},
    [
      [
        `${REPO}/commits`,
        {
          next: "https://api.bitbucket.org/2.0/p2",
          values: [
            commit("c1", "2024-02-01T00:00:00+00:00"),
            commit("old", "2023-06-01T00:00:00+00:00"),
            commit("c2", "2024-01-01T00:00:00+00:00"),
          ],
        },
      ],
      [
        "https://api.bitbucket.org/2.0/p2",
        {
          next: "https://api.bitbucket.org/2.0/p3",
          values: [commit("c3", "2023-12-31T23:59:59+00:00")],
        },
      ],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${REPO}/commits?pagelen=50`,
    "GET https://api.bitbucket.org/2.0/p2",
  ]);
  assert.deepEqual(
    out.commits.map((c) => c.hash),
    ["c1", "c2"],
  );
  assert.equal(out.truncated, false);
});

test("list_prs quotes the author so it cannot break out of the filter", async () => {
  const {requests} = await runTool(
    registerPrTools,
    "list_prs",
    {author: 'x" OR state="MERGED', ...ws},
    [[`${REPO}/pullrequests`, {values: []}]],
  );
  const q = decodeURIComponent(requests[0].split("&q=")[1]);
  assert.equal(
    q,
    'author.nickname="x\\" OR state=\\"MERGED" OR author.account_id="x\\" OR state=\\"MERGED"',
  );
});

test("get_pr reads the PR, comments and commits only, and groups inline comments by file", async () => {
  const PR = `${REPO}/pullrequests/7`;
  const {out, requests} = await runTool(
    registerPrTools,
    "get_pr",
    {pr_id: 7, ...ws},
    [
      [
        `${PR}/comments`,
        {
          values: [
            {content: {raw: "general"}, id: 1},
            {content: {raw: "b1"}, id: 2, inline: {path: "b.js", to: 3}},
            {content: {raw: "a1"}, id: 3, inline: {path: "a.js", to: 1}},
          ],
        },
      ],
      [`${PR}/commits`, {values: [{hash: "h1", message: "TEAM-12 fix\nbody"}]}],
      [PR, {description: "see PROJ-3", id: 7, title: "PROJ-3 thing"}],
    ],
  );
  assert.deepEqual(requests.toSorted(), [
    `GET ${PR}`,
    `GET ${PR}/comments?pagelen=100`,
    `GET ${PR}/commits?pagelen=100`,
  ]);
  assert.deepEqual(
    out.general_comments.map((c) => c.content),
    ["general"],
  );
  assert.deepEqual(
    out.inline_comments.map((f) => [f.file, f.comments[0].content]),
    [
      ["a.js", "a1"],
      ["b.js", "b1"],
    ],
  );
  assert.deepEqual(out.jira_tickets, ["PROJ-3", "TEAM-12"]);
  assert.equal(out.commits[0].message, "TEAM-12 fix");
});

test("list_files lists a folder of a branch with a slash at its head commit", async () => {
  const {out, requests} = await runTool(
    registerRepoTools,
    "list_files",
    {path: "src/", ref: "feature/x", ...ws},
    [
      [`${REPO}/refs/branches/`, {target: {hash: "abc123"}}],
      [
        `${REPO}/src/`,
        {
          values: [
            {path: "src/lib", type: "commit_directory"},
            {path: "src/a.js", size: 5, type: "commit_file"},
          ],
        },
      ],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${REPO}/refs/branches/feature%2Fx?fields=target.hash`,
    `GET ${REPO}/src/abc123/src/?pagelen=100`,
  ]);
  assert.deepEqual(out.entries, [
    {path: "src/lib", type: "folder"},
    {path: "src/a.js", size: 5, type: "file"},
  ]);
});

test("get_build_status reads the statuses of a branch's head commit", async () => {
  const {out, requests} = await runTool(
    registerBranchTools,
    "get_build_status",
    {ref: "feature/x", ...ws},
    [
      [`${REPO}/refs/branches/`, {target: {hash: "abc123"}}],
      [
        `${REPO}/commit/abc123/statuses`,
        {values: [{name: "build", state: "FAILED"}]},
      ],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${REPO}/refs/branches/feature%2Fx?fields=target.hash`,
    `GET ${REPO}/commit/abc123/statuses?pagelen=100`,
  ]);
  assert.equal(out.statuses[0].state, "FAILED");
});

test("create_branch starts from the default branch's head commit", async () => {
  const {requests} = await runTool(
    registerBranchTools,
    "create_branch",
    {name: "feature/y", ...ws},
    [
      [`${REPO}/refs/branches/develop`, {target: {hash: "abc123"}}],
      [`${REPO}/refs/branches`, {name: "feature/y"}],
      [REPO, {mainbranch: {name: "develop"}}],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${REPO}`,
    `GET ${REPO}/refs/branches/develop?fields=target.hash`,
    `POST ${REPO}/refs/branches ${JSON.stringify({name: "feature/y", target: {hash: "abc123"}})}`,
  ]);
});

test("list_branches quotes name_filter and sorts by newest commit", async () => {
  const {out, requests} = await runTool(
    registerBranchTools,
    "list_branches",
    {name_filter: 'x" OR name ~ "', ...ws},
    [
      [
        `${REPO}/refs/branches`,
        {values: [{name: "feature/x", target: {hash: "abc"}}]},
      ],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${REPO}/refs/branches?sort=-target.date&pagelen=50&q=${encodeURIComponent('name ~ "x\\" OR name ~ \\""')}`,
  ]);
  assert.equal(out.branches[0].name, "feature/x");
});
