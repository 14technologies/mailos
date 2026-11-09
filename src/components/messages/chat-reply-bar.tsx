"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Send, X } from "@/components/icons";
import { useLanguage } from "@/components/language-provider";
import { authFetch } from "@/lib/auth/client";
import { getEmailAddress } from "@/lib/email/address";
import { dispatchMessagesChanged } from "@/lib/messages/change-events";
import { buildReplySubject, getReplyRecipients, getReplyThreading } from "@/components/message-actions/utils";
import type { ReplyableMessage } from "@/components/message-actions/types";
import { escapeHtml } from "@/components/compose/rich-text-utils";

type Pending = { id: number; text: string; files: File[]; state: "sending" | "sent" | "failed" };

/** The send endpoint accepts 30 MB per request; leave room for the message itself. */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

function formatSize(bytes: number) {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * WhatsApp-style reply bar for the chat layout: attach files, type at the bottom, tap send. It
 * sends a normal email reply (to the right person, "Re:" subject, threaded, files as real
 * attachments), so the other side sees a regular email. The message shows immediately as a
 * pending bubble and gives way to the real one once the conversation refreshes.
 */
export function ChatReplyBar({ message, mailboxId, ownAddress, ownAddresses }: {
	message: ReplyableMessage & { id: string; subject: string | null };
	mailboxId: string;
	ownAddress: string;
	ownAddresses: string[];
}) {
	const { t } = useLanguage();
	const [text, setText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [notice, setNotice] = useState<string | null>(null);
	const [pending, setPending] = useState<Pending[]>([]);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const barRef = useRef<HTMLDivElement>(null);
	const nextId = useRef(1);

	// Opening a chat lands on the newest message, like a messaging app (without opening the keyboard).
	useEffect(() => {
		const timer = window.setTimeout(() => barRef.current?.scrollIntoView({ block: "end" }), 350);
		return () => window.clearTimeout(timer);
	}, [message.id]);

	// Grow with the text up to about five lines.
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.style.height = "auto";
		input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
	}, [text]);

	function addFiles(list: FileList | null) {
		if (!list?.length) return;
		const next = [...files, ...Array.from(list)].slice(0, 10);
		const total = next.reduce((sum, file) => sum + file.size, 0);
		if (total > MAX_TOTAL_BYTES) {
			setNotice(t("chat.tooLarge"));
			return;
		}
		setNotice(null);
		setFiles(next);
	}

	async function deliver(entry: Pending) {
		const recipients = getReplyRecipients(message, ownAddresses, "reply");
		const threading = getReplyThreading(message);
		const body = new FormData();
		body.set("mailboxId", mailboxId);
		body.set("from", getEmailAddress(ownAddress));
		body.set("to", recipients.to.join(", "));
		body.set("subject", buildReplySubject(message.subject));
		body.set("text", entry.text);
		body.set("html", `<div>${escapeHtml(entry.text).replace(/\n/g, "<br>")}</div>`);
		if (threading.inReplyTo) body.set("inReplyTo", threading.inReplyTo);
		if (threading.references) body.set("references", threading.references);
		if (threading.threadId) body.set("threadId", threading.threadId);
		for (const file of entry.files) body.append("attachments", file, file.name);
		try {
			const response = await authFetch("/api/send", { method: "POST", body });
			if (!response.ok) throw new Error("send failed");
			setPending((current) => current.map((item) => (item.id === entry.id ? { ...item, state: "sent" } : item)));
			dispatchMessagesChanged();
			// The refreshed conversation now holds the real message; drop the placeholder.
			window.setTimeout(() => setPending((current) => current.filter((item) => item.id !== entry.id)), 1800);
		} catch {
			setPending((current) => current.map((item) => (item.id === entry.id ? { ...item, state: "failed" } : item)));
		}
	}

	function send() {
		const value = text.trim();
		if (!value && files.length === 0) return;
		const entry: Pending = { id: nextId.current++, text: value, files, state: "sending" };
		setPending((current) => [...current, entry]);
		setText("");
		setFiles([]);
		setNotice(null);
		void deliver(entry);
	}

	function retry(entry: Pending) {
		const again = { ...entry, state: "sending" as const };
		setPending((current) => current.map((item) => (item.id === entry.id ? again : item)));
		void deliver(again);
	}

	const canSend = text.trim().length > 0 || files.length > 0;
	return (
		<>
			{pending.map((entry) => (
				<article key={entry.id} className="mailos-chat-backdrop flex justify-end px-3">
					<button
						type="button"
						disabled={entry.state !== "failed"}
						onClick={() => retry(entry)}
						className="mailos-chat-pending mailos-chat-out max-w-[88%] rounded-2xl rounded-br-md px-3 py-2 text-left sm:max-w-[75%]"
					>
						{entry.files.map((file) => (
							<span key={file.name + file.size} className="mb-1 flex items-center gap-1.5 text-[13px] text-neutral-700">
								<Paperclip className="h-3.5 w-3.5 shrink-0" />
								<span className="truncate">{file.name}</span>
							</span>
						))}
						{entry.text && <span className="block whitespace-pre-wrap text-sm text-neutral-900">{entry.text}</span>}
						<span className="mt-1 block text-right text-[11px] text-neutral-500">
							{entry.state === "sending" ? t("chat.sending") : entry.state === "sent" ? t("chat.sent") : t("chat.failed")}
						</span>
					</button>
				</article>
			))}
			<div ref={barRef} className="mailos-chat-bar sticky bottom-0 z-30 px-2 pb-2 pt-1.5">
				{(files.length > 0 || notice) && (
					<div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
						{files.map((file, index) => (
							<span key={file.name + file.size + index} className="mailos-chat-chip flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 text-xs text-neutral-700">
								<Paperclip className="h-3.5 w-3.5 shrink-0" />
								<span className="max-w-40 truncate">{file.name}</span>
								<span className="text-neutral-500">{formatSize(file.size)}</span>
								<button type="button" aria-label={t("chat.removeFile", { name: file.name })} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-neutral-200">
									<X className="h-3.5 w-3.5" />
								</button>
							</span>
						))}
						{notice && <span role="alert" className="text-xs text-red-600">{notice}</span>}
					</div>
				)}
				<div className="flex items-end gap-2">
					<div className="mailos-chat-input flex min-h-11 flex-1 items-end rounded-3xl">
						<button type="button" aria-label={t("chat.attach")} onClick={() => fileRef.current?.click()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 hover:text-neutral-800">
							<Paperclip className="h-5 w-5" />
						</button>
						<textarea
							ref={inputRef}
							rows={1}
							value={text}
							onChange={(event) => setText(event.target.value)}
							onKeyDown={(event) => {
								// Enter sends on a keyboard; on phones Enter adds a line and the button sends.
								if (event.key === "Enter" && !event.shiftKey && window.matchMedia("(pointer: fine)").matches) {
									event.preventDefault();
									send();
								}
							}}
							placeholder={t("chat.placeholder")}
							aria-label={t("chat.placeholder")}
							className="min-h-11 flex-1 resize-none border-0 bg-transparent py-2.5 pr-4 text-[15px] leading-6 text-neutral-900 outline-none placeholder:text-neutral-500"
						/>
					</div>
					<button
						type="button"
						onClick={send}
						disabled={!canSend}
						aria-label={t("chat.send")}
						className="mailos-chat-send flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40"
					>
						<Send className="h-5 w-5" />
					</button>
				</div>
				<input ref={fileRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
			</div>
		</>
	);
}
