import type { Subscription } from "./types.ts";

/**
 * Keeps the freshest window set per provider. CodexLB API and header data merge by window label,
 * so label is the window identity — every source must emit distinct labels per provider.
 */
export class SubscriptionStore {
	#subs = new Map<string, Subscription>();

	upsert(s: Subscription | undefined): boolean {
		if (!s) return false;
		const prev = this.#subs.get(s.provider);
		if (!prev) {
			this.#subs.set(s.provider, s);
			return true;
		}
		// Merge: newer data overrides per label; keep labels the new sample lacks.
		const byLabel = new Map(prev.windows.map((w) => [w.label, w]));
		for (const w of s.windows) byLabel.set(w.label, w);
		this.#subs.set(s.provider, { ...prev, ...s, name: s.name.length >= prev.name.length ? s.name : prev.name, windows: [...byLabel.values()] });
		return true;
	}

	upsertMany(list: Subscription[]): void {
		for (const s of list) this.upsert(s);
	}

	all(): Subscription[] {
		return [...this.#subs.values()].sort((a, b) => a.name.localeCompare(b.name));
	}

	get size(): number {
		return this.#subs.size;
	}
}
