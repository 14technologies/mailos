"use client";

import { useDeferredValue, useState } from "react";
import createDOMPurify from "dompurify";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth/client";
import { RichTextEditor } from "./rich-text-editor";
import { textToHtml } from "./rich-text-utils";
import type { NewTemplateDialogProps } from "./template-types";

type EditorMode = "visual" | "html";

function plainTextFromHtml(html: string): string {
	const document = new DOMParser().parseFromString(html, "text/html");
	return (document.body.innerText || document.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function livePreview(html: string): string {
	const source = html.trim() || "<p style=\"color:#94a3b8\">Your email preview appears here.</p>";
	const wrapped = /<html[\s>]/i.test(source) ? source : `<!doctype html><html><body style="font:15px/1.6 Arial,sans-serif;color:#1f2937;padding:24px">${source}</body></html>`;
	return createDOMPurify(window).sanitize(wrapped, { WHOLE_DOCUMENT: true });
}

export function NewTemplateDialog({ open, onOpenChange, mailboxId, from }: NewTemplateDialogProps) {
	const { t } = useLanguage();
	const [title, setTitle] = useState("");
	const [html, setHtml] = useState("");
	const [mode, setMode] = useState<EditorMode>("visual");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const deferredHtml = useDeferredValue(html);

	async function save() {
		setSaving(true);
		setError("");
		try {
			const response = await authFetch("/api/templates", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mailboxId, from, title, text: plainTextFromHtml(html), html }),
			});
			if (!response.ok) {
				setError(((await response.json().catch(() => null)) as { error?: string } | null)?.error ?? t("template.saveFailed"));
				return;
			}
			onOpenChange(false);
			setTitle("");
			setHtml("");
			setMode("visual");
		} catch {
			setError(t("template.saveFailed"));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-h-[calc(100vh-4rem)] overflow-y-auto">
					<DialogHeader><DialogTitle>{t("template.new")}</DialogTitle></DialogHeader>
					<form
						className="space-y-4"
						onSubmit={(event) => { event.preventDefault(); void save(); }}
					>
						<div className="space-y-1.5">
							<Label htmlFor="template-title">{t("template.title")}</Label>
							<Input id="template-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required />
						</div>
						<div className="space-y-1.5">
							<div className="flex items-center justify-between gap-3">
								<Label htmlFor={mode === "html" ? "template-html" : "template-content"}>{t("template.content")}</Label>
								<div className="inline-flex rounded-lg border border-neutral-200 p-1" role="group" aria-label="Template editor mode">
									<button type="button" aria-pressed={mode === "visual"} onClick={() => { if (mode === "html" && !html.trim()) setHtml("<p></p>"); setMode("visual"); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === "visual" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Write</button>
									<button type="button" aria-pressed={mode === "html"} onClick={() => { if (!html.trim()) setHtml(textToHtml("") || "<p></p>"); setMode("html"); }} className={`rounded-md px-3 py-1.5 text-xs font-medium ${mode === "html" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>HTML</button>
								</div>
							</div>
							{mode === "visual" ? (
								<div className="flex h-80 min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200">
									<RichTextEditor id="template-content" value={html || "<p></p>"} onChange={setHtml} placeholder={t("template.content")} />
								</div>
							) : (
							<div className="grid gap-3 lg:grid-cols-2">
									<Textarea id="template-html" aria-label="Email HTML source" value={html} onChange={(event) => setHtml(event.target.value)} spellCheck={false} rows={14} className="min-h-72 resize-y font-mono text-xs leading-5" placeholder={'<table role="presentation">…</table>'} />
									<div className="min-h-72 overflow-hidden rounded-xl border border-neutral-200 bg-white">
										<iframe title="Email template preview" sandbox="" referrerPolicy="no-referrer" srcDoc={typeof window === "undefined" ? "" : livePreview(deferredHtml)} className="h-72 w-full bg-white" />
									</div>
								</div>
							)}
						</div>
						{error && <p role="alert" className="text-sm text-red-600">{error}</p>}
						<Button type="submit" disabled={saving || !title.trim() || !html.trim()}>
							{saving ? t("template.saving") : t("template.save")}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
	);
}
