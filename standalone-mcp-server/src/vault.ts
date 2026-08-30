import * as fs from "fs/promises";
import * as path from "path";

// Files/folders that live in the repo but aren't part of the vault content.
const IGNORED_ENTRIES = new Set([".git"]);

export class Vault {
	private readonly root: string;

	constructor(root: string) {
		this.root = path.resolve(root);
	}

	/** Resolve a vault-relative path and reject anything that escapes the vault root. */
	resolve(relPath: string): string {
		const full = path.resolve(this.root, relPath);
		const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
		if (full !== this.root && !full.startsWith(rootWithSep)) {
			throw new Error(`Path escapes vault: ${relPath}`);
		}
		return full;
	}

	private toRelative(fullPath: string): string {
		return path.relative(this.root, fullPath).split(path.sep).join("/");
	}

	async listMarkdownFiles(folder?: string): Promise<string[]> {
		const results: string[] = [];
		const walk = async (dir: string) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (IGNORED_ENTRIES.has(entry.name)) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(full);
				} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
					results.push(this.toRelative(full));
				}
			}
		};
		await walk(this.root);
		return folder ? results.filter((p) => p.startsWith(folder)) : results;
	}

	async read(relPath: string): Promise<string> {
		return fs.readFile(this.resolve(relPath), "utf8");
	}

	async write(relPath: string, content: string): Promise<void> {
		const full = this.resolve(relPath);
		await fs.mkdir(path.dirname(full), { recursive: true });
		await fs.writeFile(full, content, "utf8");
	}

	async createFolder(relPath: string): Promise<void> {
		await fs.mkdir(this.resolve(relPath), { recursive: true });
	}

	async delete(relPath: string): Promise<void> {
		await fs.rm(this.resolve(relPath), { force: true, recursive: true });
	}

	async exists(relPath: string): Promise<boolean> {
		try {
			await fs.access(this.resolve(relPath));
			return true;
		} catch {
			return false;
		}
	}

	async search(query: string): Promise<{ path: string; snippet: string }[]> {
		const q = query.toLowerCase();
		const results: { path: string; snippet: string }[] = [];
		for (const relPath of await this.listMarkdownFiles()) {
			const text = await this.read(relPath);
			const idx = text.toLowerCase().indexOf(q);
			if (idx !== -1) {
				const start = Math.max(0, idx - 40);
				results.push({ path: relPath, snippet: text.slice(start, idx + 80) });
			}
		}
		return results;
	}
}
