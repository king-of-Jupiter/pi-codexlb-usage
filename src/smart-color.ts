/**
 * Risk-aware color model (Balanced profile). Inspired by TokenEater's Smart Color:
 * https://github.com/AThevon/TokenEater/blob/main/docs/design/COLORING.md
 *
 * risk = max(absolute × projectionHealth, projection × confidence, pacing × confidence)
 * All inputs/outputs in [0, 1].
 */

export type Zone = "chill" | "ontrack" | "warning" | "hot";
export type RGB = readonly [number, number, number];

export interface Profile {
	k: number; // confidence growth
	projUpper: number; // projection saturation (u/e)
	absLower: number;
	absUpper: number;
	margin: number; // pacing margin (fraction)
	zones: readonly [number, number, number]; // rising thresholds chill|ontrack|warning|hot
}

export const BALANCED: Profile = { k: 5, projUpper: 1.4, absLower: 0.5, absUpper: 1.0, margin: 0.1, zones: [0.3, 0.55, 0.78] };
export const PATIENT: Profile = { k: 3, projUpper: 1.6, absLower: 0.55, absUpper: 1.05, margin: 0.1, zones: [0.38, 0.62, 0.85] };
export const VIGILANT: Profile = { k: 8, projUpper: 1.2, absLower: 0.45, absUpper: 0.9, margin: 0.1, zones: [0.22, 0.45, 0.68] };

export interface Palette {
	normal: RGB;
	warning: RGB;
	critical: RGB;
}

/** Muted green/amber/red (default). */
export const MUTED: Palette = { normal: [127, 184, 138], warning: [217, 163, 91], critical: [207, 107, 107] };
/** Vivid green/amber/red. */
export const VIVID: Palette = { normal: [34, 197, 94], warning: [249, 115, 22], critical: [239, 68, 68] };
/** Pastel green/amber/red. */
export const PASTEL: Palette = { normal: [134, 239, 172], warning: [253, 230, 138], critical: [252, 165, 165] };

export function smoothstep(a: number, b: number, x: number): number {
	if (x <= a) return 0;
	if (x >= b) return 1;
	const t = (x - a) / (b - a);
	return t * t * (3 - 2 * t);
}

/** Continuous risk for a quota window. u = used fraction, e = elapsed fraction of the window. */
export function risk(u: number, e: number, p: Profile = BALANCED): number {
	u = clamp01(u);
	e = clamp01(e);
	const conf = 1 - Math.exp(-p.k * e);
	const proj = e > 0 ? u / e : u > 0 ? 99 : 0;
	const projHealth = smoothstep(0.7, 1.0, proj);
	const absR = smoothstep(p.absLower, p.absUpper, u) * projHealth;
	const projR = smoothstep(1.0, p.projUpper, proj) * conf;
	const paceR = smoothstep(p.margin, p.margin + 0.15, u - e) * conf;
	return Math.max(absR, projR, paceR);
}

/** Static threshold gauge (no reset window), mapped onto the same 0..1 ramp. 60% warn / 85% critical. */
export function thresholdRisk(u: number, warn = 0.6, crit = 0.85): number {
	u = clamp01(u);
	if (u >= crit) return 1;
	if (u >= warn) return 0.55 + (0.3 * (u - warn)) / (crit - warn);
	return (0.3 * u) / warn;
}

export function zone(r: number, p: Profile = BALANCED): Zone {
	const [a, b, c] = p.zones;
	return r < a ? "chill" : r < b ? "ontrack" : r < c ? "warning" : "hot";
}

/** Risk → color. HSB interpolation across stops 0/.30 normal, .55 warning, .85/1 critical. */
export function riskColor(r: number, pal: Palette = MUTED): RGB {
	if (r <= 0.3) return pal.normal;
	if (r < 0.55) return lerpHsb(pal.normal, pal.warning, (r - 0.3) / 0.25);
	if (r < 0.85) return lerpHsb(pal.warning, pal.critical, (r - 0.55) / 0.3);
	return pal.critical;
}

// ---- color math ----
function clamp01(x: number): number {
	return x < 0 ? 0 : x > 1 ? 1 : x;
}

function toHsv([r, g, b]: RGB): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const mx = Math.max(r, g, b);
	const mn = Math.min(r, g, b);
	const d = mx - mn;
	let h = 0;
	if (d !== 0) {
		if (mx === r) h = 60 * (((g - b) / d) % 6);
		else if (mx === g) h = 60 * ((b - r) / d + 2);
		else h = 60 * ((r - g) / d + 4);
	}
	if (h < 0) h += 360;
	return [h, mx === 0 ? 0 : d / mx, mx];
}

function toRgb(h: number, s: number, v: number): RGB {
	const c = v * s;
	const hh = h / 60;
	const x = c * (1 - Math.abs((hh % 2) - 1));
	const m = v - c;
	let r = 0,
		g = 0,
		b = 0;
	if (hh < 1) [r, g, b] = [c, x, 0];
	else if (hh < 2) [r, g, b] = [x, c, 0];
	else if (hh < 3) [r, g, b] = [0, c, x];
	else if (hh < 4) [r, g, b] = [0, x, c];
	else if (hh < 5) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function lerpHsb(a: RGB, b: RGB, t: number): RGB {
	const [h1, s1, v1] = toHsv(a);
	const [h2, s2, v2] = toHsv(b);
	let d = h2 - h1;
	if (d > 180) d -= 360;
	if (d < -180) d += 360;
	let h = h1 + d * t;
	if (h < 0) h += 360;
	if (h >= 360) h -= 360;
	return toRgb(h, s1 + (s2 - s1) * t, v1 + (v2 - v1) * t);
}
