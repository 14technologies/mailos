"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import type { TranslationKey } from "@/lib/i18n/types";
import { Select } from "@/components/ui/select";
import {
	ACCENTS,
	DEFAULT_ACCENT,
	isThemePreference,
	readAccent,
	readCustomAccent,
	readThemePreference,
	saveAccent,
	saveCustomAccent,
	type AccentId,
	saveThemePreference,
	THEME_CHANGED_EVENT,
	type ThemePreference,
} from "@/components/theme-utils";

const OPTIONS: { value: ThemePreference; labelKey: TranslationKey }[] = [
	{ value: "system", labelKey: "settings.theme.system" },
	{ value: "light", labelKey: "settings.theme.light" },
	{ value: "dark", labelKey: "settings.theme.dark" },
];

export function AppearanceSettings() {
	const { t } = useLanguage();
	const [preference, setPreference] = useState<ThemePreference>("dark");

	useEffect(() => {
		setPreference(readThemePreference());
		const sync = () => setPreference(readThemePreference());
		window.addEventListener(THEME_CHANGED_EVENT, sync);
		return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
	}, []);

	return (
		<>
		<label className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4">
			<span className="flex-1">
				<span className="block text-sm font-medium text-neutral-900">{t("settings.theme.label")}</span>
				<span className="mt-1 block text-sm text-neutral-500">
					{t("settings.theme.description")}
				</span>
			</span>
			<Select
				value={preference}
				aria-label={t("settings.theme.label")}
				className="py-1.5 text-sm text-neutral-900"
				onChange={(event) => {
					const next = event.target.value;
					if (!isThemePreference(next)) return;
					setPreference(next);
					saveThemePreference(next);
				}}
			>
				{OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{t(option.labelKey)}
					</option>
				))}
			</Select>
		</label>
		<AccentSettings />
		</>
	);
}

function AccentSettings() {
	const [accent, setAccent] = useState<AccentId>(DEFAULT_ACCENT);
	const [customColor, setCustomColor] = useState("#15b8a6");

	useEffect(() => {
		setAccent(readAccent());
		setCustomColor(readCustomAccent());
		const sync = () => {
			setAccent(readAccent());
			setCustomColor(readCustomAccent());
		};
		window.addEventListener(THEME_CHANGED_EVENT, sync);
		return () => window.removeEventListener(THEME_CHANGED_EVENT, sync);
	}, []);

	return (
		<div className="mt-3 rounded-xl bg-neutral-50 p-4">
			<span className="block text-sm font-medium text-neutral-900">Accent colour</span>
			<span className="mt-1 block text-sm text-neutral-500">
				Choose a preset or any colour for buttons, links, highlights and the MailOS mark. Saved in this browser.
			</span>
			<div role="radiogroup" aria-label="Accent colour" className="mt-3 flex flex-wrap gap-2">
				{ACCENTS.map((option) => {
					const selected = option.id === accent;
					return (
						<button
							key={option.id}
							type="button"
							role="radio"
							aria-checked={selected}
							onClick={() => {
								setAccent(option.id);
								saveAccent(option.id);
							}}
							className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm text-neutral-900 transition ${
								selected ? "border-neutral-900 bg-white font-medium" : "border-neutral-200 hover:border-neutral-400"
							}`}
						>
							<span aria-hidden className="h-4 w-4 rounded-full" style={{ background: option.swatch }} />
							{option.label}
						</button>
					);
				})}
			<button
				type="button"
				role="radio"
				aria-checked={accent === "custom"}
				onClick={() => {
					setAccent("custom");
					saveCustomAccent(customColor);
				}}
				className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm text-neutral-900 transition ${accent === "custom" ? "border-neutral-900 bg-white font-medium" : "border-neutral-200 hover:border-neutral-400"}`}
			>
				<span aria-hidden className="h-4 w-4 rounded-full" style={{ background: customColor }} />
				Custom
			</button>
			</div>
			<label className="mt-3 inline-flex min-h-11 items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 text-sm font-medium text-neutral-800">
				<span>Choose any colour</span>
				<input
					type="color"
					value={customColor}
					aria-label="Choose any accent colour"
					className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
					onChange={(event) => {
						const nextColor = event.target.value.toLowerCase();
						setCustomColor(nextColor);
						setAccent("custom");
						saveCustomAccent(nextColor);
					}}
				/>
				<span aria-hidden className="font-mono text-xs text-neutral-500">{customColor.toUpperCase()}</span>
			</label>
		</div>
	);
}
