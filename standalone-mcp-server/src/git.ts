import * as fs from "fs";
import { simpleGit, type SimpleGit } from "simple-git";
import type { RuntimeConfig } from "./config.js";

/**
 * Wraps the cloned vault repo. Auth uses an HTTP extraheader (base64 basic
 * auth) scoped to the remote's host, set in the repo's local git config —
 * this keeps the token out of `git remote -v` output and out of process
 * arguments, unlike embedding it in the remote URL.
 */
export class VaultGit {
	private git: SimpleGit;

	constructor(private readonly cfg: RuntimeConfig, private readonly dataDir: string) {
		fs.mkdirSync(dataDir, { recursive: true });
		this.git = simpleGit(dataDir);
	}

	async ensureRepo(): Promise<void> {
		if (!this.cfg.repoUrl) {
			throw new Error("No repo URL configured");
		}
		const gitDirExists = fs.existsSync(`${this.dataDir}/.git`);

		if (!gitDirExists) {
			if (fs.readdirSync(this.dataDir).length > 0) {
				throw new Error(
					`DATA_DIR (${this.dataDir}) exists, is non-empty, and is not a git repo. ` +
						`Point DATA_DIR at an empty directory/volume so it can be cloned into.`
				);
			}
			await simpleGit().clone(this.cfg.repoUrl, this.dataDir, ["--branch", this.cfg.repoBranch]);
			this.git = simpleGit(this.dataDir);
		} else {
			const remotes = await this.git.getConfig("remote.origin.url");
			const existingUrl = remotes.value;
			if (existingUrl && existingUrl !== this.cfg.repoUrl) {
				throw new Error(
					`DATA_DIR (${this.dataDir}) already holds a clone of ${existingUrl}, which differs from ` +
						`the configured repo URL (${this.cfg.repoUrl}). Clear the volume to switch vaults.`
				);
			}
		}

		await this.git.addConfig("safe.directory", this.dataDir, false, "global");
		await this.git.addConfig("user.name", this.cfg.authorName);
		await this.git.addConfig("user.email", this.cfg.authorEmail);

		if (this.cfg.gitToken) {
			const host = new URL(this.cfg.repoUrl).host;
			const basicAuth = Buffer.from(`${this.cfg.gitUsername}:${this.cfg.gitToken}`).toString("base64");
			await this.git.addConfig(`http.https://${host}/.extraheader`, `Authorization: Basic ${basicAuth}`);
		}
	}

	/** Lightweight live reachability/auth check against the already-configured remote. */
	async checkRemote(): Promise<{ ok: true } | { ok: false; error: string }> {
		try {
			await this.git.listRemote(["origin", "HEAD"]);
			return { ok: true };
		} catch (err) {
			return { ok: false, error: (err as Error).message };
		}
	}

	async status() {
		const s = await this.git.status();
		return {
			branch: s.current,
			ahead: s.ahead,
			behind: s.behind,
			staged: s.staged,
			modified: s.modified,
			created: s.created,
			deleted: s.deleted,
			notAdded: s.not_added,
			conflicted: s.conflicted,
		};
	}

	async pull() {
		return this.git.pull("origin", this.cfg.repoBranch);
	}

	async commit(message: string) {
		await this.git.add(["-A"]);
		const status = await this.git.status();
		if (status.staged.length === 0) {
			return { committed: false, message: "Nothing to commit" };
		}
		const result = await this.git.commit(message);
		return { committed: true, commit: result.commit, summary: result.summary };
	}

	async push() {
		return this.git.push("origin", this.cfg.repoBranch);
	}

	async log(limit = 10) {
		const result = await this.git.log({ maxCount: limit });
		return result.all.map((entry) => ({
			hash: entry.hash,
			date: entry.date,
			message: entry.message,
			author: entry.author_name,
		}));
	}
}
