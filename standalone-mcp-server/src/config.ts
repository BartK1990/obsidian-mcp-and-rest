// Fixed, process-level settings — set once via env vars, never changed at
// runtime.
export interface ServerEnv {
	port: number;
	bearerToken?: string;
	dataDir: string;
	configPath: string;
}

// The git connection settings — configurable at runtime via the web UI (or
// seeded from env vars on first boot) and persisted to `configPath`. Never
// stored inside `dataDir`, since that's the git working tree: anything in
// there is fair game for `git_commit`'s `git add -A`, and a token committed
// into the vault repo would get pushed straight to GitHub.
export interface RuntimeConfig {
	repoUrl?: string;
	repoBranch: string;
	gitUsername: string;
	gitToken?: string;
	authorName: string;
	authorEmail: string;
}

export function loadServerEnv(): ServerEnv {
	const dataDir = process.env.DATA_DIR ?? "/data/vault";
	const configDir = process.env.CONFIG_DIR ?? "/data/config";
	return {
		port: Number(process.env.PORT ?? 8123),
		bearerToken: process.env.MCP_BEARER_TOKEN || undefined,
		dataDir,
		configPath: `${configDir}/settings.json`,
	};
}

export function envSeed(): RuntimeConfig {
	return {
		repoUrl: process.env.REPO_URL || undefined,
		repoBranch: process.env.REPO_BRANCH ?? "main",
		gitUsername: process.env.GIT_USERNAME ?? "x-access-token",
		gitToken: process.env.GIT_TOKEN || undefined,
		authorName: process.env.GIT_AUTHOR_NAME ?? "Obsidian MCP Server",
		authorEmail: process.env.GIT_AUTHOR_EMAIL ?? "obsidian-mcp-server@localhost",
	};
}

/** repo name derived from the URL, e.g. "https://github.com/u/my-vault.git" -> "my-vault" */
export function deriveVaultName(repoUrl?: string): string | null {
	if (!repoUrl) return null;
	const stripped = repoUrl.replace(/\/+$/, "").replace(/\.git$/i, "");
	const segment = stripped.split(/[/:]/).pop();
	return segment || null;
}
