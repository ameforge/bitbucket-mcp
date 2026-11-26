import {bbRequest as defaultBbRequest} from "./bitbucket-client.js";

// bbRequest is a parameter so tests can pass a fake and run handlers without live Bitbucket.
export const defineTool = (
  server,
  name,
  config,
  handler,
  bbRequest = defaultBbRequest,
) => {
  server.registerTool(name, config, async (params) => {
    try {
      const out = await handler(params, bbRequest);
      const text = typeof out === "string" ? out : JSON.stringify(out);
      return {content: [{text, type: "text"}]};
    } catch (err) {
      // stderr: stdout carries the MCP protocol.
      console.error(
        `[${new Date().toISOString()}] ${name} failed: ${err.message}`,
      );
      return {content: [{text: err.message, type: "text"}], isError: true};
    }
  });
};
