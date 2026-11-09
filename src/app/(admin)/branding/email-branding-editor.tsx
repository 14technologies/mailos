"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import createDOMPurify from "dompurify";
import { Check, Eye, FileCode, ImagePlus, Mail, RotateCcw } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { authFetch } from "@/lib/auth/client";
import { DEFAULT_EMAIL_SAMPLE_HTML, DEFAULT_EMAIL_TEMPLATE_HTML } from "@/lib/branding/email-template";
import type { EmailBrandingResponse } from "@/lib/branding/email";

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

function escapeAttribute(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function dataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unable to preview the logo"));
		reader.onerror = () => reject(new Error("Unable to preview the logo"));
		reader.readAsDataURL(file);
	});
}

function previewDocument(template: string, logoUrl: string): string {
	let html = template
		.replaceAll("{{logo}}", `<img src="${escapeAttribute(logoUrl)}" alt="14 Technologies" style="display:block;width:100%;max-width:260px;height:auto;margin:auto">`)
		.replaceAll("{{content}}", DEFAULT_EMAIL_SAMPLE_HTML)
		.replaceAll("{{appName}}", "MailOS")
		.replaceAll("{{year}}", String(new Date().getUTCFullYear()));
	if (!/<html[\s>]/i.test(html)) html = `<!doctype html><html><body>${html}</body></html>`;
	return createDOMPurify(window).sanitize(html, { WHOLE_DOCUMENT: true });
}

