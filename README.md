# Bitbucket Cloud mcp

MCP server for Bitbucket Cloud (REST API 2.0). It reads repositories, branches, commits, diffs, files, build results and pull requests. It can open, edit, comment on, approve, request changes on, merge and decline pull requests, and create branches.

The same tools are also served by [@ameforge/atlassian-mcp](https://github.com/ameforge/atlassian-mcp/tree/main/packages/atlassian) when `BITBUCKET_API_TOKEN` is set there.

## Requirements

- A Bitbucket Cloud account and an Atlassian API token with scopes. Create it at id.atlassian.com, Security, API tokens, "Create API token with scopes", and pick at least `read:repository:bitbucket`, `read:pullrequest:bitbucket`, `write:pullrequest:bitbucket` and `read:workspace:bitbucket`.
- Node.js 18+.

## Quick start

Use Claude Code CLI. Run the command in a regular terminal, not inside a Claude Code session.

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
| `BITBUCKET_EMAIL`     | yes      | Atlassian account email; `ATLASSIAN_EMAIL` is read when it is unset |
| `BITBUCKET_API_TOKEN` | yes      | API token; `ATLASSIAN_API_TOKEN` is read when it is unset           |
| `BITBUCKET_WORKSPACE` | no       | Default workspace slug; without it every tool needs `workspace`     |

## Tools

Every tool takes an optional `workspace`, which defaults to `BITBUCKET_WORKSPACE`.

Read:

| Tool               | What it returns                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `list_repos`       | Repositories sorted by slug, filtered by `project_key` or `name_filter`                              |
| `get_repo`         | Default branch, clone URLs, 5 recent commits, open PR count                                          |
| `get_file`         | File content at `ref`; over 100,000 characters it is cut, a binary file returns no content           |
| `list_files`       | Files and folders directly inside `path` at `ref`, with file sizes                                   |
| `list_branches`    | Branches with their last commit, newest first, filtered by `name_filter`                             |
| `get_branch`       | Head commit, whether it is the default branch, commits behind the default branch                     |
| `compare_branches` | Commits ahead and behind (up to 100 listed each way) and files changed between `source` and `target` |
| `get_diff`         | Unified diff and per-file stats for `from_ref..to_ref`; diff text over 100,000 characters is cut     |
| `get_commits`      | Commits from `branch`, filtered by `since` and `author`, up to `max_results`                         |
| `get_build_status` | Build and CI results reported on the head commit of a branch, or on a commit                         |
| `list_prs`         | PRs by `state` (`OPEN`, `MERGED`, `DECLINED`, `ALL`) and `author`, up to 100 per state               |
| `get_pr`           | Description, reviewers, participants, general and inline comments by file, commits, Jira keys        |

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

Reviewers are given as display names or account IDs. A display name matches an exact name first, then a unique part of a name. When a name matches no one or several people, the tool sends nothing and lists the candidates.

The state changes are separate tools so an MCP client can allow or deny each one, for example deny `merge_pr` in Claude Code permissions.

Lists stop at a page limit instead of walking a whole history. Their result then has `truncated: true`, and a count that stopped reads like `"500+"`.

All logs go to stderr; stdout is reserved for the MCP protocol.

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
