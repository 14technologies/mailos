export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "mailflare-theme";
export const THEME_CHANGED_EVENT = "mailos:theme-changed";

/** Accent colours each person can pick (Settings → Inbox → Accent colour). The CSS lives at the end
 * of globals.css; "blue" is the original palette and needs no override. */
export const ACCENTS = [
	{ id: "mailos", label: "MailOS Teal", swatch: "#2ee6d6" },
	{ id: "blue", label: "Ocean Blue", swatch: "#2563eb" },
	{ id: "emerald", label: "Emerald", swatch: "#059669" },
	{ id: "violet", label: "Violet", swatch: "#7c3aed" },
	{ id: "orange", label: "Sunset Orange", swatch: "#ea580c" },
	{ id: "rose", label: "Rose", swatch: "#e11d48" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"] | "custom";
const ACCENT_IDS: string[] = [...ACCENTS.map((accent) => accent.id), "custom"];
export const ACCENT_STORAGE_KEY = "mailos-accent";
export const CUSTOM_ACCENT_STORAGE_KEY = "mailos-custom-accent";
export const DEFAULT_ACCENT: AccentId = "mailos";
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isAccentId(value: unknown): value is AccentId {
	return typeof value === "string" && ACCENT_IDS.includes(value);
}

export function readAccent(): AccentId {
	if (typeof window === "undefined") return DEFAULT_ACCENT;
	try {
		const saved = localStorage.getItem(ACCENT_STORAGE_KEY);
		return isAccentId(saved) ? saved : DEFAULT_ACCENT;
	} catch {
		return DEFAULT_ACCENT;
	}
}

export function readCustomAccent(): string {
	if (typeof window === "undefined") return "#15b8a6";
	try {
		const saved = localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY);
		return saved && HEX_COLOR_PATTERN.test(saved) ? saved : "#15b8a6";
	} catch {
		return "#15b8a6";
	}
}

function applyAccent(accent: AccentId, customColor = readCustomAccent()) {
	if (typeof document === "undefined") return;
	document.documentElement.dataset.accent = accent;
	if (accent === "custom") document.documentElement.style.setProperty("--user-accent", customColor);
	else document.documentElement.style.removeProperty("--user-accent");
}

export function saveAccent(accent: AccentId): void {
	try {
		localStorage.setItem(ACCENT_STORAGE_KEY, accent);
		localStorage.removeItem(CUSTOM_ACCENT_STORAGE_KEY);
	} catch {
		// Private windows may block storage; the colour still applies to this page.
	}
	applyAccent(accent);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: accent }));
}

export function saveCustomAccent(color: string): void {
	if (!HEX_COLOR_PATTERN.test(color)) return;
	try {
		localStorage.setItem(ACCENT_STORAGE_KEY, "custom");
		localStorage.setItem(CUSTOM_ACCENT_STORAGE_KEY, color);
	} catch {
		// Private windows may block storage; the colour still applies to this page.
	}
	applyAccent("custom", color);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: "custom" }));
}

export function applySavedAccent(): void {
	applyAccent(readAccent(), readCustomAccent());
}

// Runs in <head> before paint, so the first frame already has the right theme (same approach as the
// sidebar width). Keep it in sync with resolveTheme/applyTheme below.
export const themeBootstrapScript = `(() => {
	try {
		const saved = localStorage.getItem("mailflare-theme");
		const preference = saved === "light" || saved === "dark" || saved === "system" ? saved : "dark";
		const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
		document.documentElement.classList.toggle("dark", dark);
		document.documentElement.classList.toggle("light", !dark);
		const accent = localStorage.getItem("mailos-accent");
		const validAccent = ${JSON.stringify(ACCENT_IDS)}.includes(accent) ? accent : "mailos";
		document.documentElement.dataset.accent = validAccent;
		const customAccent = localStorage.getItem("mailos-custom-accent");
		if (validAccent === "custom" && /^#[0-9a-fA-F]{6}$/.test(customAccent || "")) document.documentElement.style.setProperty("--user-accent", customAccent);
	} catch {
		document.documentElement.classList.add("dark");
		document.documentElement.dataset.accent = "mailos";
	}
})();`;

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
	if (typeof window === "undefined") return "dark";
	try {
		const saved = localStorage.getItem(THEME_STORAGE_KEY);
		return isThemePreference(saved) ? saved : "dark";
	} catch {
		return "dark";
	}
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
	if (preference !== "system") return preference;
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(preference: ThemePreference): void {
	if (typeof document === "undefined") return;
	const dark = resolveTheme(preference) === "dark";
	document.documentElement.classList.toggle("dark", dark);
	document.documentElement.classList.toggle("light", !dark);
}

export function saveThemePreference(preference: ThemePreference): void {
	try {
		// Store "system" too: with no saved value MailOS defaults to dark.
		localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// Storage can be unavailable in private windows; the theme still applies for this page.
	}
	applyTheme(preference);
	if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: preference }));
}
