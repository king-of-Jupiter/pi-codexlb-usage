import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ext from "../src/extension.ts";

const URL = "https://lb.example.com/api/usage";
// Never-created path: keeps tests hermetic when a real ~/.config file exists.
const NOCFG = join(tmpdir(), "codexlb-definitely-missing-config.json");

/** Fake host: records handlers, widget calls, notifications. */
function fakeHost() {
	const handlers: Record<string, Function[]> = {};
	const commands: Record<string, Function> = {};
	const widgets: any[] = [];
	const notes: { msg: string; level?: string }[] = [];
	const ctx: any = {
		hasUI: true,
		model: { provider: "openai-codex", id: "gpt-5" },
		ui: {
			setWidget: (k: string, lines: any, o: any) => widgets.push([k, lines, o]),
			notify: (m: string, level?: string) => notes.push({ msg: m, level }),
		},
	};
	const api = {
		on: (e: string, h: Function) => (handlers[e] ??= []).push(h),
		registerCommand: (n: string, d: any) => (commands[n] = d.handler),
	};
	ext(api as any);
	const fire = async (e: string, ev: any) => { for (const h of handlers[e] ?? []) await h(ev, ctx); };
	return { fire, commands, widgets, notes, ctx };
}

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>) {
	const saved: Record<string, string | undefined> = {};
	for (const k of Object.keys(env)) {
		saved[k] = process.env[k];
		if (env[k] === undefined) delete process.env[k];
		else process.env[k] = env[k];
	}
	return fn().finally(() => {
		for (const k of Object.keys(env)) {
			if (saved[k] === undefined) delete process.env[k];
			else process.env[k] = saved[k];
		}
	});
}

function mockFetch(json: unknown, status = 200) {
	const orig = globalThis.fetch;
	let seenAuth: string | undefined;
	globalThis.fetch = (async (_u: any, init: any) => {
		seenAuth = init?.headers?.Authorization;
		return { status, ok: status >= 200 && status < 300, json: async () => json };
	}) as any;
	return { restore: () => { globalThis.fetch = orig; }, seenAuth: () => seenAuth };
}

const payload = {
	limits: [
		{ limit_window: "5h", max_value: 100, current_value: 42, reset_at: new Date(Date.now() + 3600e3).toISOString() },
		{ limit_window: "7d", max_value: 1000, current_value: 110, reset_at: new Date(Date.now() + 86400e3).toISOString() },
	],
};

test("session_start polls codexlb with Bearer token and renders below the editor", async () => {
	await withEnv({ CODEXLB_URL: URL, CODEXLB_TOKEN: "tok-123", CODEXLB_CONFIG: NOCFG }, async () => {
		const f = mockFetch(payload);
		try {
			const h = fakeHost();
			await h.fire("session_start", { reason: "startup" });
			assert.equal(f.seenAuth(), "Bearer tok-123");
			const last = h.widgets.at(-1)!;
			assert.equal(last[0], "usage-limits");
			assert.equal(last[2].placement, "belowEditor");
			assert.match(last[1][0], /CodexLB/);
			assert.match(last[1][0], /5h .*42%/);
			assert.match(last[1][0], /7d .*11%/);
			await h.fire("session_shutdown", {});
		} finally { f.restore(); }
	});
});

test("headers on a reply fill in even without codexlb config", async () => {
	await withEnv({ CODEXLB_URL: undefined, CODEXLB_USAGE_URL: undefined, CODEXLB_TOKEN: undefined, CODEXLB_BEARER_TOKEN: undefined, CODEXLB_CONFIG: NOCFG }, async () => {
		const h = fakeHost();
		await h.fire("session_start", { reason: "startup" });
		await h.fire("after_provider_response", {
			status: 200,
			headers: {
				"x-codex-primary-used-percent": "37",
				"x-codex-primary-window-minutes": "300",
				"x-codex-secondary-used-percent": "12",
				"x-codex-secondary-window-minutes": "10080",
			},
		});
		const last = h.widgets.at(-1)!;
		assert.match(last[1][0], /ChatGPT/);
		assert.match(last[1][0], /5h .*37%/);
		await h.fire("session_shutdown", {});
	});
});

