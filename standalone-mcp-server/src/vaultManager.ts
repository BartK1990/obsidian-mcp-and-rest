import { ConfigStore } from "./configStore.js";
import { deriveVaultName, type RuntimeConfig } from "./config.js";
import { VaultGit } from "./git.js";
import { Vault } from "./vault.js";

export type ConnectionState = "unconfigured" | "connecting" | "connected" | "error";

export interface VaultStatus {
	state: ConnectionState;
	vaultName: string | null;
	repoUrl?: string;
	repoBranch: string;
	gitUsername: string;
	gitTokenSet: boolean;
	authorName: string;
	authorEmail: string;
	lastError: string | null;
	git?: Awaited<ReturnType<VaultGit["status"]>>;
	remoteReachable?: boolean;
}

export class NotConnectedError extends Error {}

/** Orchestrates the git connection lifecycle so it can be (re)configured at
 *  runtime from the web UI instead of only once at process startup. */
export class VaultManager {
	private state: ConnectionState = "unconfigured";
	private lastError: string | null = null;
	private git: VaultGit | null = null;
	private vault: Vault | null = null;

	constructor(private readonly configStore: ConfigStore, private readonly dataDir: string) {}

	async connect(): Promise<void> {
		const cfg = this.configStore.get();
		if (!cfg.repoUrl) {
			this.state = "unconfigured";
			this.lastError = null;
			return;
		}

		this.state = "connecting";
		try {
			const git = new VaultGit(cfg, this.dataDir);
			await git.ensureRepo();
			this.git = git;
			this.vault = new Vault(this.dataDir);
			this.state = "connected";
			this.lastError = null;
		} catch (err) {
			this.state = "error";
			this.lastError = (err as Error).message;
		}
	}

	async applyConfig(patch: Partial<RuntimeConfig>): Promise<void> {
		this.configStore.update(patch);
		await this.connect();
	}

	requireVault(): Vault {
		if (this.state !== "connected" || !this.vault) {
			throw new NotConnectedError(
				this.lastError ?? "Vault isn't connected yet — configure the repo URL via the web UI."
			);
		}
		return this.vault;
	}

	requireGit(): VaultGit {
		if (this.state !== "connected" || !this.git) {
			throw new NotConnectedError(
				this.lastError ?? "Vault isn't connected yet — configure the repo URL via the web UI."
			);
		}
		return this.git;
	}

	async getStatus(): Promise<VaultStatus> {
		const cfg = this.configStore.get();
		const base: VaultStatus = {
			state: this.state,
			vaultName: deriveVaultName(cfg.repoUrl),
			repoUrl: cfg.repoUrl,
			repoBranch: cfg.repoBranch,
			gitUsername: cfg.gitUsername,
			gitTokenSet: !!cfg.gitToken,
			authorName: cfg.authorName,
			authorEmail: cfg.authorEmail,
			lastError: this.lastError,
		};

		if (this.state === "connected" && this.git) {
			base.git = await this.git.status();
			const remote = await this.git.checkRemote();
			base.remoteReachable = remote.ok;
			if (!remote.ok) base.lastError = remote.error;
		}

		return base;
	}
}
