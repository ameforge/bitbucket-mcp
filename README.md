# Bitbucket Cloud mcp

MCP server for Bitbucket Cloud (REST API 2.0). It reads repositories, branches, commits, diffs, files, build results and pull requests. It can open, edit, comment on, approve, request changes on, merge and decline pull requests, and create branches.

The same tools are also served by [@ameforge/atlassian-mcp](https://github.com/ameforge/atlassian-mcp/tree/main/packages/atlassian) when `BITBUCKET_API_TOKEN` is set there.

## Requirements

- A Bitbucket Cloud account and an Atlassian API token with scopes. Create it at id.atlassian.com, Security, API tokens, "Create API token with scopes", and pick at least `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket` and `read:workspace:bitbucket`.
- Node.js 18+.

## Quick start

You can let Claude Code install it for you. Paste this prompt into a Claude Code session and replace the values with your own:

```text
Add the MCP server "bitbucket-mcp" with `claude mcp add`, running `npx -y @ameforge/bitbucket-mcp@latest`, with these environment variables:
BITBUCKET_EMAIL=you@company.com
BITBUCKET_API_TOKEN=your_api_token
BITBUCKET_WORKSPACE=your-workspace
Use the command syntax for my shell, then run `claude mcp list` to check that it connects.
```

The prompt puts your API token into the conversation. If you would rather keep it out, run the command below yourself, in a regular terminal rather than a Claude Code session. Either way, restart Claude Code afterwards so it loads the server.

bash / zsh (macOS, Linux, Git Bash or WSL on Windows):

```bash
claude mcp add bitbucket-mcp \
  -e BITBUCKET_EMAIL="you@company.com" \
  -e BITBUCKET_API_TOKEN="your_api_token" \
  -e BITBUCKET_WORKSPACE="your-workspace" \
  -- npx -y @ameforge/bitbucket-mcp@latest
```

PowerShell (Windows):

```powershell
claude mcp add bitbucket-mcp `
  -e BITBUCKET_EMAIL="you@company.com" `
  -e BITBUCKET_API_TOKEN="your_api_token" `
  -e BITBUCKET_WORKSPACE="your-workspace" `
  -- npx -y @ameforge/bitbucket-mcp@latest
```

Or add it to `.mcp.json`:

```json
{
  "mcpServers": {
    "bitbucket-mcp": {
      "command": "npx",
      "args": ["-y", "@ameforge/bitbucket-mcp@latest"],
      "env": {
        "BITBUCKET_EMAIL": "you@company.com",
        "BITBUCKET_API_TOKEN": "your_api_token",
        "BITBUCKET_WORKSPACE": "your-workspace"
      }
    }
  }
}
```

The server runs on stdio, so it needs no port and no container.

Official setup guides:

- Claude Code: [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp) explains `claude mcp add`, the local, project and user scopes, and the shared `.mcp.json` file.
- Claude Desktop: [Connect to local MCP servers](https://modelcontextprotocol.io/docs/develop/connect-local-servers) shows, with screenshots, how to open `claude_desktop_config.json` from Settings, Developer, Edit Config, and where to find the logs when a server does not start.

## Environment variables

| Variable              | Required | Description                                                         |
| --------------------- | -------- | ------------------------------------------------------------------- |
| `ATLASSIAN_MCP_USAGE` | no       | Set to `off` to turn off the local usage log (see Usage log)        |
| `ATLASSIAN_MCP_TOOLS` | no       | Comma-separated tool or package names to expose (default all)       |
| `BITBUCKET_EMAIL`     | yes      | Atlassian account email; `ATLASSIAN_EMAIL` is read when it is unset |
| `BITBUCKET_API_TOKEN` | yes      | API token; `ATLASSIAN_API_TOKEN` is read when it is unset           |
| `BITBUCKET_WORKSPACE` | no       | Default workspace slug; without it every tool needs `workspace`     |

## Tools

Every Bitbucket tool except `usage_report` takes an optional `workspace`, which defaults to `BITBUCKET_WORKSPACE`.

Read:

| Tool               | What it returns                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list_repos`       | Repositories sorted by slug, filtered by `project_key` or `name_filter`                                                                                |
| `get_repo`         | Default branch, clone URLs, 5 recent commits, open PR count                                                                                            |
| `get_file`         | File content at `ref`; over 100,000 characters it is cut, a binary file returns no content                                                             |
| `list_files`       | Files and folders directly inside `path` at `ref`, with file sizes                                                                                     |
| `list_branches`    | Branches with their last commit, newest first, filtered by `name_filter`                                                                               |
| `get_branch`       | Head commit, whether it is the default branch, commits behind the default branch                                                                       |
| `compare_branches` | Commits ahead and behind (up to 100 listed each way) and files changed between `source` and `target`                                                   |
| `get_diff`         | Unified diff and per-file stats for `from_ref..to_ref`; diff text over 100,000 characters is cut                                                       |
| `get_commits`      | Commits from `branch`, filtered by `since` and `author`, up to `max_results`                                                                           |
| `get_build_status` | Build and CI results reported on the head commit of a branch, or on a commit                                                                           |
| `list_prs`         | PRs by `state` (`OPEN`, `MERGED`, `DECLINED`, `ALL`) and `author`, up to 100 per state                                                                 |
| `get_pr`           | Description, reviewers, participants, general and inline comments by file, commits, Jira keys                                                          |
| `usage_report`     | Done, calls and errors from the local usage log, per package and tool; with `format` set to `html`, also writes and opens a board page (see Usage log) |

There is no code search tool: Bitbucket Cloud retired its code search API (it answers 410, CHANGE-3167). Browse folders with `list_files`, or search a local clone, for example `git fetch origin` then `git grep -n "pattern" origin/main`.

Write:

| Tool                   | Effect                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `create_pr`            | Opens a PR from `source_branch` into `target_branch`, with optional reviewers                              |
| `update_pr`            | Changes title, description or reviewers; `reviewers` replaces the whole list                               |
| `add_pr_comment`       | Comments on the PR; with `path` and `line`, inline on that line of the new file; with `parent_id`, a reply |
| `approve_pr`           | Approves the PR as the token's user                                                                        |
| `unapprove_pr`         | Withdraws that approval                                                                                    |
| `request_changes_pr`   | Requests changes as the token's user                                                                       |
| `unrequest_changes_pr` | Withdraws that change request                                                                              |
| `merge_pr`             | Merges with the repository's default merge strategy                                                        |
| `decline_pr`           | Declines the PR                                                                                            |
| `create_branch`        | Creates `name` from `from` (a branch or commit, default branch if unset); fails if it exists               |

Reviewers are given as display names or account IDs. A display name matches an exact name first, then a unique part of a name. When a name matches no one or several people, the tool changes nothing and says why, listing the candidates when there are several.

The state changes are separate tools so an MCP client can allow or deny each one, for example deny `merge_pr` in Claude Code permissions.

Lists stop at a page limit instead of walking a whole history. Their result then sets `truncated` to true (`files_truncated`, `comments_truncated` or `commits_truncated` in `compare_branches`, `get_diff` and `get_pr`), and a count that stopped reads like `"500+"`.

All logs go to stderr; stdout is reserved for the MCP protocol.

## Usage log

Every tool call except `usage_report` is logged to a local file with the time, the package, the tool name and whether the call succeeded. Arguments and content are never logged, and nothing is sent anywhere. All the Atlassian packages share this one file.

The file is `$XDG_CONFIG_HOME/atlassian-mcp/usage.jsonl` when `XDG_CONFIG_HOME` is set. Otherwise it is `%APPDATA%\atlassian-mcp\usage.jsonl` on Windows and `~/.config/atlassian-mcp/usage.jsonl` elsewhere. Set `ATLASSIAN_MCP_USAGE=off` to stop logging. A log that cannot be written never fails a tool call.

Call the `usage_report` tool to read the log. Its optional parameters are:

- `days`: how many days back to count (default 30).
- `format`: `text` (default) gives a summary per package and tool. `html` also writes `board.html` next to the log and opens it in the browser. The board has range buttons for 7, 30 and 90 days, for `days` when it is another number, and for all time, totals for done, calls and errors, a done per day chart, a table per tool and a Share card button that shows a card you can download as a PNG or copy.

Done counts the write calls that succeeded. Read tools are those whose names start with `get_`, `list_`, `search_`, `find_`, `download_`, `generate_` or `compare_`. Every other tool counts as a write. Because the file is shared, the report also counts calls made through the other packages.

## Development

```bash
pnpm install
pnpm build             # bundle to dist/index.js via rsbuild
pnpm test
```

Release from the repo root with `pnpm release:bitbucket`; see [docs/RELEASE.md](https://github.com/ameforge/atlassian-mcp/blob/main/docs/RELEASE.md).

## Support

Questions or issues? Email [PNam](mailto:pnamhn16@gmail.com).

If this project helps you, consider buying me a coffee:

<img src="https://raw.githubusercontent.com/ameforge/atlassian-mcp/main/docs/buy-me-a-coffee.jpg" alt="Buy Me A Coffee" width="300">

---

Created by [PNam](mailto:pnamhn16@gmail.com)
