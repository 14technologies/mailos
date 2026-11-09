"use client";

import { useEffect, useState } from "react";
import { Download, X } from "@/components/icons";
import { BrandIcon } from "./branding-provider";
import { useLanguage } from "./language-provider";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "mailos-install-dismissed-at";
const DISMISS_DAYS = 7;

function isInstalled() {
	if (typeof window === "undefined") return true;
	return ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches)
		|| (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function recentlyDismissed() {
	try {
		const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
		return at > 0 && Date.now() - at < DISMISS_DAYS * 86400000;
	} catch {
		return false;
	}
}

function isIosSafari() {
	const ua = navigator.userAgent;
	const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

/** Offers to install MailOS as an app: one tap on Android and desktop, short steps on iPhone. */
export function InstallAppPrompt() {
	const { t } = useLanguage();
	const [event, setEvent] = useState<InstallEvent | null>(null);
	const [ios, setIos] = useState(false);
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (isInstalled() || recentlyDismissed()) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onPrompt = (e: Event) => {
			e.preventDefault();
			setEvent(e as InstallEvent);
			timer = setTimeout(() => setOpen(true), 1500);
		};
		const onInstalled = () => setOpen(false);
		window.addEventListener("beforeinstallprompt", onPrompt);
		window.addEventListener("appinstalled", onInstalled);
		if (isIosSafari()) {
			setIos(true);
			timer = setTimeout(() => setOpen(true), 2500);
		}
		return () => {
			if (timer) clearTimeout(timer);
			window.removeEventListener("beforeinstallprompt", onPrompt);
			window.removeEventListener("appinstalled", onInstalled);
		};
	}, []);

	function dismiss() {
		setOpen(false);
		try {
			localStorage.setItem(DISMISS_KEY, String(Date.now()));
		} catch {
			/* private mode: show again next time */
		}
	}

	async function install() {
		if (!event) return;
		await event.prompt();
		const choice = await event.userChoice.catch(() => null);
		setEvent(null);
		if (choice?.outcome === "accepted") setOpen(false);
		else dismiss();
	}

	if (!open || (!event && !ios)) return null;
	return (
		<div
			role="dialog"
			aria-label={t("install.title")}
			className="fixed inset-x-3 bottom-[calc(0.75rem+var(--bottom-nav,0px))] z-[60] md:bottom-3 mx-auto flex max-w-md items-center gap-3 rounded-2xl border p-3 shadow-2xl"
			style={{ background: "#111417", borderColor: "#23292e", color: "#e8eaed", paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))", animation: "mos-install-in .45s cubic-bezier(.2,.9,.25,1) both" }}
		>
			<style>{"@keyframes mos-install-in{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){[role=dialog]{animation:none!important}}"}</style>
			<BrandIcon width={44} height={44} className="rounded-xl" />
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold">{t("install.title")}</p>
				<p className="text-xs" style={{ color: "#9aa0a6" }}>{ios ? t("install.iosBody") : t("install.body")}</p>
			</div>
			{!ios && (
				<button type="button" onClick={install} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: "#14b8a6", color: "#04201d" }}>
					<Download className="h-4 w-4" />
					{t("install.button")}
				</button>
			)}
			<button type="button" onClick={dismiss} aria-label={t("install.later")} className="shrink-0 rounded-lg p-1.5" style={{ color: "#9aa0a6" }}>
				<X className="h-4 w-4" />
			</button>
		</div>
	);
}