test("/limits toggle hides and shows; default prints plain text with source", async () => {
	await withEnv({ CODEXLB_URL: URL, CODEXLB_TOKEN: "t", CODEXLB_CONFIG: NOCFG }, async () => {
		const f = mockFetch(payload);
		try {
			const h = fakeHost();
			await h.fire("session_start", {});
			await h.commands.limits("toggle", h.ctx);
			assert.equal(h.widgets.at(-1)![1], undefined);
			await h.commands.limits("toggle", h.ctx);
			assert.ok(Array.isArray(h.widgets.at(-1)![1]));
			await h.commands.limits("", h.ctx);
			assert.match(h.notes.at(-1)!.msg, /CodexLB.*42%.*\[codexlb-api\]/);
			assert.doesNotMatch(h.notes.at(-1)!.msg, /\x1b/);
			await h.fire("session_shutdown", {});
		} finally { f.restore(); }
	});
});

test("/limits status shows the endpoint host but never the token", async () => {
	await withEnv({ CODEXLB_URL: URL, CODEXLB_TOKEN: "super-secret", CODEXLB_LABEL: "MyLB", CODEXLB_CONFIG: NOCFG }, async () => {
		const f = mockFetch(payload);
		try {
			const h = fakeHost();
			await h.fire("session_start", {});
			await h.commands.limits("status", h.ctx);
			const msg = h.notes.at(-1)!.msg;
			assert.match(msg, /lb\.example\.com/);
			assert.match(msg, /MyLB/);
			assert.doesNotMatch(msg, /super-secret/);
			await h.fire("session_shutdown", {});
		} finally { f.restore(); }
	});
});

test("/limits without config warns with a setup hint", async () => {
	await withEnv({ CODEXLB_URL: undefined, CODEXLB_USAGE_URL: undefined, CODEXLB_TOKEN: undefined, CODEXLB_BEARER_TOKEN: undefined, CODEXLB_CONFIG: NOCFG }, async () => {
		const h = fakeHost();
		await h.fire("session_start", {});
		await h.commands.limits("", h.ctx);
		assert.equal(h.notes.at(-1)!.level, "warning");
		assert.match(h.notes.at(-1)!.msg, /CODEXLB_URL/);
		await h.fire("session_shutdown", {});
	});
});

test("/limits palette rejects unknown names", async () => {
	await withEnv({ CODEXLB_URL: URL, CODEXLB_TOKEN: "t", CODEXLB_CONFIG: NOCFG }, async () => {
		const f = mockFetch(payload);
		try {
			const h = fakeHost();
			await h.fire("session_start", {});
			await h.commands.limits("palette neon", h.ctx);
			assert.equal(h.notes.at(-1)!.level, "warning");
			assert.match(h.notes.at(-1)!.msg, /muted, vivid or pastel/);
			await h.fire("session_shutdown", {});
		} finally { f.restore(); }
	});
});

test("/limits set-url + set-token persist to a file and render, /limits config masks the token", async () => {
	const dir = await mkdtemp(join(tmpdir(), "codexlb-ext-"));
	const cfg = join(dir, "config.json");
	await withEnv({ CODEXLB_URL: undefined, CODEXLB_USAGE_URL: undefined, CODEXLB_TOKEN: undefined, CODEXLB_BEARER_TOKEN: undefined, CODEXLB_CONFIG: cfg }, async () => {
		const f = mockFetch(payload);
		try {
			const h = fakeHost();
			await h.fire("session_start", {});
			assert.match(h.notes.at(-1)!.msg, /set-url/); // one-time setup hint
			await h.commands.limits("set-url notaurl", h.ctx);
			assert.equal(h.notes.at(-1)!.level, "warning");
			await h.commands.limits(`set-url ${URL}`, h.ctx);
			assert.equal(h.notes.at(-1)!.level, "warning"); // saved, but no token yet
			assert.match(h.notes.at(-1)!.msg, /lb\.example\.com/);
			await h.commands.limits("set-token tok-abc", h.ctx);
			assert.equal(h.notes.at(-1)!.level, "info");
			assert.match(h.notes.at(-1)!.msg, /token saved/);
			const last = h.widgets.at(-1)!;
			assert.match(last[1][0], /CodexLB.*5h .*42%/);
			const saved = JSON.parse(await readFile(cfg, "utf8"));
			assert.equal(saved.endpointUrl, URL);
			assert.equal(saved.bearerToken, "tok-abc");
			await h.commands.limits("config", h.ctx);
			const msg = h.notes.at(-1)!.msg;
			assert.match(msg, /config file/);
			assert.match(msg, /lb\.example\.com \(file\)/);
			assert.doesNotMatch(msg, /tok-abc/);
			await h.fire("session_shutdown", {});
		} finally { f.restore(); }
	});
});
