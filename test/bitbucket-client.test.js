import assert from "node:assert/strict";
import {test} from "node:test";

process.env.BITBUCKET_EMAIL = "me@example.com";
process.env.BITBUCKET_API_TOKEN = "token";
const {BASE, bbRequest} = await import("../src/bitbucket-client.js");

const stubFetch = (answers) => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const [status, body] = answers[calls.length] ?? [200, "{}"];
    calls.push(`${init.method} ${url}`);
    return {
      headers: new Headers(),
      ok: status < 400,
      status,
      text: async () => body,
    };
  };
  return calls;
};

test("bbRequest reports Bitbucket's error message, not the raw body", async () => {
  stubFetch([
    [404, '{"type":"error","error":{"message":"Repository not found"}}'],
  ]);
  await assert.rejects(() => bbRequest("GET", "/repositories/ws/nope"), {
    message: "Bitbucket API 404: Repository not found",
  });
});

test("bbRequest follows an absolute next link without prefixing BASE again", async () => {
  const calls = stubFetch([[200, "{}"]]);
  await bbRequest("GET", `${BASE}/repositories/ws?page=2`);
  assert.deepEqual(calls, [`GET ${BASE}/repositories/ws?page=2`]);
});

// Retries and timeouts are tested in packages/request; here only which methods Bitbucket replays.
for (const [method, says] of [
  [
    "POST",
    /^Bitbucket did not answer the POST within 30s; it may still have taken effect, so do not retry/,
  ],
  ["DELETE", /may still have taken effect, so do not retry/],
  ["GET", /within 30s; safe to retry/],
  ["PUT", /within 30s; safe to retry/],
]) {
  test(`bbRequest says what a timed-out ${method} means for a retry`, async () => {
    globalThis.fetch = async () => {
      throw new DOMException(
        "The operation was aborted due to timeout",
        "TimeoutError",
      );
    };
    await assert.rejects(() => bbRequest(method, "/x"), {message: says});
  });
}
