/**
 * Persistent config for the codex-lb endpoint.
 *
 * pi / oh-my-pi extensions get no settings/storage API from the host
 * (see `ExtensionContext`: only ui, cwd, modelRegistry, timers), so the
 * extension keeps its own file:
 *
 *   ~/.config/pi-codexlb-usage/config.json   (XDG_CONFIG_HOME respected)
 *
 * Env vars keep working and win per-field (good for ephemeral runs/CI).
 * The file is created with mode 0600; the token is never logged.
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";

export interface FileConfig {
	endpointUrl?: string;
	bearerToken?: string;
	label?: string;
}

export interface LoadedFile {
	values: FileConfig;
	exists: boolean;
	corrupt: boolean;
	/** Read/parse failure reason (never contains the token). */
	error?: string;
	path: string;
}

export type FieldSource = "env" | "file" | "none";

export interface ResolvedConfig {
	url: string;
	token: string;
	label: string;
	urlFrom: FieldSource;
	tokenFrom: FieldSource;
	labelFrom: FieldSource | "default";
	/** Path of the config file that was consulted. */
	path: string;
	/** Set when the file exists but could not be read/parsed. */
	fileError?: string;
}

export function configFilePath(env: Record<string, string | undefined> = process.env): string {
	const override = (env.CODEXLB_CONFIG ?? "").trim();
	if (override) return override;
	const base = (env.XDG_CONFIG_HOME ?? "").trim() || join(homedir(), ".config");
	return join(base, "pi-codexlb-usage", "config.json");
}

function pickStrings(json: unknown): FileConfig | null {
	if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
	const r = json as Record<string, unknown>;
	const out: FileConfig = {};
	if (typeof r.endpointUrl === "string") out.endpointUrl = r.endpointUrl;
	if (typeof r.bearerToken === "string") out.bearerToken = r.bearerToken;
	if (typeof r.label === "string") out.label = r.label;
	return out;
}

export async function loadFileConfig(filePath?: string, env: Record<string, string | undefined> = process.env): Promise<LoadedFile> {
	const p = filePath ?? configFilePath(env);
	let text: string;
	try {
		text = await readFile(p, "utf8");
	} catch (e: any) {
		if (e?.code === "ENOENT" || e?.code === "ENOTDIR") return { values: {}, exists: false, corrupt: false, path: p };
		return { values: {}, exists: true, corrupt: true, error: `cannot read config file: ${e instanceof Error ? e.message : String(e)}`, path: p };
	}
	try {
		const values = pickStrings(JSON.parse(text));
		if (!values) return { values: {}, exists: true, corrupt: true, error: "config file is not a JSON object", path: p };
		return { values, exists: true, corrupt: false, path: p };
	} catch (e) {
		return { values: {}, exists: true, corrupt: true, error: `config file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, path: p };
	}
}

/** Merge patch over the stored file (absent file = start empty). Returns the file path. */
export async function saveFileConfig(patch: FileConfig, filePath?: string, env: Record<string, string | undefined> = process.env): Promise<string> {
	const p = filePath ?? configFilePath(env);
	const prev = await loadFileConfig(p, env);
	const next = {
		endpointUrl: patch.endpointUrl !== undefined ? patch.endpointUrl : (prev.values.endpointUrl ?? ""),
		bearerToken: patch.bearerToken !== undefined ? patch.bearerToken : (prev.values.bearerToken ?? ""),
		label: patch.label !== undefined ? patch.label : (prev.values.label ?? ""),
	};
	await mkdir(dirname(p), { recursive: true, mode: 0o700 });
	await writeFile(p, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
	try {
		await chmod(p, 0o600); // writeFile mode applies only on creation; enforce for existing files (best effort)
	} catch {
		/* e.g. Windows: modes are advisory */
	}
	return p;
}

/** Env per-field wins over the file; label falls back to "CodexLB". Never throws. */
export async function resolveConfig(env: Record<string, string | undefined> = process.env): Promise<ResolvedConfig> {
	const p = configFilePath(env);
	const file = await loadFileConfig(p, env);
	const envUrl = (env.CODEXLB_URL ?? env.CODEXLB_USAGE_URL ?? "").trim();
	const envToken = (env.CODEXLB_TOKEN ?? env.CODEXLB_BEARER_TOKEN ?? "").trim();
	const envLabel = (env.CODEXLB_LABEL ?? "").trim();
	const fileUrl = (file.values.endpointUrl ?? "").trim();
	const fileToken = (file.values.bearerToken ?? "").trim();
	const fileLabel = (file.values.label ?? "").trim();
	const url = envUrl || fileUrl;
	const token = envToken || fileToken;
	return {
		url,
		token,
		label: envLabel || fileLabel || "CodexLB",
		urlFrom: envUrl ? "env" : fileUrl ? "file" : "none",
		tokenFrom: envToken ? "env" : fileToken ? "file" : "none",
		labelFrom: envLabel ? "env" : fileLabel ? "file" : "default",
		path: p,
		...(file.corrupt && file.error ? { fileError: file.error } : {}),
	};
}

/** Masked token for status output, e.g. "••••abcd". Never reveals more than 4 chars. */
export function maskToken(token: string): string {
	if (!token) return "(missing)";
	return token.length <= 4 ? "••••" : `••••${token.slice(-4)}`;
}
