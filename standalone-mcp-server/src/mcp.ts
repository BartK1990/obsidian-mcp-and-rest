import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { VaultManager } from "./vaultManager.js";
import { NotConnectedError } from "./vaultManager.js";

function text(value: unknown) {
	const str = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return { content: [{ type: "text" as const, text: str }] };
}

function errorText(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}

type ToolResult = ReturnType<typeof text>;

async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof NotConnectedError) return errorText(err.message);
		return errorText((err as Error).message);
	}
}

export function buildMcpServer(vm: VaultManager): McpServer {
	const server = new McpServer({ name: "obsidian-vault-standalone", version: "0.1.0" });

	server.registerTool(
		"list_notes",
		{
			title: "List notes",
			description: "List markdown note paths in the vault, optionally under a folder.",
			inputSchema: { folder: z.string().optional() },
		},
		async ({ folder }) => guarded(async () => text(await vm.requireVault().listMarkdownFiles(folder)))
	);

	server.registerTool(
		"read_note",
		{
			title: "Read note",
			description: "Read the full contents of a note by vault-relative path.",
			inputSchema: { path: z.string() },
		},
		async ({ path }) =>
			guarded(async () => {
				const vault = vm.requireVault();
				if (!(await vault.exists(path))) return errorText(`Not found: ${path}`);
				return text(await vault.read(path));
			})
	);

	server.registerTool(
		"write_note",
		{
			title: "Write note",
			description: "Create or overwrite a note at the given path with the given content. Creates any missing parent folders. Does not commit or push — call git_commit/git_push separately.",
			inputSchema: { path: z.string(), content: z.string() },
		},
		async ({ path, content }) =>
			guarded(async () => {
				await vm.requireVault().write(path, content);
				return text(`Wrote ${path}`);
			})
	);

	server.registerTool(
		"create_folder",
		{
			title: "Create folder",
			description: "Create a folder at the given vault-relative path, including any missing parent folders.",
			inputSchema: { path: z.string() },
		},
		async ({ path }) =>
			guarded(async () => {
				await vm.requireVault().createFolder(path);
				return text(`Created folder ${path}`);
			})
	);

	server.registerTool(
		"delete_note",
		{
			title: "Delete note",
			description: "Delete a note or folder at the given vault-relative path. Does not commit or push.",
			inputSchema: { path: z.string() },
		},
		async ({ path }) =>
			guarded(async () => {
				const vault = vm.requireVault();
				if (!(await vault.exists(path))) return errorText(`Not found: ${path}`);
				await vault.delete(path);
				return text(`Deleted ${path}`);
			})
	);

	server.registerTool(
		"search_notes",
		{
			title: "Search notes",
			description: "Case-insensitive substring search across note contents. Returns matching paths with a snippet.",
			inputSchema: { query: z.string() },
		},
		async ({ query }) => guarded(async () => text(await vm.requireVault().search(query)))
	);

	server.registerTool(
		"git_status",
		{
			title: "Git status",
			description: "Show the vault repo's current branch, ahead/behind counts, and pending changes.",
			inputSchema: {},
		},
		async () => guarded(async () => text(await vm.requireGit().status()))
	);

	server.registerTool(
		"git_pull",
		{
			title: "Git pull",
			description: "Pull the latest changes from the remote into the vault. Fails on merge conflicts with uncommitted local changes.",
			inputSchema: {},
		},
		async () => guarded(async () => text(await vm.requireGit().pull()))
	);

	server.registerTool(
		"git_commit",
		{
			title: "Git commit",
			description: "Stage all changes in the vault and commit them locally with the given message. Does not push.",
			inputSchema: { message: z.string() },
		},
		async ({ message }) => guarded(async () => text(await vm.requireGit().commit(message)))
	);

	server.registerTool(
		"git_push",
		{
			title: "Git push",
			description: "Push committed local changes to the remote.",
			inputSchema: {},
		},
		async () => guarded(async () => text(await vm.requireGit().push()))
	);

	server.registerTool(
		"git_log",
		{
			title: "Git log",
			description: "Show recent commit history for the vault repo.",
			inputSchema: { limit: z.number().int().positive().max(100).optional() },
		},
		async ({ limit }) => guarded(async () => text(await vm.requireGit().log(limit ?? 10)))
	);

	return server;
}
