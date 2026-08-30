import * as fs from "fs";
import * as path from "path";
import type { RuntimeConfig } from "./config.js";

/**
 * Holds the current git connection settings and persists them to a JSON
 * file (outside the git working tree — see config.ts) so changes made via
 * the web UI survive a container restart. On first boot, if no file exists
 * yet, env-var-seeded defaults are used as the starting point but are not
 * written to disk until an explicit save.
 */
export class ConfigStore {
	private current: RuntimeConfig;

	constructor(private readonly filePath: string, seed: RuntimeConfig) {
		this.current = this.readFile() ?? seed;
	}

	private readFile(): RuntimeConfig | null {
		try {
			const raw = fs.readFileSync(this.filePath, "utf8");
			return JSON.parse(raw) as RuntimeConfig;
		} catch {
			return null;
		}
	}

	get(): RuntimeConfig {
		return { ...this.current };
	}

	/** Merge `patch` into the current config and persist it. `gitToken` is only
	 *  replaced when explicitly present and non-empty — an omitted/blank field
	 *  keeps whatever token is already stored. */
	update(patch: Partial<RuntimeConfig>): RuntimeConfig {
		const next: RuntimeConfig = {
			...this.current,
			...patch,
			gitToken: patch.gitToken ? patch.gitToken : this.current.gitToken,
		};
		this.current = next;
		fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
		fs.writeFileSync(this.filePath, JSON.stringify(next, null, 2), "utf8");
		return this.get();
	}
}
