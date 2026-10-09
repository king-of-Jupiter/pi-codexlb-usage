import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	configFilePath,
	loadFileConfig,
	maskToken,
	resolveConfig,
	saveFileConfig,
} from "../src/config.ts";

async function sandbox() {
	const dir = await mkdtemp(join(tmpdir(), "codexlb-cfg-"));
	return { dir, file: join(dir, "sub", "config.json") };
}

test("configFilePath: CODEXLB_CONFIG wins, XDG respected, default under home", () => {
	assert.equal(configFilePath({ CODEXLB_CONFIG: "/tmp/x.json" }), "/tmp/x.json");
	assert.equal(configFilePath({ XDG_CONFIG_HOME: "/xdg" }), join("/xdg", "pi-codexlb-usage", "config.json"));
	assert.match(configFilePath({}), /pi-codexlb-usage[\\/]config\.json$/);
});

test("save/load round-trip; file created with mode 0600", async () => {
	const { file } = await sandbox();
	const p = await saveFileConfig({ endpointUrl: "https://lb/x", bearerToken: "tok", label: "LB" }, file);
	assert.equal(p, file);
	const loaded = await loadFileConfig(file);
	assert.deepEqual(loaded.values, { endpointUrl: "https://lb/x", bearerToken: "tok", label: "LB" });
	assert.equal(loaded.exists, true);
	assert.equal(loaded.corrupt, false);
	const raw = await readFile(file, "utf8");
	assert.deepEqual(JSON.parse(raw), { endpointUrl: "https://lb/x", bearerToken: "tok", label: "LB" });
	if (process.platform !== "win32") {
		assert.equal((await stat(file)).mode & 0o777, 0o600);
	}
});

test("saveFileConfig merges over existing values", async () => {
	const { file } = await sandbox();
	await saveFileConfig({ endpointUrl: "https://a/1", bearerToken: "t1", label: "A" }, file);
	await saveFileConfig({ bearerToken: "t2" }, file);
	assert.deepEqual((await loadFileConfig(file)).values, { endpointUrl: "https://a/1", bearerToken: "t2", label: "A" });
});

test("loadFileConfig: missing file and corrupt file", async () => {
	const { dir } = await sandbox();
	const missing = await loadFileConfig(join(dir, "nope.json"));
	assert.deepEqual([missing.exists, missing.corrupt], [false, false]);
	const { writeFile } = await import("node:fs/promises");
	const file = join(dir, "config.json");
	await writeFile(file, "{not json", "utf8");
	const bad = await loadFileConfig(file);
	assert.equal(bad.exists, true);
	assert.equal(bad.corrupt, true);
	assert.match(bad.error!, /JSON/);
});

test("resolveConfig: env wins per-field over the file", async () => {
	const { file } = await sandbox();
	await saveFileConfig({ endpointUrl: "https://file/x", bearerToken: "file-tok", label: "File" }, file);
	const env = { CODEXLB_CONFIG: file, CODEXLB_URL: "https://env/x" };
	const r = await resolveConfig(env);
	assert.equal(r.url, "https://env/x");
	assert.equal(r.urlFrom, "env");
	assert.equal(r.token, "file-tok");
	assert.equal(r.tokenFrom, "file");
	assert.equal(r.label, "File");
	const plain = await resolveConfig({ CODEXLB_CONFIG: file });
	assert.deepEqual([plain.urlFrom, plain.tokenFrom, plain.labelFrom], ["file", "file", "file"]);
	const none = await resolveConfig({ CODEXLB_CONFIG: join(file, "..", "missing.json") });
	assert.deepEqual([none.url, none.token, none.label], ["", "", "CodexLB"]);
	assert.deepEqual([none.urlFrom, none.tokenFrom], ["none", "none"]);
});

test("resolveConfig surfaces a corrupt file as fileError", async () => {
	const { dir } = await sandbox();
	const file = join(dir, "config.json");
	const { writeFile } = await import("node:fs/promises");
	await writeFile(file, "[1,2]", "utf8"); // valid JSON, not an object
	const r = await resolveConfig({ CODEXLB_CONFIG: file, CODEXLB_URL: "https://env/x", CODEXLB_TOKEN: "t" });
	assert.match(r.fileError!, /JSON object/);
	assert.equal(r.url, "https://env/x"); // env still works
});

test("maskToken never reveals more than 4 chars", () => {
	assert.equal(maskToken(""), "(missing)");
	assert.equal(maskToken("abcd"), "••••");
	assert.equal(maskToken("super-secret-token"), "••••oken");
});
