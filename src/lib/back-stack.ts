"use client";

import { useEffect, useRef } from "react";

/**
 * The phone's back button closes whatever is open on top (a menu, a dialog, the composer, the
 * slide-out menu) before it leaves the page, like a native mail app. Things that open register a
 * handler here; the Android app calls `window.__mailosBack()` first and only navigates back or
 * offers to exit when it returns false.
 */
type BackHandler = () => void;
const handlers: BackHandler[] = [];

export function pushBackHandler(handler: BackHandler): () => void {
	handlers.push(handler);
	return () => {
		const index = handlers.lastIndexOf(handler);
		if (index >= 0) handlers.splice(index, 1);
	};
}

export function handleBack(): boolean {
	// Menus, dialogs and sheets (Radix) close on Escape, and sit above everything else.
	const overlay = document.querySelector('[role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="listbox"][data-state="open"]');
	if (overlay) {
		(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
		return true;
	}
	const top = handlers[handlers.length - 1];
	if (top) {
		top();
		return true;
	}
	return false;
}

if (typeof window !== "undefined") {
	(window as Window & { __mailosBack?: () => boolean }).__mailosBack = handleBack;
}

/** While `active`, the back button runs `handler` (e.g. closes this panel) instead of going back. */
export function useBackHandler(active: boolean, handler: () => void) {
	const latest = useRef(handler);
	latest.current = handler;
	useEffect(() => {
		if (!active) return;
		return pushBackHandler(() => latest.current());
	}, [active]);
}
