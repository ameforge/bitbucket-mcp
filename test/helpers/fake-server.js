// Calls handlers directly and skips the zod inputSchema, like jira's helper.
export const fakeServer = () => {
  const tools = new Map();
  return {
    registerTool: (name, _config, handler) => tools.set(name, handler),
    tools,
  };
};

export const runTool = async (register, name, args, routes) => {
  const server = fakeServer();
  const requests = [];
  register(server, async (method, path, body) => {
    requests.push(`${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}`);
    const route = routes.find(([prefix]) => path.startsWith(prefix));
    if (!route) throw new Error(`unrouted ${method} ${path}`);
    return typeof route[1] === "function" ? route[1](path) : route[1];
  });
  const result = await server.tools.get(name)(args);
  const text = result.content[0].text;
  return {
    isError: result.isError,
    out: result.isError ? text : JSON.parse(text),
    requests,
  };
};
