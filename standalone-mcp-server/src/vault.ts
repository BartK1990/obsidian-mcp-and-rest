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

	/** Walk the vault, collecting both markdown files and folders (including empty ones). */
	async listEntries(folder?: string): Promise<{ path: string; type: "file" | "folder" }[]> {
		const results: { path: string; type: "file" | "folder" }[] = [];
		const walk = async (dir: string) => {
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (IGNORED_ENTRIES.has(entry.name)) continue;
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					results.push({ path: this.toRelative(full), type: "folder" });
					await walk(full);
				} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
					results.push({ path: this.toRelative(full), type: "file" });
				}
			}
		};
		await walk(this.root);
		return folder ? results.filter((e) => e.path.startsWith(folder)) : results;
	}

	async listMarkdownFiles(folder?: string): Promise<string[]> {
		return (await this.listEntries(folder)).filter((e) => e.type === "file").map((e) => e.path);
	}

	/** List folder paths in the vault, including empty ones — folders never show up in listMarkdownFiles. */
	async listFolders(folder?: string): Promise<string[]> {
		return (await this.listEntries(folder)).filter((e) => e.type === "folder").map((e) => e.path);
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