export function EmailBrandingEditor() {
	const fileInput = useRef<HTMLInputElement>(null);
	const [settings, setSettings] = useState<EmailBrandingResponse | null>(null);
	const [templateHtml, setTemplateHtml] = useState("");
	const [logo, setLogo] = useState<File | null>(null);
	const [logoPreview, setLogoPreview] = useState<string | null>(null);
	const [useDefaultLogo, setUseDefaultLogo] = useState(false);
	const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const deferredHtml = useDeferredValue(templateHtml);

	useEffect(() => {
		let active = true;
		void authFetch("/api/branding/email", { cache: "no-store" })
			.then(async (response) => {
				const body = await response.json() as EmailBrandingResponse & { error?: string };
				if (!response.ok) throw new Error(body.error ?? "Unable to load email branding");
				if (!active) return;
				setSettings(body);
				setTemplateHtml(body.templateHtml || DEFAULT_EMAIL_TEMPLATE_HTML);
			})
			.catch((reason: unknown) => {
				if (active) setError(reason instanceof Error ? reason.message : "Unable to load email branding");
			})
			.finally(() => { if (active) setLoading(false); });
		return () => { active = false; };
	}, []);

	const fallbackLogoUrl = settings?.logoUrl ?? "/api/branding/email-logo";
	const activeLogoUrl = logoPreview ?? (useDefaultLogo ? `/branding/14-technologies-horizontal-${settings?.defaultLogoVariant ?? "black"}.png` : fallbackLogoUrl);
	const previewHtml = typeof window === "undefined" ? "" : previewDocument(deferredHtml || DEFAULT_EMAIL_TEMPLATE_HTML, activeLogoUrl);

	async function chooseLogo(file: File | null) {
		setError(null);
		setStatus(null);
		if (!file) return;
		if (file.size > 2 * 1024 * 1024) {
			setError("Logo must be 2 MB or smaller.");
			if (fileInput.current) fileInput.current.value = "";
			return;
		}
		try {
			setLogo(file);
			setLogoPreview(await dataUrl(file));
			setUseDefaultLogo(false);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Unable to preview the logo");
		}
	}

	async function save(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!settings) return;
		setSaving(true);
		setError(null);
		setStatus(null);
		const form = new FormData();
		form.set("templateHtml", templateHtml);
		form.set("applyToSystem", String(settings.applyToSystem));
		form.set("applyToOutbound", String(settings.applyToOutbound));
		form.set("useDefaultLogo", String(useDefaultLogo));
		form.set("defaultLogoVariant", settings.defaultLogoVariant);
		if (logo) form.set("logo", logo, logo.name);
		try {
			const response = await authFetch("/api/branding/email", { method: "PUT", body: form });
			const body = await response.json() as EmailBrandingResponse & { error?: string };
			if (!response.ok) throw new Error(body.error ?? "Unable to save email branding");
			setSettings(body);
			setLogo(null);
			setLogoPreview(null);
			setUseDefaultLogo(false);
			if (fileInput.current) fileInput.current.value = "";
			setStatus("Email branding saved.");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Unable to save email branding");
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return <Card className="rounded-3xl border-0 bg-white p-6"><p className="text-sm text-neutral-500">Loading email branding…</p></Card>;
	}
	if (!settings) return <Card className="rounded-3xl border-0 bg-white p-6"><p role="alert" className="text-sm text-red-700">{error ?? "Unable to load email branding."}</p></Card>;

	return (
		<Card className="rounded-3xl border-0 bg-white p-6">
			<CardHeader className="py-0">
				<CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Email branding</CardTitle>
				<CardDescription>Add your logo and edit the shared HTML layout. The preview updates as you type.</CardDescription>
			</CardHeader>
			<CardContent className="pt-6">
				<form onSubmit={(event) => { void save(event); }} className="space-y-6">
					<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
						<div className="space-y-5">
							<div className="space-y-2">
								<Label htmlFor="email-brand-logo">Header logo</Label>
								<div className="flex flex-wrap items-center gap-4 rounded-2xl border border-dashed border-neutral-300 p-4">
									<img src={activeLogoUrl} alt="Email header logo preview" className="max-h-14 max-w-64 object-contain" />
									<div className="flex flex-wrap gap-2">
										<input ref={fileInput} id="email-brand-logo" type="file" accept={LOGO_ACCEPT} className="sr-only" onChange={(event) => { void chooseLogo(event.target.files?.[0] ?? null); }} />
										<Button type="button" variant="outline" onClick={() => fileInput.current?.click()}><ImagePlus className="mr-2 h-4 w-4" />Choose logo</Button>
										<Button type="button" variant="ghost" onClick={() => { setLogo(null); setLogoPreview(null); setUseDefaultLogo(true); }}><RotateCcw className="mr-2 h-4 w-4" />Use supplied logo</Button>
									</div>
								</div>
								<div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600" role="group" aria-label="Default logo color">
									<span className="mr-1">Default variant</span>
									{(["black", "white"] as const).map((variant) => (
										<button key={variant} type="button" aria-pressed={settings.defaultLogoVariant === variant} onClick={() => { setSettings({ ...settings, defaultLogoVariant: variant }); setUseDefaultLogo(true); setLogo(null); setLogoPreview(null); }} className={`rounded-full border px-3 py-1.5 capitalize ${settings.defaultLogoVariant === variant ? "border-teal-700 bg-teal-50 text-teal-900" : "border-neutral-200 hover:bg-neutral-50"}`}>{variant}</button>
									))}
								</div>
								<p className="text-xs text-neutral-500">PNG, JPEG, WebP, or GIF · up to 2 MB. The logo is embedded in sent mail, so recipients do not need to load remote images.</p>
							</div>
							<div className="space-y-2">
								<div className="flex items-center justify-between gap-3">
									<Label htmlFor="email-template-html">HTML template</Label>
									<Button type="button" variant="ghost" size="sm" onClick={() => { setTemplateHtml(DEFAULT_EMAIL_TEMPLATE_HTML); setStatus(null); }}><RotateCcw className="mr-2 h-4 w-4" />Restore starter</Button>
								</div>
								<Textarea id="email-template-html" aria-describedby="email-template-help" value={templateHtml} onChange={(event) => { setTemplateHtml(event.target.value); setStatus(null); }} spellCheck={false} rows={22} className="min-h-[440px] resize-y font-mono text-xs leading-5" />
								<p id="email-template-help" className="text-xs leading-5 text-neutral-500">Keep <code>{"{{logo}}"}</code> and <code>{"{{content}}"}</code>. You can also use <code>{"{{appName}}"}</code> and <code>{"{{year}}"}</code>. Scripts and forms are removed before email is sent.</p>
							</div>
							<fieldset className="space-y-3 rounded-2xl border border-neutral-200 p-4">
								<legend className="px-1 text-sm font-medium text-neutral-800">Apply the layout to</legend>
								<label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-700">
									<input type="checkbox" checked={settings.applyToSystem} onChange={(event) => setSettings({ ...settings, applyToSystem: event.target.checked })} className="mt-0.5 h-4 w-4 accent-teal-700" />
									<span><span className="font-medium">System emails</span><span className="mt-1 block text-xs text-neutral-500">Password-reset and other MailOS-generated email.</span></span>
								</label>
								<label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-700">
									<input type="checkbox" checked={settings.applyToOutbound} onChange={(event) => setSettings({ ...settings, applyToOutbound: event.target.checked })} className="mt-0.5 h-4 w-4 accent-teal-700" />
									<span><span className="font-medium">Outbound messages</span><span className="mt-1 block text-xs text-neutral-500">Wrap mail sent from the composer with this layout.</span></span>
								</label>
							</fieldset>
						</div>
						<div className="min-w-0 space-y-3">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div><h3 className="text-sm font-medium text-neutral-900">Live preview</h3><p className="text-xs text-neutral-500">Preview uses a sample receipt-style message.</p></div>
								<div className="inline-flex rounded-lg border border-neutral-200 p-1" role="group" aria-label="Preview size">
									<button type="button" aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${previewMode === "desktop" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Desktop</button>
									<button type="button" aria-pressed={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")} className={`rounded-md px-3 py-1.5 text-xs font-medium ${previewMode === "mobile" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>Mobile</button>
								</div>
							</div>
							<div className="overflow-auto rounded-2xl border border-neutral-200 bg-[#f3f6f5] p-2 sm:p-4">
								<div className={previewMode === "mobile" ? "mx-auto w-[360px] max-w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm" : "w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"}>
									<iframe title="Branded email preview" sandbox="" referrerPolicy="no-referrer" srcDoc={previewHtml} className="block h-[620px] w-full bg-white" />
								</div>
							</div>
						</div>
					</div>
					{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
					{status && <p role="status" className="flex items-center gap-2 text-sm text-emerald-700"><Check className="h-4 w-4" />{status}</p>}
					<div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-5">
						<Button type="submit" disabled={saving || !templateHtml.trim()}>{saving ? "Saving…" : "Save email branding"}</Button>
						<span className="flex items-center gap-2 text-xs text-neutral-500"><Eye className="h-4 w-4" /><FileCode className="h-4 w-4" />Changes preview live and apply after saving.</span>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}
