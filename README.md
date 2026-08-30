# obsidian-mcp-and-rest

Two ways to expose an Obsidian vault as an MCP server. Each is a
self-contained project in its own folder.

## [`obsidian-plugin/`](obsidian-plugin/README.md)

An Obsidian plugin that runs an MCP server inside Obsidian itself (binds to
127.0.0.1, Streamable HTTP transport). No Docker, no separate process —
just toggle it on in Obsidian. Requires Obsidian to be running.

## [`standalone-mcp-server/`](standalone-mcp-server/README.md)

A standalone, Dockerized MCP server that doesn't need Obsidian running. It
clones a vault's git repo, exposes it over the same kind of MCP tool
surface, and adds git tools (`git_commit`, `git_push`, `git_pull`) plus a
small web UI for configuring the repo connection and checking status.
Meant for running on a home server / Portainer.
