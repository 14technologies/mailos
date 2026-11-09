"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "mailos-chat-conversation-style";
const CHANGE_EVENT = "mailos:chat-conversation-style-changed";

function readStored() {
	try { return localStorage.getItem(STORAGE_KEY) === "on"; } catch { return false; }
}
function subscribe(onStoreChange: () => void) {
	window.addEventListener(CHANGE_EVENT, onStoreChange);
	window.addEventListener("storage", onStoreChange);
	return () => {
		window.removeEventListener(CHANGE_EVENT, onStoreChange);
		window.removeEventListener("storage", onStoreChange);
	};
}

export function useChatConversationStyle(): [boolean, (enabled: boolean) => void] {
	const enabled = useSyncExternalStore(subscribe, readStored, () => false);
	const setEnabled = useCallback((next: boolean) => {
		try { localStorage.setItem(STORAGE_KEY, next ? "on" : "off"); } catch { /* Session still updates below. */ }
		window.dispatchEvent(new Event(CHANGE_EVENT));
	}, []);
	return [enabled, setEnabled];
}
