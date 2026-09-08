# obsidian-mcp-standalone-server

A standalone, Dockerized MCP server that keeps a local clone of a git
repository (your Obsidian vault) in sync with GitHub, and exposes that
vault over MCP (Streamable HTTP) — the same tool surface as the
[Obsidian plugin](../README.md), plus git tools for committing, pulling,
and pushing.

Unlike the plugin, this doesn't run inside Obsidian and doesn't require
Obsidian to be open. It's meant to run as a container on a server (e.g. via
Portainer), reading and writing the vault directly on disk and syncing it
with GitHub.

## How it works

- On startup, if `DATA_DIR` isn't already a git repo, it's cloned from the
  configured repo URL. Otherwise the existing clone is reused (so keep
  `DATA_DIR` on a persistent volume — see `docker-compose.yml`).
- Reads/writes/search operate directly on the files in `DATA_DIR`.
- Git sync is **manual, tool-driven** — nothing is pulled, committed, or
  pushed automatically. A client calls `git_commit` / `git_push` /
  `git_pull` explicitly. This avoids surprise background network calls and
  merge conflicts from concurrent edits.
- Auth to GitHub uses an HTTPS Personal Access Token, set as an
  `Authorization` header in the repo's local git config (not embedded in
  the remote URL), so it doesn't show up in `git remote -v` or shell
  history.
- The repo URL/branch/token/commit-author settings can be provided as env
  vars, or left unset and configured later through the web UI (see below).
  Once saved via the UI they're persisted to `CONFIG_DIR/settings.json` —
  a file kept outside `DATA_DIR` (the git working tree) on purpose, so it
  can never get swept up by `git_commit`'s `git add -A` and pushed to your
  vault repo.

## Web UI

Open `http://<host>:8123/` for a small dashboard: current vault name
(derived from the repo URL), connection state, branch/ahead/behind/pending
changes, a live remote-reachability check, and a form to set or change the
repo URL, branch, git username/token, and commit author.

If `MCP_BEARER_TOKEN` is set, the page prompts for it before the status/API
calls succeed — the token is kept only in that browser tab's session
storage and sent as an `Authorization` header, the same as any other MCP
client. The saved git token is never sent back to the browser (the API only
reports whether one is set); leaving the token field blank when saving
keeps whatever is already stored.

If the vault isn't connected yet, MCP tool calls return a clear
"not configured" error instead of failing at startup — you can deploy the
container with no `REPO_URL` at all and wire it up from the browser.

## Tools exposed

| Tool | Description |
| --- | --- |
| `list_notes` | List markdown paths, optionally under a folder |
| `list_folders` | List folder paths, optionally under a folder (includes empty folders) |
| `list_all` | List every note and folder path, tagged with their type |
| `read_note` | Read a note's contents |
| `write_note` | Create/overwrite a note (creates parent folders) |
| `create_folder` | Create a folder |
| `delete_note` | Delete a note or folder |
| `search_notes` | Case-insensitive substring search with snippets |
| `git_status` | Branch, ahead/behind, pending changes |
| `git_pull` | Pull latest from the remote |
| `git_commit` | Stage all changes and commit locally |
| `git_push` | Push committed changes to the remote |
| `git_log` | Recent commit history |

## Setup

1. Create a GitHub Personal Access Token with read/write access to the
   vault repo's contents (a fine-grained PAT scoped to just that repo is
   recommended).
2. Copy `.env.example` to `.env` and fill in at least `MCP_BEARER_TOKEN`
   (generate a long random value, e.g. `openssl rand -hex 32`).
   `REPO_URL`/`GIT_TOKEN` can go here too, or be left unset and configured
   later through the web UI.
3. Build and run:

```bash
cd standalone-mcp-server
docker compose up -d --build
```

The server listens on `:8123` inside the container, published to the host
via `docker-compose.yml`. Check `docker compose logs -f` for the initial
clone and startup messages, then open `http://<host>:8123/` to check status
or finish configuring the repo connection.

### Deploying via Portainer

- **Stacks → Add stack**, paste `docker-compose.yml`, and supply the same
  environment variables (`MCP_BEARER_TOKEN` at minimum; `REPO_URL`/
  `GIT_TOKEN` optionally) either in the stack's environment editor or via
  an uploaded `.env`.
- Keep `vault-data` as a named volume (or bind-mount it) so the clone and
  saved settings survive container recreation — otherwise every redeploy
  starts unconfigured again (or re-clones from `REPO_URL` if that env var
  is still set, discarding any uncommitted local changes).
- Put this behind a reverse proxy with TLS if it needs to be reachable
  from outside your own network; the container itself only speaks plain
  HTTP.

## Connecting a client

This server binds to `0.0.0.0`, not `127.0.0.1` — it's designed to be
reached over the network, so `MCP_BEARER_TOKEN` is doing real work here,
not just guarding against stray local processes. Set it.

From Claude Desktop, bridge to the HTTP endpoint with `mcp-remote`:

```json
{
  "mcpServers": {
    "obsidian-remote": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "http://your-server:8123/mcp",
        "--header", "Authorization:Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

Or test directly with the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector
```

and connect to `http://your-server:8123/mcp` with the bearer header.

## Local development (without Docker)

```bash
cd standalone-mcp-server
npm install
DATA_DIR=./.vault-data \
CONFIG_DIR=./.vault-config \
MCP_BEARER_TOKEN=dev-token \
npm run dev
```

Then open `http://127.0.0.1:8123/` and configure the repo connection from
there, or set `REPO_URL`/`GIT_TOKEN` as additional env vars up front.

## Notes / caveats

- `write_note`, `delete_note`, and `create_folder` never touch git —
  commit/push are always separate, explicit tool calls.
- `git_pull` will fail (rather than silently discard anything) if there
  are conflicting local changes; resolve by committing or reverting first.
- If `DATA_DIR` already contains files but isn't a git repo, connecting
  fails with a clear error instead of guessing — point it at an empty
  volume/directory.
- Changing the repo URL via the UI after a vault is already cloned only
  works if `DATA_DIR` is empty or already tracks that same URL — it won't
  silently overwrite an existing different clone. Clear the volume first to
  switch a running instance to a different vault repo.
- There's no per-request session state (stateless Streamable HTTP, one
  transport per request), matching the Obsidian plugin's approach — fine
  for a handful of clients, not built for high concurrency.
