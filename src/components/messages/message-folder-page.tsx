"use client";

import { useBackHandler } from "@/lib/back-stack";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent } from "react";
import { Archive, Check, ChevronLeft, ChevronRight, ListFilter, Mail, MailOpen, MoreVertical, RefreshCw, Search, Trash2 } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { usePageLoading } from "@/components/page-loading";
import { formatScheduledSendTime } from "./scheduled-send-utils";
import { useIsMobile } from "@/components/sidebar-mobile-utils";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { useMessages } from "@/hooks/use-messages";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import type { Message } from "@/hooks/types";
import { setMessageDragData } from "@/lib/messages/drag-utils";
import { BulkMessageToolbar } from "./bulk-message-toolbar";
import { useMessageListState } from "./message-list-state";
import { SwipeableRow } from "./swipeable-row";
import { MessageListRowActions } from "./message-list-row-actions";
import { dispatchMessageCountsDelta, toggleMessageStar } from "./message-list-row-actions-utils";
import { useMessageNavigation } from "./message-navigation";
import { rememberOpenedUnreadMessage } from "./message-detail-navigation-utils";
import { useConversationView } from "./use-conversation-view";
import { useChatConversationStyle } from "./use-chat-conversation-style";
import { OpenedIndicator } from "./message-open-status";
import type { MessageFolderPageProps, MessageListRowProps, RowMessageAction } from "./types";
import {
	formatMessageListTimestamp,
	getPageRange,
	getMessageParty,
	getMessagePartyClassName,
	getMessagePreview,
	getUnreadFlipCount,
	isMessageListRowUnread,
	formatEmailPageTitle,
	getMailboxAddress,
	runBulkMessageAction,
	emptyMessageFolder,
} from "./utils";
import {
	getEmptyFolderConfirmText,
	getEmptyFolderLabel,
	getPermanentDeleteFolderLabel,
	getPermanentDeleteConfirmText,
	PartialDeleteError,
	supportsPermanentDelete,
} from "@/lib/messages/permanent-delete-utils";
import clsx from "clsx";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { DueFollowUps } from "@/components/follow-ups/due-follow-ups";
import { PartyAvatar, getMessagePartyAddress } from "./party-avatar";

const pageSize = 25;

/** The finger lifting after a long press must not also tap whatever row slid under it. */
let suppressTapUntil = 0;

