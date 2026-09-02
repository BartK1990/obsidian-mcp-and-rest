# obsidian-mcp-server (plugin)

A minimal Obsidian plugin that runs an MCP (Model Context Protocol) server
inside Obsidian itself, using the Streamable HTTP transport. It exposes six
tools: `list_notes`, `read_note`, `write_note`, `create_folder`,
`delete_note`, `search_notes`.

Runs entirely on your machine (binds to 127.0.0.1) — no data leaves your PC
unless you point a remote client at it, which you shouldn't.

## Why this approach

Obsidian's desktop app is Electron with Node integration available to
plugins, so the plugin can open a real `http.Server` and talk MCP directly —
no external process, no separate `npx` server to keep running.

## Build (Windows)

```powershell
# 1. Copy (or symlink) this obsidian-plugin folder into your vault's plugin
#    directory, e.g.:
#    <vault>\.obsidian\plugins\obsidian-mcp-server\

cd <vault>\.obsidian\plugins\obsidian-mcp-server
npm install
npm run build
```

This produces `main.js` next to `manifest.json`. Then in Obsidian:
Settings → Community Plugins → toggle "MCP Server" on. You should see a
notice: `MCP server listening on http://127.0.0.1:8123/mcp`.

Open the plugin's settings to change the port or set a bearer token.

## Connecting Claude Desktop

Claude Desktop's local `mcpServers` config expects a **stdio** command, not a
raw URL, so bridge to the HTTP endpoint with `mcp-remote`
(`npx`-installed on demand, needs Node.js):

Edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8123/mcp"]
    }
  }
}
```

If you set a bearer token in the plugin settings, pass it through as a
header:

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "http://127.0.0.1:8123/mcp",
        "--header", "Authorization:Bearer YOUR_TOKEN"
      ]
    }
  }
}
```

Quit Claude Desktop from the tray icon and reopen it. A tool icon should
appear showing the Obsidian tools.

## Debugging

- Use the MCP Inspector to test the server directly, without Claude Desktop:
  `npx @modelcontextprotocol/inspector` and connect to
  `http://127.0.0.1:8123/mcp`.
- Obsidian's developer console (Ctrl+Shift+I) shows `console.error` output
  from the plugin, including request errors.

## Extending

Add more tools in `buildMcpServer()` in `main.ts` — e.g. wrap
`app.metadataCache` for frontmatter/tag queries, or `app.workspace` for
"what note is currently open." Each tool is just a name, a zod input schema,
and an async handler returning `{ content: [...] }`.

## Notes / caveats

- `isDesktopOnly: true` in the manifest — this won't load on Obsidian mobile,
  since there's no raw `http` module there.
- The stateless transport mode here (a fresh `StreamableHTTPServerTransport`
  per request) is the simplest option and fine for a single local client. If
  you want multiple concurrent clients with proper session continuity,
  you'd add a `Mcp-Session-Id`-keyed transport map — see the MCP TypeScript
  SDK's "with session management" example.
- The bearer token is a basic shared-secret check, not real auth. Since the
  server only binds to 127.0.0.1, the main threat model is "other local
  processes on your machine," which the token does address.
