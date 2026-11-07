import assert from "node:assert/strict";
import {test} from "node:test";
import {registerPrWriteTools} from "../src/tools/pr-write.js";
import {runTool} from "./helpers/fake-server.js";

// Each test uses its own workspace: the member list is cached per workspace.
const members = {
  values: [
    {user: {account_id: "id-nam", display_name: "Nam"}},
    {user: {account_id: "id-namcp", display_name: "Nam Cao"}},
    {user: {account_id: "id-lan", display_name: "Lan Tran"}},
  ],
};

test("create_pr prefers an exact display name and posts the resolved account IDs", async () => {
  const {isError, requests} = await runTool(
    registerPrWriteTools,
    "create_pr",
    {
      repo_slug: "svc",
      reviewers: ["Nam", "lan"],
      source_branch: "feature/x",
      target_branch: "main",
      title: "T",
      workspace: "w1",
    },
    [
      ["/workspaces/w1/members", members],
      ["/repositories/w1/svc/pullrequests", {id: 1}],
    ],
  );
  assert.equal(isError, undefined);
  assert.equal(
    requests[1],
    `POST /repositories/w1/svc/pullrequests ${JSON.stringify({
      destination: {branch: {name: "main"}},
      reviewers: [{account_id: "id-nam"}, {account_id: "id-lan"}],
      source: {branch: {name: "feature/x"}},
      title: "T",
    })}`,
  );
});

test("create_pr sends nothing when a reviewer is ambiguous", async () => {
  const {isError, out, requests} = await runTool(
    registerPrWriteTools,
    "create_pr",
    {
      repo_slug: "svc",
      reviewers: ["na"],
      source_branch: "feature/x",
      target_branch: "main",
      title: "T",
      workspace: "w2",
    },
    [["/workspaces/w2/members", members]],
  );
  assert.equal(isError, true);
  assert.match(out, /"na" matches Nam, Nam Cao/);
  assert.deepEqual(requests, ["GET /workspaces/w2/members?pagelen=100"]);
});

test("update_pr keeps the current title and reviewers when only the description changes", async () => {
  const PR = "/repositories/w3/svc/pullrequests/5";
  const {requests} = await runTool(
    registerPrWriteTools,
    "update_pr",
    {description: "new", pr_id: 5, repo_slug: "svc", workspace: "w3"},
    [
      [
        PR,
        {
          description: "old",
          reviewers: [{account_id: "id-lan", display_name: "Lan Tran"}],
          title: "Keep me",
        },
      ],
    ],
  );
  assert.deepEqual(requests, [
    `GET ${PR}`,
    `PUT ${PR} ${JSON.stringify({
      description: "new",
      reviewers: [{account_id: "id-lan"}],
      title: "Keep me",
    })}`,
  ]);
});

test("approve_pr reads the PR back instead of returning the participant", async () => {
  const PR = "/repositories/w4/svc/pullrequests/9";
  const {out, requests} = await runTool(
    registerPrWriteTools,
    "approve_pr",
    {pr_id: 9, repo_slug: "svc", workspace: "w4"},
    [
      [`${PR}/approve`, {approved: true, role: "REVIEWER"}],
      [PR, {id: 9, state: "OPEN", title: "T"}],
    ],
  );
  assert.deepEqual(requests, [`POST ${PR}/approve`, `GET ${PR}`]);
  assert.equal(out.id, 9);
  assert.equal(out.title, "T");
});
