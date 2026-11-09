import { useCallback, useEffect, useRef, useState } from "react";
import type { Message, MessageFilterOptions, MessageFolder } from "./types";
import {
	clearMessageCountsCache,
	clearMessageListCache,
	fetchMessageList,
	getMessageQueryParams,
	peekMessageList,
} from "./utils";

const REFRESH_DEBOUNCE_MS = 150;

export function useMessages(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
	enabled = true,
	folderId?: string | null,
) {
	// A folder switch remounts this hook, so paint the cached page immediately.
	const [initialPage] = useState(() => (
		enabled ? peekMessageList(getMessageQueryParams(folder, mailboxId, filters, folderId)) : undefined
	));
	const [messages, setMessages] = useState<Message[]>(initialPage?.messages ?? []);
	const [isLoading, setIsLoading] = useState(enabled && !initialPage);
	const [total, setTotal] = useState(initialPage?.total ?? 0);
	const [limit, setLimit] = useState(initialPage?.limit ?? filters?.limit ?? 25);
	const [offset, setOffset] = useState(initialPage?.offset ?? filters?.offset ?? 0);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const nextOffsetRef = useRef((initialPage?.offset ?? filters?.offset ?? 0) + (initialPage?.messages?.length ?? 0));
	const loadingMoreRef = useRef(false);
	const filterGenerationRef = useRef(0);
	const mountedRef = useRef(false);
	const filtersRef = useRef(filters);
	filtersRef.current = filters;

	const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read).length;

	useEffect(() => {
		if (!enabled) return;
		const filterGeneration = ++filterGenerationRef.current;
		loadingMoreRef.current = false;
		setIsLoadingMore(false);
		if (mountedRef.current) nextOffsetRef.current = filters?.offset ?? 0;
		mountedRef.current = true;
		let cancelled = false;
		let refreshTimer: number | null = null;
		let requestNumber = 0;
		async function loadMessages(force = false, showLoading = false) {
			const currentRequest = ++requestNumber;
			if (showLoading) setIsLoading(true);
			try {
				const params = getMessageQueryParams(folder, mailboxId, filters, folderId);
				const data = await fetchMessageList(params, force);
				if (!cancelled && currentRequest === requestNumber) {
					setMessages(data.messages ?? []);
					setTotal(data.total ?? 0);
					setLimit(data.limit ?? filters?.limit ?? 25);
					setOffset(data.offset ?? filters?.offset ?? 0);
					nextOffsetRef.current = (data.offset ?? filters?.offset ?? 0) + (data.messages?.length ?? 0);
				}
			} finally {
				if (!cancelled && currentRequest === requestNumber) setIsLoading(false);
			}
		}

		void loadMessages(false, !peekMessageList(getMessageQueryParams(folder, mailboxId, filters, folderId)));
		function patchReadState(event: Event) {
			const detail = (event as CustomEvent<{ kind?: string; messageIds?: string[]; read?: boolean }>).detail;
			if (detail?.kind !== "read" || !detail.messageIds?.length) return;
			const ids = new Set(detail.messageIds);
			const read = detail.read !== false;
			setMessages((current) => current.map((message) => {
				if (message.threadMessageIds) {
					// Only the flipped members change a conversation row's unread count.
					const threadSize = message.threadMessageIds.length;
					const flipped = message.threadMessageIds.reduce((total, id) => total + (ids.has(id) ? 1 : 0), 0);
					if (!flipped) return message;
					const threadUnread = Math.min(threadSize, Math.max(0, (message.threadUnread ?? 0) + (read ? -flipped : flipped)));
					return { ...message, read: threadUnread === 0, threadUnread };
				}
				return ids.has(message.id) ? { ...message, read } : message;
			}));
		}
		function onMessagesChanged(event: Event) {
			const kind = (event as CustomEvent<{ kind?: string }>).detail?.kind;
			const readOnly = kind === "read";
			// Read flips patch in place; "unread only" still needs a server refetch.
			if (readOnly && filters?.read !== "unread") return;
			if (!readOnly) {
				clearMessageListCache();
				clearMessageCountsCache();
			}
			if (document.visibilityState !== "visible") return;
			if (refreshTimer) window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				refreshTimer = null;
				void loadMessages(true, kind === "refresh");
			}, REFRESH_DEBOUNCE_MS);
		}
		window.addEventListener("mailos:messages-changed", onMessagesChanged);
		window.addEventListener("mailos:messages-changed", patchReadState);

		return () => {
			cancelled = true;
			window.removeEventListener("mailos:messages-changed", onMessagesChanged);
			window.removeEventListener("mailos:messages-changed", patchReadState);
			if (refreshTimer) window.clearTimeout(refreshTimer);
		};
	}, [enabled, filters?.group, filters?.limit, filters?.offset, filters?.query, filters?.read, filters?.title, folder, folderId, mailboxId]);

	const loadMore = useCallback(async () => {
		if (!enabled || loadingMoreRef.current || nextOffsetRef.current >= total) return;
		const filterGeneration = filterGenerationRef.current;
		loadingMoreRef.current = true;
		setIsLoadingMore(true);
		const requestedOffset = nextOffsetRef.current;
		try {
			const currentFilters = filtersRef.current;
			const params = getMessageQueryParams(folder, mailboxId, { ...currentFilters, offset: requestedOffset }, folderId);
			const data = await fetchMessageList(params);
			if (filterGeneration !== filterGenerationRef.current) return;
			const nextMessages = data.messages ?? [];
			setMessages((current) => {
				const seen = new Set(current.map((message) => message.id));
				return [...current, ...nextMessages.filter((message) => !seen.has(message.id))];
			});
			const nextTotal = data.total ?? total;
			setTotal(nextTotal);
			setLimit(data.limit ?? currentFilters?.limit ?? 25);
			const serverOffset = data.offset ?? requestedOffset;
			nextOffsetRef.current = nextMessages.length > 0 ? serverOffset + nextMessages.length : Math.max(nextTotal, requestedOffset + (data.limit ?? currentFilters?.limit ?? 25));
		} finally {
			if (filterGeneration === filterGenerationRef.current) {
				loadingMoreRef.current = false;
				setIsLoadingMore(false);
			}
		}
	}, [enabled, filters?.group, filters?.limit, filters?.offset, filters?.query, filters?.read, filters?.title, folder, folderId, mailboxId, total]);

	return { messages, unreadCount, isLoading, isLoadingMore, loadMore, total, limit, offset, updateMessages: setMessages };
}