function MessageListRow({
	message,
	config,
	selected,
	active = false,
	opening = false,
	compact = false,
	selectionMode = false,
	showCheckboxes = selectionMode,
	onLongPressSelect,
	currentAccountName,
	onSelectedChange,
	onMessageAction,
	onOpening,
	dragMessageIds,
}: MessageListRowProps) {
	const { t } = useLanguage();
	const Icon = config.icon;
	const [read, setRead] = useState(message.read);
	const [threadUnread, setThreadUnread] = useState(message.threadUnread);
	const [starred, setStarred] = useState(message.starred);
	const holdTimer = useRef<number | null>(null);
	const holdStart = useRef({ x: 0, y: 0 });
	const longPressTriggered = useRef(false);
	useEffect(() => setRead(message.read), [message.read]);
	useEffect(() => setThreadUnread(message.threadUnread), [message.threadUnread]);
	useEffect(() => setStarred(message.starred), [message.starred]);
	const rowMessage = { ...message, read, starred, threadUnread };
	const unread = isMessageListRowUnread(rowMessage);
	// Drag-to-folder is for mice: on touch screens a held draggable row starts a drag, which
	// cancels press-and-hold selection.
	const coarsePointer = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
	const draggable = !coarsePointer && config.folder === "inbox" && message.direction === "inbound";
	const party = getMessageParty(rowMessage, config.folder, currentAccountName, t);
	const preview = getMessagePreview(rowMessage, config.folder, t);
	const href = `${config.hrefPrefix}/${message.id}`;
	const navigation = useMessageNavigation(href, rowMessage);

	const affectsInboxCount = config.folder === "inbox" && !config.folderId;
	useEffect(() => () => {
		if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
	}, []);
	function cancelHold() {
		if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
		holdTimer.current = null;
	}
	function onRowPointerDown(event: PointerEvent<HTMLDivElement>) {
		if ((event.pointerType !== "touch" && event.pointerType !== "pen") || event.button !== 0) return;
		longPressTriggered.current = false;
		holdStart.current = { x: event.clientX, y: event.clientY };
		cancelHold();
		holdTimer.current = window.setTimeout(() => {
			longPressTriggered.current = true;
			suppressTapUntil = performance.now() + 700;
			onLongPressSelect?.(message.id);
			if (typeof navigator !== "undefined") navigator.vibrate?.(10);
		}, 480);
	}
	function onRowPointerMove(event: PointerEvent<HTMLDivElement>) {
		if (holdTimer.current !== null && (Math.abs(event.clientX - holdStart.current.x) > 10 || Math.abs(event.clientY - holdStart.current.y) > 10)) cancelHold();
	}
	function onRowClickCapture(event: MouseEvent<HTMLDivElement>) {
		if (performance.now() < suppressTapUntil) {
			event.preventDefault();
			event.stopPropagation();
			longPressTriggered.current = false;
			return;
		}
		if (!longPressTriggered.current) return;
		event.preventDefault();
		event.stopPropagation();
		longPressTriggered.current = false;
	}
	const longPressHandlers = {
		onPointerDown: onRowPointerDown,
		onPointerMove: onRowPointerMove,
		onPointerUp: cancelHold,
		onPointerCancel: cancelHold,
		onPointerLeave: cancelHold,
		onClickCapture: onRowClickCapture,
		// Android reports a long press as a context-menu event: use it as a second trigger, and keep
		// the web view's own link menu from appearing over the list.
		onContextMenu: (event: MouseEvent<HTMLDivElement>) => {
			if (!coarsePointer && !longPressTriggered.current) return;
			event.preventDefault();
			if (longPressTriggered.current) return;
			cancelHold();
			longPressTriggered.current = true;
			suppressTapUntil = performance.now() + 700;
			onLongPressSelect?.(message.id);
			if (typeof navigator !== "undefined") navigator.vibrate?.(10);
		},
	};

	async function runRowAction(action: RowMessageAction) {
		const previousRead = read;
		const previousThreadUnread = threadUnread;
		const unreadDelta = !affectsInboxCount || (action !== "read" && action !== "unread")
			? 0
			: getUnreadFlipCount(rowMessage, action === "read") * (action === "read" ? -1 : 1);
		if (action === "read") setRead(true);
		if (action === "unread") setRead(false);
		// Grouped rows derive their unread styling from the thread count, so it must change with the row.
		if (message.threadMessageIds) {
			if (action === "read") setThreadUnread(0);
			if (action === "unread") setThreadUnread(message.threadMessageIds.length);
		}
		if (unreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta: unreadDelta });
		try {
			await onMessageAction(message.id, action);
		} catch (error) {
			if (action === "read" || action === "unread") {
				setRead(previousRead);
				setThreadUnread(previousThreadUnread);
				if (unreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta: -unreadDelta });
			}
			throw error;
		}
	}

	const swipeable = compact && (config.folder === "inbox" || config.folder === "snoozed") && message.direction === "inbound";

	function onMessageNavigate(event: MouseEvent<HTMLAnchorElement>) {
		if (selectionMode) {
			event.preventDefault();
			onSelectedChange(message.id, !selected);
			return;
		}
		const plainClick = !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
		if (plainClick) onOpening?.();
		if (!read && plainClick && config.folder !== "all") {
			rememberOpenedUnreadMessage(message.id);
			const previousThreadUnread = threadUnread;
			setRead(true);
			if (previousThreadUnread !== undefined) setThreadUnread(Math.max(0, previousThreadUnread - 1));
			if (affectsInboxCount && message.direction === "inbound") dispatchMessageCountsDelta({ inboxUnreadDelta: -1 });
			void runBulkMessageAction([message.id], "read", false).catch(() => {
				setRead(false);
				setThreadUnread(previousThreadUnread);
				if (affectsInboxCount && message.direction === "inbound") dispatchMessageCountsDelta({ inboxUnreadDelta: 1 });
			});
		}
		navigation.onNavigate(event, !read);
	}
	function onRowLinkClick(event: MouseEvent<HTMLAnchorElement>) {
		if (selectionMode || config.folder !== "drafts") onMessageNavigate(event);
	}

	if (compact) {
		const compactRow = (
			<div
				role={swipeable ? undefined : "listitem"}
				{...longPressHandlers}
				className={clsx("mailos-message-row group grid gap-3 border-l-2 px-4 py-3 transition-colors", showCheckboxes ? "grid-cols-[20px_minmax(0,1fr)]" : "grid-cols-1", active || opening
					? "border-l-blue-600 bg-blue-50"
					: selected
						? "border-l-transparent bg-neutral-50"
						: "border-l-transparent hover:bg-neutral-50", draggable && "cursor-grab active:cursor-grabbing")}
				draggable={draggable}
				onDragStart={(event) => {
					if (!draggable) return;
					setMessageDragData(event.dataTransfer, { messageIds: dragMessageIds });
				}}
			>
			{showCheckboxes && <Checkbox
					checked={selected}
					onChange={(event) => onSelectedChange(message.id, event.target.checked)}
					className="mt-1 h-4 w-4 rounded border-neutral-300"
					aria-label={t("list.selectFrom", { sender: party })}
			/>}
				<Link
					href={href}
					onClick={onRowLinkClick}
					onPointerEnter={config.folder === "drafts" ? undefined : navigation.prefetch}
					onPointerLeave={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onFocus={config.folder === "drafts" ? undefined : navigation.prefetch}
					onBlur={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onTouchStart={config.folder === "drafts" ? undefined : navigation.prefetchNow}
					aria-current={active ? "true" : undefined}
					className="min-w-0"
				>
					<span className="flex items-baseline justify-between gap-3">
						<span className={clsx(unread && "font-semibold",getMessagePartyClassName(rowMessage, config.folder), "inline-flex min-w-0 items-center gap-2")}>
							{config.folder !== "drafts" && <PartyAvatar mailboxId={rowMessage.mailboxId} address={getMessagePartyAddress(rowMessage, config.folder)} name={party} className="h-6 w-6 text-[10px]" />}
							{unread && <span className="sr-only">{t("list.unread")} </span>}
							<span className="truncate">{party}</span>
{message.mailboxLabel && <span className="ml-1 shrink-0 rounded-full border border-neutral-200 px-1.5 text-[10px] font-medium leading-4 text-neutral-500" title={message.mailboxLabel}>{message.mailboxLabel}@</span>}

							{(message.threadCount ?? 1) > 1 && (
								<span className="ml-2 text-xs font-normal text-neutral-500">{message.threadCount}</span>
							)}
						</span>
						<span className={clsx(unread ?"font-medium":"text-neutral-500","shrink-0 text-[11px]")}>
							<OpenedIndicator count={message.openCount} />
							{message.scheduledAt ? formatScheduledSendTime(message.scheduledAt, t) : formatMessageListTimestamp(message.createdAt)}
						</span>
					</span>
					<span
						className={`mt-1 block truncate text-sm ${unread ? "font-semibold text-neutral-900" : "text-neutral-700"
							}`}
					>
						{message.subject ?? t("list.noSubject")}
					</span>
					<span className="mt-0.5 block truncate text-xs leading-5 text-neutral-500">
						{preview}
					</span>
				</Link>
			</div>
		);
		if (!swipeable) return compactRow;
		return (
			<SwipeableRow
				role="listitem"
				startAction={{
					label: read ? t("list.markUnread") : t("list.markRead"),
					icon: read ? Mail : MailOpen,
					className: "bg-blue-600",
					onTrigger: () => void runRowAction(read ? "unread" : "read").catch(() => undefined),
				}}
				endAction={{
					label: t("common.archive"),
					icon: Archive,
					className: "bg-emerald-600",
					onTrigger: () => void runRowAction("archive").catch(() => undefined),
				}}
			>
				{compactRow}
			</SwipeableRow>
		);
	}

	const className =
		`mailos-message-row group relative grid min-h-12 w-full ${showCheckboxes ? "grid-cols-[24px_32px_minmax(200px,220px)_1fr_auto]" : "grid-cols-[32px_minmax(200px,220px)_1fr_auto]"} items-center gap-3 px-6 text-left text-sm hover:z-10 hover:bg-[#f2f6fc] hover:shadow-sm has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-inset has-[a:focus-visible]:ring-blue-600 ${active || selected || opening ? "bg-blue-50" : ""
		} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`;
	const content = (
		<>
			{config.folder === "inbox" && message.direction === "inbound" && (
				<Tooltip label={starred ? t("list.starred") : t("list.notStarred")}>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="relative z-10"
						onClick={() => {
							void toggleMessageStar(message.id).then((result) => setStarred(result.starred));
						}}
						aria-label={t("message.star")}
						aria-pressed={starred}
					>
						<Icon className={`h-4 w-4 ${starred ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`} />
					</Button>
				</Tooltip>
			)}
			{(config.folder !== "inbox" || message.direction !== "inbound") && (
				<Icon className="h-4 w-4 text-neutral-300" />
			)}
			<span className={clsx(unread && "font-semibold", getMessagePartyClassName(rowMessage, config.folder), "inline-flex min-w-0 items-center gap-2.5")}>
				{config.folder !== "drafts" && <PartyAvatar mailboxId={rowMessage.mailboxId} address={getMessagePartyAddress(rowMessage, config.folder)} name={party} />}
				{unread && <span className="sr-only">{t("list.unread")} </span>}
				<span className="truncate">{party}</span>
{message.mailboxLabel && <span className="ml-1 shrink-0 rounded-full border border-neutral-200 px-1.5 text-[10px] font-medium leading-4 text-neutral-500" title={message.mailboxLabel}>{message.mailboxLabel}@</span>}

				{(message.threadCount ?? 1) > 1 && (
					<span className="ml-2 text-xs text-neutral-500">{message.threadCount}</span>
				)}
			</span>
			<span className="truncate text-neutral-700">
				<Link
					href={href}
					onClick={onRowLinkClick}
					onPointerEnter={config.folder === "drafts" ? undefined : navigation.prefetch}
					onPointerLeave={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onFocus={config.folder === "drafts" ? undefined : navigation.prefetch}
					onBlur={config.folder === "drafts" ? undefined : navigation.cancelPrefetch}
					onTouchStart={config.folder === "drafts" ? undefined : navigation.prefetchNow}
					aria-current={active ? "true" : undefined}
					className="focus-visible:outline-none after:absolute after:inset-0"
				>
					<span className={unread ? "font-semibold text-neutral-900" : ""}>
						{rowMessage.subject ?? t("list.noSubject")}
					</span>
					<span className="text-neutral-500"> - {getMessagePreview(rowMessage, config.folder, t)}</span>
				</Link>
			</span>
			<time
				dateTime={message.createdAt}
				className={`min-w-[96px] whitespace-nowrap text-right text-xs group-hover:opacity-0 ${unread ? "font-semibold text-neutral-800" : "text-neutral-500"
					}`}
			>
				<OpenedIndicator count={message.openCount} />
				{message.scheduledAt ? formatScheduledSendTime(message.scheduledAt, t) : formatMessageListTimestamp(message.createdAt)}
			</time>
		</>
	);

	if (config.folder === "drafts") {
		return (
			<div role="listitem" {...longPressHandlers} className={className}>
				{showCheckboxes && <Checkbox
					checked={selected}
					onChange={(event) => onSelectedChange(message.id, event.target.checked)}
					className="relative z-10 h-4 w-4 rounded border-neutral-300"
					aria-label={t("list.selectMessage")}
				/>}
				{content}
			</div>
		);
	}

	return (
		<div
			role="listitem"
			{...longPressHandlers}
			className={className}
			draggable={draggable}
			onDragStart={(event) => {
				if (!draggable) return;
				setMessageDragData(event.dataTransfer, { messageIds: dragMessageIds });
			}}
		>
			{showCheckboxes && <Checkbox
				checked={selected}
				onChange={(event) => onSelectedChange(message.id, event.target.checked)}
				className="relative z-10 h-4 w-4 rounded border-neutral-300"
				aria-label={t("list.selectFrom", { sender: party })}
			/>}
			{content}
			{(config.folder === "inbox" || config.folder === "snoozed") && message.direction === "inbound" && (
				<MessageListRowActions
					message={rowMessage}
					onAction={runRowAction}
				/>
			)}
		</div>
	);
}

export function MessageFolderPage({
	config,
	compact = false,
	selectedMessageId,
}: MessageFolderPageProps) {
	const { t } = useLanguage();
	const title = config.titleKey ? t(config.titleKey) : config.title;
	const { selectedMailbox, isLoading: mailboxesLoading } = useSelectedMailbox();
	const { query } = useMailSearch();
	const isMobile = useIsMobile();
	const listState = useMessageListState();
	const usesSharedListState = listState !== null;
	const [internalOffset, setInternalOffset] = useState(0);
	const [internalSelectedMessages, setInternalSelectedMessages] = useState<
		Array<{ id: string; read: boolean }>
	>([]);
	const [internalUnreadOnly, setInternalUnreadOnly] = useState(false);
	const [selectionMode, setSelectionMode] = useState(false);
	// Phones keep rows clean until press-and-hold (or the menu) starts selecting; with a mouse,
	// checkboxes are always there, as in Gmail and Outlook on the web.
	const phone = useIsMobile();
	const showSelection = selectionMode || !phone;
	const [pendingBulkAction, setPendingBulkAction] = useState(false);
	const [emptyingFolder, setEmptyingFolder] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [openingMessageId, setOpeningMessageId] = useState<string | null>(null);
	const openingTimer = useRef<number | null>(null);
	const [conversationView, setConversationView] = useConversationView();
	const [chatStyle, setChatStyle] = useChatConversationStyle();
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
	const visibleOpeningMessageId = openingMessageId === selectedMessageId ? null : openingMessageId;

	useEffect(() => () => {
		if (openingTimer.current) window.clearTimeout(openingTimer.current);
	}, []);

	function markMessageOpening(messageId: string) {
		setOpeningMessageId(messageId);
		if (openingTimer.current) window.clearTimeout(openingTimer.current);
		openingTimer.current = window.setTimeout(() => setOpeningMessageId(null), 3000);
	}
	const grouped = conversationView && config.folder !== "drafts";
	const offset = listState?.offset ?? internalOffset;
	const setOffset = listState?.setOffset ?? setInternalOffset;
	const selectedMessages = listState?.selectedMessages ?? internalSelectedMessages;
	const setSelectedMessages = listState?.setSelectedMessages ?? setInternalSelectedMessages;
	const unreadOnly = listState?.unreadOnly ?? internalUnreadOnly;
	const setUnreadOnly = listState?.setUnreadOnly ?? setInternalUnreadOnly;
	const { messages, isLoading, isLoadingMore, loadMore, total, limit, updateMessages } = useMessages(config.folder, selectedMailbox?.id, {
		query,
		limit: pageSize,
		offset,
		read: unreadOnly ? "unread" : "all",
		group: grouped ? "thread" : undefined,
	}, !mailboxesLoading, config.folderId);
	const { counts } = useMessageCounts(selectedMailbox?.id, !mailboxesLoading);
	useEffect(() => {
		const root = scrollContainerRef.current;
		const sentinel = loadMoreSentinelRef.current;
		// Without IntersectionObserver the page buttons still page through the list.
		if (!root || !sentinel || messages.length >= total || isLoading || isLoadingMore || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				void loadMore().catch(() => setActionError(t("list.loadingMoreFailed")));
			}
		}, { root, rootMargin: "180px 0px", threshold: 0 });
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [isLoading, isLoadingMore, loadMore, messages.length, t, total]);
	usePageLoading(mailboxesLoading || isLoading, true);
	const headerIcons = config.headerIcons ?? [];
	const hasActiveFilters = !!query.trim();
	const folderCount = config.folderId
		? counts.customFolders[config.folderId]
		: config.folder === "all" ? undefined : counts.folders[config.folder];
	const titleTotal = folderCount?.total ?? total;
	const titleUnread = folderCount?.unread ?? 0;
	const mailboxAddress = getMailboxAddress(selectedMailbox);
	const currentAccountName = selectedMailbox?.displayName ?? selectedMailbox?.localPart;
	const pageRange = getPageRange(offset, messages.length, total);
	const selectedIds = useMemo(
		() => selectedMessages.map((message) => message.id),
		[selectedMessages],
	);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);
	const allVisibleSelected = messages.length > 0 && messages.every((message) => selectedIds.includes(message.id));
	// In conversation view a row stands for every message of its thread in this
	// folder, so actions and drags carry all of them.
	const rowMessageIds = (message: Message) => message.threadMessageIds ?? [message.id];
	const expandSelectedIds = (ids: string[]) =>
		ids.flatMap((id) => rowMessageIds(messages.find((message) => message.id === id) ?? { id } as Message));
	// Back (phone button or gesture) leaves selection mode: ticks clear and checkboxes hide.
	useBackHandler(phone && (selectionMode || selectedMessages.length > 0), () => {
		setSelectedMessages([]);
		setSelectionMode(false);
	});

	// A split-layout list keeps this state in MessageSplitLayout, which resets
	// it when the list view changes. Standalone lists (drafts) own it here.
	useEffect(() => {
		if (usesSharedListState) return;
		setOffset(0);
		setSelectedMessages([]);
	}, [usesSharedListState, query, selectedMailbox?.id, config.folder, config.folderId, unreadOnly, grouped, setOffset, setSelectedMessages]);

	const previousOffset = useRef(offset);
	useEffect(() => {
		if (previousOffset.current === offset) return;
		previousOffset.current = offset;
		setSelectedMessages([]);
	}, [offset, setSelectedMessages]);

	useEffect(() => {
		const originalTitle = document.title;
		return () => {
			document.title = originalTitle;
		};
	}, []);

	useEffect(() => {
		if (mailboxesLoading) return;
		document.title = formatEmailPageTitle({
			location: title,
			inbox: config.folder === "inbox" && !config.folderId,
			total: titleTotal,
			unread: titleUnread,
			emailAddress: mailboxAddress,
		});
	}, [title, config.folder, config.folderId, mailboxAddress, mailboxesLoading, titleTotal, titleUnread]);

	useEffect(() => {
		if (isLoading) return;
		setSelectedMessages((current) => {
			const remaining = current.filter((item) => messages.some((message) => message.id === item.id));
			return remaining.length === current.length ? current : remaining;
		});
	}, [messages, isLoading, setSelectedMessages]);

	useEffect(() => {
		if (isLoading || offset === 0 || messages.length > 0) return;
		setOffset(total > 0 ? Math.floor((total - 1) / limit) * limit : 0);
	}, [isLoading, offset, messages.length, total, limit, setOffset]);

	function updateSelectedMessage(messageId: string, selected: boolean) {
		const message = messages.find((item) => item.id === messageId);
		if (!message) return;

		setSelectedMessages((current) => {
			if (!selected) return current.filter((item) => item.id !== messageId);
			if (current.some((item) => item.id === messageId)) return current;
			return [...current, { id: message.id, read: message.read && !(message.threadUnread ?? 0) }];
		});
	}

	function toggleAllVisible(selected: boolean) {
		const visibleIds = new Set(messages.map((message) => message.id));
		setSelectedMessages((current) => {
			if (!selected) {
				return current.filter((message) => !visibleIds.has(message.id));
			}

			const next = new Map(current.map((message) => [message.id, message]));
			for (const message of messages) {
				next.set(message.id, { id: message.id, read: message.read && !(message.threadUnread ?? 0) });
			}
			return Array.from(next.values());
		});
	}

	const permanentDeleteFolder = !config.folderId && supportsPermanentDelete(config.folder) ? config.folder : null;
	async function emptyFolder() {
		if (!permanentDeleteFolder || !selectedMailbox?.id) return;
		if (!window.confirm(getEmptyFolderConfirmText(permanentDeleteFolder, titleTotal, t))) return;
		setEmptyingFolder(true);
		try {
			await emptyMessageFolder(selectedMailbox.id, permanentDeleteFolder);
			setOffset(0);
		} catch (error) {
			console.error(error);
			window.alert(t("list.emptyFailed", { folder: getPermanentDeleteFolderLabel(permanentDeleteFolder, t) }));
		} finally {
			setEmptyingFolder(false);
		}
	}

	useEffect(() => {
		if (!actionError) return;
		const timer = setTimeout(() => setActionError(null), 6000);
		return () => clearTimeout(timer);
	}, [actionError]);

	async function runSelectedActionReportingErrors(action: BulkMessageAction, folderId?: string) {
		setActionError(null);
		try {
			await runSelectedAction(action, folderId);
		} catch (error) {
			setActionError(error instanceof PartialDeleteError ? t("actions.error.deleteSkipped") : t("actions.error.update"));
		}
	}

	async function runSelectedAction(action: BulkMessageAction, folderId?: string) {
		if (selectedIds.length === 0) return;
		if (action === "delete") {
			const ids = expandSelectedIds(selectedIds);
			if (!window.confirm(getPermanentDeleteConfirmText(ids.length, t))) return;
		}

		setPendingBulkAction(true);
		const previousMessages = messages;
		const readValue = action === "read" ? true : action === "unread" ? false : null;
		const inboxUnreadDelta = readValue === null || config.folder !== "inbox" || config.folderId
			? 0
			: messages
				.filter((message) => selectedIds.includes(message.id))
				.reduce((total, message) => total + getUnreadFlipCount(message, readValue), 0) * (readValue ? -1 : 1);
		if (readValue !== null) {
			updateMessages((current) => current.map((message) =>
				selectedIds.includes(message.id)
					? { ...message, read: readValue, ...(message.threadMessageIds ? { threadUnread: readValue ? 0 : message.threadMessageIds.length } : {}) }
					: message,
			));
			setSelectedMessages((current) => current.map((message) => ({ ...message, read: readValue })));
			if (inboxUnreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta });
		}
		try {
			await runBulkMessageAction(expandSelectedIds(selectedIds), action, true, folderId);
			setSelectedMessages([]);
			setSelectionMode(false);
		} catch (error) {
			if (readValue !== null) {
				updateMessages(previousMessages);
				if (inboxUnreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta: -inboxUnreadDelta });
			}
			throw error;
		} finally {
			setPendingBulkAction(false);
		}
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className={`flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 ${compact ? "px-4" : "px-4.5 md:px-6"}`}>
				{selectedMessageId ? <h2 className="sr-only">{title}</h2> : <h1 className="sr-only">{title}</h1>}
				<div className="flex items-center gap-3 w-full">
					{showSelection && <Tooltip label={t("list.selectAll")}>
						<Checkbox
							checked={allVisibleSelected}
							disabled={messages.length === 0}
							onChange={(event) => toggleAllVisible(event.target.checked)}
							className="h-4 w-4 rounded border-neutral-300"
							aria-label={t("list.selectAll")}
						/>
					</Tooltip>}
					{selectedIds.length > 0 ? (
						<BulkMessageToolbar
							selectedCount={selectedIds.length}
							hasUnreadSelection={hasUnreadSelection}
							onAction={runSelectedActionReportingErrors}
							onClearSelection={() => setSelectedMessages([])}
							pending={pendingBulkAction}
							folder={config.folderId ? undefined : config.folder}
						/>
					) : (
						(compact || isMobile) && (
							<p aria-hidden="true" className="truncate font-semibold text-neutral-900 pl-1">{title}</p>
						)
					)}
				</div>
				{(selectedIds.length === 0 || compact || selectionMode) && (
					<div className="flex items-center gap-2 text-neutral-500">
						<span className="text-xs text-neutral-500 whitespace-nowrap">
							{t("list.range", { start: pageRange.start, end: pageRange.end, total: pageRange.total })}
						</span>
						{!compact && !isMobile && <Tooltip label={t("list.previousPage")}>
							<Button
								variant="ghost"
								size="sm"
								disabled={offset === 0 || isLoading}
								onClick={() => setOffset(Math.max(offset - limit, 0))}
								aria-label={t("list.previousPage")}
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
						</Tooltip>}
						{!compact && !isMobile && <Tooltip label={t("list.nextPage")}>
							<Button
								variant="ghost"
								size="sm"
								disabled={offset + messages.length >= total || isLoading}
								onClick={() => setOffset(offset + limit)}
								aria-label={t("list.nextPage")}
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</Tooltip>}
						{config.folder === "inbox" && (
							<Tooltip label={unreadOnly ? t("list.showingUnread") : t("list.showUnreadOnly")}>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={t("list.showUnreadOnly")}
									aria-pressed={unreadOnly}
									onClick={() => setUnreadOnly((current) => !current)}
									className={unreadOnly ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : undefined}
								>
									<ListFilter className="h-4 w-4" />
								</Button>
							</Tooltip>
						)}
						<Tooltip label={t("list.refresh")}>
							<Button type="button" variant="ghost" size="sm" disabled={isLoading} aria-label={t("list.refresh")} aria-busy={isLoading} onClick={() => window.dispatchEvent(new CustomEvent("mailos:messages-changed", { detail: { kind: "refresh" } }))}>
								<RefreshCw className={clsx("h-4 w-4", isLoading && "animate-spin")} />
							</Button>
						</Tooltip>
						{permanentDeleteFolder && (
							<Tooltip label={getEmptyFolderLabel(permanentDeleteFolder, t)}>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label={getEmptyFolderLabel(permanentDeleteFolder, t)}
									disabled={emptyingFolder || isLoading || total === 0}
									onClick={() => void emptyFolder()}
									className="gap-1.5 text-xs font-medium text-red-600 hover:text-red-700"
								>
									<Trash2 className="h-4 w-4" />
									{!compact && <span className="max-md:hidden">{emptyingFolder ? t("list.emptying") : getEmptyFolderLabel(permanentDeleteFolder, t)}</span>}
								</Button>
							</Tooltip>
						)}
						{!compact && headerIcons.map((Icon, index) => (
							<Icon key={index} className="h-4 w-4" />
						))}
						<DropdownMenu.Root>
							<DropdownMenu.Trigger asChild>
								<Button type="button" variant="ghost" size="sm" className="h-10 w-10 shrink-0 p-0" aria-label={t("common.moreActions")}>
									<MoreVertical className="h-5 w-5" />
								</Button>
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content align="end" sideOffset={4} className="z-[130] min-w-56 rounded-xl border border-neutral-200 bg-white p-1.5 text-sm shadow-xl">
									<DropdownMenu.Item className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-neutral-700 outline-none data-[highlighted]:bg-neutral-100" onSelect={() => setSelectionMode((current) => !current)}>
										{selectionMode ? t("list.doneSelecting") : t("list.selectMessages")}
									</DropdownMenu.Item>
									{config.folder !== "drafts" && <>
										<DropdownMenu.Separator className="my-1 h-px bg-neutral-100" />
										{/* Clear choices: the active option carries the tick, the wording never flips. */}
										<DropdownMenu.Label className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("list.viewHeading")}</DropdownMenu.Label>
										<DropdownMenu.RadioGroup value={conversationView ? "threads" : "all"} onValueChange={(value) => setConversationView(value === "threads")}>
											{([["threads", t("list.viewConversations")], ["all", t("list.viewAllMessages")]] as const).map(([value, label]) => (
												<DropdownMenu.RadioItem key={value} value={value} onSelect={(event) => event.preventDefault()} className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[state=checked]:font-medium data-[state=checked]:text-blue-700">
													<span>{label}</span>
													<DropdownMenu.ItemIndicator><Check className="h-4 w-4" /></DropdownMenu.ItemIndicator>
												</DropdownMenu.RadioItem>
											))}
										</DropdownMenu.RadioGroup>
										<DropdownMenu.Label className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{t("list.layoutHeading")}</DropdownMenu.Label>
										<DropdownMenu.RadioGroup value={chatStyle ? "chat" : "email"} onValueChange={(value) => setChatStyle(value === "chat")}>
											{([["email", t("list.emailLayout")], ["chat", t("list.chatLayout")]] as const).map(([value, label]) => (
												<DropdownMenu.RadioItem key={value} value={value} onSelect={(event) => event.preventDefault()} className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-neutral-700 outline-none data-[highlighted]:bg-neutral-100 data-[state=checked]:font-medium data-[state=checked]:text-blue-700">
													<span>{label}</span>
													<DropdownMenu.ItemIndicator><Check className="h-4 w-4" /></DropdownMenu.ItemIndicator>
												</DropdownMenu.RadioItem>
											))}
										</DropdownMenu.RadioGroup>
									</>}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
					</div>
				)}
			</div>

			{actionError && (
				<p role="alert" className="shrink-0 border-b border-red-100 bg-red-50 px-6 py-2 text-sm font-medium text-red-700">
					{actionError}
				</p>
			)}

			<div ref={scrollContainerRef} aria-busy={isLoading || isLoadingMore} className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-gutter-stable">
				{config.folder === "inbox" && !config.folderId && offset === 0 && !mailboxesLoading && <DueFollowUps mailboxId={selectedMailbox?.id} />}
				<div role="list" aria-label={title} className="divide-y divide-neutral-100">
					{messages.map((message) => (
						<MessageListRow
							key={message.id}
							message={message}
							config={config}
							selected={selectedIds.includes(message.id)}
							active={message.id === selectedMessageId}
							opening={message.id === visibleOpeningMessageId}
							selectionMode={selectionMode}
							showCheckboxes={showSelection}
							onLongPressSelect={(messageId) => {
								setSelectionMode(true);
								updateSelectedMessage(messageId, true);
							}}
							onOpening={() => markMessageOpening(message.id)}
							compact={compact || isMobile}
							currentAccountName={currentAccountName}
							onSelectedChange={updateSelectedMessage}
							onMessageAction={(messageId, action) => {
								setActionError(null);
								return runBulkMessageAction(expandSelectedIds([messageId]), action, action !== "read" && action !== "unread").catch((error) => {
									setActionError(error instanceof PartialDeleteError ? t("actions.error.deleteSkipped") : t("actions.error.update"));
									throw error;
								});
							}}
							dragMessageIds={expandSelectedIds(selectedIds.includes(message.id) ? selectedIds : [message.id])}
						/>
					))}
				</div>
				{messages.length < total && <div ref={loadMoreSentinelRef} aria-hidden="true" className="h-2" />}
				{isLoadingMore && <div role="status" className="flex items-center justify-center gap-2 px-4 py-5 text-sm text-neutral-500"><RefreshCw className="h-4 w-4 animate-spin" />{t("list.loadingMore")}</div>}
				{isLoading && messages.length === 0 && (
					<div role="status" aria-label={t("list.loading")} className="mailos-skeleton-list">
						{Array.from({ length: 8 }, (_, index) => (
							<div key={index} className="mailos-skeleton-row" style={{ animationDelay: `${index * 45}ms` }}>
								<span className="mailos-skeleton mailos-skeleton--avatar" />
								<span className="flex min-w-0 flex-1 flex-col gap-2">
									<span className="mailos-skeleton h-3 w-2/5" />
									<span className="mailos-skeleton h-3 w-4/5" />
									<span className="mailos-skeleton h-2.5 w-3/5 opacity-70" />
								</span>
							</div>
						))}
					</div>
				)}
				{!isLoading && messages.length === 0 && (
					<div className="mailos-empty-state flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
						<span className="mailos-empty-icon flex h-16 w-16 items-center justify-center rounded-3xl bg-blue-50 text-blue-700">
							{hasActiveFilters ? <Search className="h-7 w-7" /> : <MailOpen className="h-7 w-7" />}
						</span>
						<p className="text-base font-medium text-neutral-800">
							{hasActiveFilters ? t("list.noMatch") : config.emptyTextKey ? t(config.emptyTextKey) : config.emptyText}
						</p>
						{!hasActiveFilters && (config.folder === "inbox" || config.folder === "all") && !config.folderId && <p className="max-w-xs text-sm text-neutral-500">{t("list.emptyHint")}</p>}
					</div>
				)}
			</div>
		</div>
	);
}
