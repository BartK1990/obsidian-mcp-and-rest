import * as http from "http";
import { z } from "zod";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadServerEnv, envSeed } from "./config.js";
import { ConfigStore } from "./configStore.js";
import { VaultManager } from "./vaultManager.js";
import { buildMcpServer } from "./mcp.js";
import { UI_HTML } from "./ui.js";

const configPatchSchema = z.object({
	repoUrl: z.string().regex(/^https?:\/\//i, "repoUrl must be an http:// or https:// URL"),
	repoBranch: z.string().min(1).optional(),
	gitUsername: z.string().min(1).optional(),
	gitToken: z.string().optional(),
	authorName: z.string().min(1).optional(),
	authorEmail: z.string().min(1).optional(),
});

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (chunk) => (body += chunk));
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json" }).end(payload);
}

async function main() {
	const env = loadServerEnv();
	const configStore = new ConfigStore(env.configPath, envSeed());
	const vaultManager = new VaultManager(configStore, env.dataDir);

	// Don't let a bad/missing repo config crash the process — the whole point
	// of the web UI is to be able to fix it without a redeploy.
	await vaultManager.connect();

	function isAuthorized(req: http.IncomingMessage): boolean {
		if (!env.bearerToken) return true;
		return req.headers["authorization"] === `Bearer ${env.bearerToken}`;
	}

	const httpServer = http.createServer(async (req, res) => {
		const url = req.url ?? "";

		if (url === "/healthz") {
			res.writeHead(200, { "content-type": "text/plain" }).end("ok");
			return;
		}

		if (url === "/" && req.method === "GET") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(UI_HTML);
			return;
		}

		if (url.startsWith("/api/")) {
			if (!isAuthorized(req)) {
				sendJson(res, 401, { error: "Unauthorized" });
				return;
			}

			if (url === "/api/status" && req.method === "GET") {
				sendJson(res, 200, await vaultManager.getStatus());
				return;
			}

			if (url === "/api/config" && req.method === "POST") {
				try {
					const raw = await readBody(req);
					const parsed = configPatchSchema.parse(raw ? JSON.parse(raw) : {});
					await vaultManager.applyConfig(parsed);
					sendJson(res, 200, await vaultManager.getStatus());
				} catch (err) {
					sendJson(res, 400, { error: (err as Error).message });
				}
				return;
			}

			sendJson(res, 404, { error: "Not found" });
			return;
		}

		if (!url.startsWith("/mcp")) {
			res.writeHead(404).end();
			return;
		}

		if (!isAuthorized(req)) {
			res.writeHead(401).end("Unauthorized");
			return;
		}

		// Stateless mode: a fresh server + transport per request, so one
		// request's connect() can't steal the transport out from under another
		// still in-flight request.
		const mcpServer = buildMcpServer(vaultManager);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});

		res.on("close", () => {
			transport.close();
			mcpServer.close();
		});

		try {
			const body = await readBody(req);
			const parsed = body ? JSON.parse(body) : undefined;
			await mcpServer.connect(transport);
			await transport.handleRequest(req, res, parsed);
		} catch (err) {
			console.error("MCP request error", err);
			if (!res.headersSent) res.writeHead(500).end("Internal error");
		}
	});

	httpServer.listen(env.port, "0.0.0.0", () => {
		console.log(`Obsidian MCP standalone server listening on http://0.0.0.0:${env.port}/`);
		console.log(`MCP endpoint: http://0.0.0.0:${env.port}/mcp`);
		if (!env.bearerToken) {
			console.warn(
				"WARNING: MCP_BEARER_TOKEN is not set. This server binds to 0.0.0.0, so anyone who can " +
					"reach the published port can read/write your vault and change its git connection. " +
					"Set MCP_BEARER_TOKEN."
			);
		}
	});

	const shutdown = () => {
		httpServer.close(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("Fatal error starting server:", err);
	process.exit(1);
});
