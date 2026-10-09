import { type Palette, type Profile, type RGB, BALANCED, MUTED, risk, riskColor, thresholdRisk, zone } from "./smart-color.ts";

export interface Window {
	/** Short label shown before the bar, e.g. "5h", "7d", "wk". */
	label: string;
	/** Used fraction 0..1. */
	used: number;
	/** Unix seconds when the window resets. Omit for threshold-only gauges. */
	resetsAt?: number;
	/** Window length in seconds. Required with resetsAt. */
	windowSecs?: number;
}

export interface RenderOptions {
	width?: number;
	palette?: Palette;
	profile?: Profile;
	now?: number; // unix seconds
	color?: boolean; // emit ANSI truecolor
}

const ESC = "\x1b[";
const RST = `${ESC}0m`;
const DIM = `${ESC}2m`;
const fg = ([r, g, b]: RGB) => `${ESC}38;2;${r};${g};${b}m`;

export function elapsedFraction(resetsAt: number, windowSecs: number, now: number): number {
	const e = 1 - (resetsAt - now) / windowSecs;
	return e < 0 ? 0 : e > 1 ? 1 : e;
}

export function formatReset(resetsAt: number, now: number): string {
	let d = Math.max(0, resetsAt - now);
	if (d >= 86400) return `${Math.floor(d / 86400)}d${Math.floor((d % 86400) / 3600)}h`;
	return `${Math.floor(d / 3600)}h${String(Math.floor((d % 3600) / 60)).padStart(2, "0")}m`;
}

/** Render one quota window: `5h ████░░│░░░  42% ● 1h30m` */
export function renderWindow(w: Window, o: RenderOptions = {}): string {
	const width = o.width ?? 10;
	const pal = o.palette ?? MUTED;
	const prof = o.profile ?? BALANCED;
	const now = o.now ?? Math.floor(Date.now() / 1000);
	const color = o.color ?? true;
	const used = Math.max(0, Math.min(1, w.used));
	const pct = Math.round(used * 100);

	let r: number;
	let tick = -1;
	let glyph = "";
	let reset = "";
	if (w.resetsAt !== undefined && w.windowSecs) {
		const e = elapsedFraction(w.resetsAt, w.windowSecs, now);
		r = risk(used, e, prof);
		tick = Math.min(width - 1, Math.floor(e * width));
		const z = zone(r, prof);
		glyph = z === "warning" || z === "hot" ? " ▲" : " ●";
		reset = ` ${formatReset(w.resetsAt, now)}`;
	} else {
		r = thresholdRisk(used);
	}
	const rgb = riskColor(r, pal);
	const filled = Math.min(width, Math.floor(pct * width / 100));

	let bar = "";
	let cur = "";
	for (let i = 0; i < width; i++) {
		const ch = i === tick ? "│" : i < filled ? "█" : "░";
		if (color) {
			const want = i < filled ? "f" : "e";
			if (want !== cur) {
				bar += want === "f" ? fg(rgb) : DIM;
				cur = want;
			}
		}
		bar += ch;
	}
	const pctStr = `${String(pct).padStart(3)}%${glyph}`;
	return color ? `${w.label} ${bar}${RST} ${fg(rgb)}${pctStr}${RST}${reset}` : `${w.label} ${bar} ${pctStr}${reset}`;
}

/** Render a full line: `<name>  5h …  7d …` */
export function renderLine(name: string, windows: Window[], o: RenderOptions = {}): string {
	const color = o.color ?? true;
	const head = color ? `${ESC}1m${name}${RST}` : name;
	return [head, ...windows.map((w) => renderWindow(w, o))].join("  ");
}
