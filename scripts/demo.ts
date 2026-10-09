import { renderLine } from "../src/render.ts";
const now = Math.floor(Date.now() / 1000);
const H = 3600;
// Chill CodexLB sample: low usage, plenty of window left.
console.log(renderLine("CodexLB", [
	{ label: "5h", used: 0.12, resetsAt: now + 4 * H, windowSecs: 5 * H },
	{ label: "7d", used: 0.08, resetsAt: now + 90 * H, windowSecs: 168 * H },
]));
// Hot CodexLB sample: 5h almost exhausted ahead of pace.
console.log(renderLine("CodexLB", [
	{ label: "5h", used: 0.92, resetsAt: now + 1.5 * H, windowSecs: 5 * H },
	{ label: "7d", used: 0.45, resetsAt: now + 27 * H, windowSecs: 168 * H },
]));
// Scoped buckets (model_filter) keep distinct labels.
console.log(renderLine("CodexLB", [
	{ label: "5h", used: 0.5, resetsAt: now + 2 * H, windowSecs: 5 * H },
	{ label: "5h·opus", used: 0.61, resetsAt: now + 2 * H, windowSecs: 5 * H },
]));
