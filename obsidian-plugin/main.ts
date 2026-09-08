import { App, Plugin, PluginSettingTab, Setting, TFile, TFolder, Notice } from "obsidian";
import * as http from "http";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

interface McpPluginSettings {
	port: number;
	// Simple shared-secret auth. Not a substitute for real auth, but keeps
	// stray local processes from poking at your vault unannounced.
	token: string;
}

const DEFAULT_SETTINGS: McpPluginSettings = {
	port: 8123,
	token: "",
};

export default class McpServerPlugin extends Plugin {
	settings: McpPluginSettings;
	private httpServer: http.Server | null = null;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new McpSettingTab(this.app, this));
		this.startServer();

		this.addCommand({
			id: "restart-mcp-server",
			name: "Restart MCP server",
			callback: () => this.restartServer(),
		});
	}

	onunload() {
		this.stopServer();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	restartServer() {
		this.stopServer();
		this.startServer();
	}

	private buildMcpServer(): McpServer {
		const server = new McpServer({ name: "obsidian-vault", version: "0.1.0" });
		const app = this.app;

		server.registerTool(
			"list_notes",
			{
				title: "List notes",
				description: "List markdown note paths in the vault, optionally under a folder.",
				inputSchema: { folder: z.string().optional() },
			},
			async ({ folder }) => {
				const files = app.vault.getMarkdownFiles()
					.filter(f => !folder || f.path.startsWith(folder))
					.map(f => f.path);
				return { content: [{ type: "text", text: JSON.stringify(files, null, 2) }] };
			}
		);

		server.registerTool(
			"list_folders",
			{
				title: "List folders",
				description: "List folder paths in the vault, optionally under a folder. Includes empty folders, which list_notes never shows.",
				inputSchema: { folder: z.string().optional() },
			},
			async ({ folder }) => {
				const folders = app.vault.getAllLoadedFiles()
					.filter((f): f is TFolder => f instanceof TFolder && f.path !== "/")
					.map(f => f.path)
					.filter(p => !folder || p.startsWith(folder));
				return { content: [{ type: "text", text: JSON.stringify(folders, null, 2) }] };
			}
		);

		server.registerTool(
			"list_all",
			{
				title: "List all",
				description: "List every note and folder path in the vault, optionally under a folder, tagged with their type.",
				inputSchema: { folder: z.string().optional() },
			},
			async ({ folder }) => {
				const entries = app.vault.getAllLoadedFiles()
					.filter((f): f is TFolder | TFile =>
						f instanceof TFolder ? f.path !== "/" : f instanceof TFile && f.extension === "md")
					.map(f => ({ path: f.path, type: (f instanceof TFolder ? "folder" : "file") as "folder" | "file" }))
					.filter(e => !folder || e.path.startsWith(folder));
				return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
			}
		);

		server.registerTool(
			"read_note",
			{
				title: "Read note",
				description: "Read the full contents of a note by vault-relative path.",
				inputSchema: { path: z.string() },
			},
			async ({ path }) => {
				const file = app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					return { content: [{ type: "text", text: `Not found: ${path}` }], isError: true };
				}
				const text = await app.vault.read(file);
				return { content: [{ type: "text", text }] };
			}
		);

		server.registerTool(
			"write_note",
			{
				title: "Write note",
				description: "Create or overwrite a note at the given path with the given content. Creates any missing parent folders.",
				inputSchema: { path: z.string(), content: z.string() },
			},
			async ({ path, content }) => {
				const existing = app.vault.getAbstractFileByPath(path);
				if (existing instanceof TFile) {
					await app.vault.modify(existing, content);
				} else {
					const folder = path.substring(0, path.lastIndexOf("/"));
					if (folder && !app.vault.getAbstractFileByPath(folder)) {
						await app.vault.createFolder(folder);
					}
					await app.vault.create(path, content);
				}
				return { content: [{ type: "text", text: `Wrote ${path}` }] };
			}
		);

		server.registerTool(
			"create_folder",
			{
				title: "Create folder",
				description: "Create a folder at the given vault-relative path, including any missing parent folders.",
				inputSchema: { path: z.string() },
			},
			async ({ path }) => {
				const existing = app.vault.getAbstractFileByPath(path);
				if (existing) {
					return { content: [{ type: "text", text: `Already exists: ${path}` }], isError: true };
				}
				await app.vault.createFolder(path);
				return { content: [{ type: "text", text: `Created folder ${path}` }] };
			}
		);

		server.registerTool(
			"delete_note",
			{
				title: "Delete note",
				description: "Delete a note or folder at the given vault-relative path.",
				inputSchema: { path: z.string() },
			},
			async ({ path }) => {
				const file = app.vault.getAbstractFileByPath(path);
				if (!file) {
					return { content: [{ type: "text", text: `Not found: ${path}` }], isError: true };
				}
				await app.vault.delete(file, true);
				return { content: [{ type: "text", text: `Deleted ${path}` }] };
			}
		);

		server.registerTool(
			"search_notes",
			{
				title: "Search notes",
				description: "Case-insensitive substring search across note contents. Returns matching paths with a snippet.",
				inputSchema: { query: z.string() },
			},
			async ({ query }) => {
				const q = query.toLowerCase();
				const results: { path: string; snippet: string }[] = [];
				for (const file of app.vault.getMarkdownFiles()) {
					const text = await app.vault.cachedRead(file);
					const idx = text.toLowerCase().indexOf(q);
					if (idx !== -1) {
						const start = Math.max(0, idx - 40);
						results.push({ path: file.path, snippet: text.slice(start, idx + 80) });
					}
				}
				return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
			}
		);

		return server;
	}

	private startServer() {
		const token = this.settings.token;

		this.httpServer = http.createServer(async (req, res) => {
			// Only serve the /mcp endpoint.
			if (!req.url || !req.url.startsWith("/mcp")) {
				res.writeHead(404).end();
				return;
			}

			if (token) {
				const auth = req.headers["authorization"];
				if (auth !== `Bearer ${token}`) {
					res.writeHead(401).end("Unauthorized");
					return;
				}
			}

			// Stateless mode: a fresh server + transport per request. Sharing a
			// single McpServer across requests lets a new connect() steal the
			// shared transport reference out from under a still in-flight
			// request, so each request gets its own isolated pair (matching the
			// MCP SDK's own stateless example).
			const server = this.buildMcpServer();
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			});

			res.on("close", () => {
				transport.close();
				server.close();
			});

			let body = "";
			req.on("data", chunk => (body += chunk));
			req.on("end", async () => {
				try {
					const parsed = body ? JSON.parse(body) : undefined;
					await server.connect(transport);
					await transport.handleRequest(req, res, parsed);
				} catch (err) {
					console.error("MCP request error", err);
					if (!res.headersSent) res.writeHead(500).end("Internal error");
				}
			});
		});

		this.httpServer.listen(this.settings.port, "127.0.0.1", () => {
			new Notice(`MCP server listening on http://127.0.0.1:${this.settings.port}/mcp`);
		});

		this.httpServer.on("error", (err) => {
			new Notice(`MCP server failed to start: ${(err as Error).message}`);
		});
	}

	private stopServer() {
		this.httpServer?.close();
		this.httpServer = null;
	}
}

class McpSettingTab extends PluginSettingTab {
	plugin: McpServerPlugin;

	constructor(app: App, plugin: McpServerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Port")
			.setDesc("Local port the MCP server listens on (127.0.0.1 only).")
			.addText(text =>
				text
					.setValue(String(this.plugin.settings.port))
					.onChange(async (value) => {
						const port = Number(value);
						if (Number.isFinite(port) && port > 0) {
							this.plugin.settings.port = port;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Bearer token")
			.setDesc("Optional. If set, clients must send 'Authorization: Bearer <token>'.")
			.addText(text =>
				text
					.setValue(this.plugin.settings.token)
					.onChange(async (value) => {
						this.plugin.settings.token = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Restart server")
			.addButton(btn =>
				btn.setButtonText("Restart").onClick(() => this.plugin.restartServer())
			);
	}
}
