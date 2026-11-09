import { eq } from "drizzle-orm";
import { parseFragment, serialize, type DefaultTreeAdapterTypes } from "parse5";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import type { AttachmentContent } from "@/lib/email/attachment-types";
import { getLicenseEntitlements } from "@/lib/licenses/service";
import { APP_SETTINGS_ID } from "./service";
import { DEFAULT_EMAIL_TEMPLATE_HTML } from "./email-template";

export const EMAIL_BRANDING_LOGO_KEY = "branding/email-logo";

export type EmailBrandingConfig = {
	logoKey: string | null;
	defaultLogoVariant: "black" | "white";
	templateHtml: string;
	applyToSystem: boolean;
	applyToOutbound: boolean;
};

export type EmailBrandingResponse = EmailBrandingConfig & {
	canCustomizeBranding: boolean;
	logoUrl: string;
	logoVersion: string;
};

type StoredEmailBranding = Partial<EmailBrandingConfig>;
const BLOCKED_EMAIL_TAGS = new Set(["base", "button", "embed", "form", "iframe", "input", "link", "meta", "object", "script", "select", "textarea"]);
const URL_ATTRIBUTES = new Set(["action", "formaction", "href", "src", "xlink:href"]);

function sanitizeEmailTemplateHtml(source: string): string {
	const fragment = parseFragment(source);
	const keep = (node: DefaultTreeAdapterTypes.Node): boolean => {
		if ("tagName" in node) {
			const tagName = node.tagName.toLowerCase();
			if (BLOCKED_EMAIL_TAGS.has(tagName)) return false;
			if ("attrs" in node) {
				node.attrs = node.attrs.filter((attribute) => {
					const name = attribute.name.toLowerCase();
					const value = attribute.value.trim();
					if (name.startsWith("on") || name === "srcdoc" || name === "formaction") return false;
					if (name === "style" && /(?:expression\s*\(|javascript\s*:|@import|behavior\s*:|url\s*\(\s*["']?\s*(?:javascript:|data:text\/html))/i.test(value)) return false;
					if (URL_ATTRIBUTES.has(name)) {
						if (/^\s*\{\{(?:logo|content|appName|year)\}\}\s*$/i.test(value)) return true;
						return /^(?:https?:|mailto:|tel:|cid:|#)/i.test(value);
					}
					return true;
				});
			}
		}
		if ("childNodes" in node) node.childNodes = node.childNodes.filter(keep);
		return true;
	};
	fragment.childNodes = fragment.childNodes.filter(keep);
	return serialize(fragment);
}

const DEFAULT_CONFIG: EmailBrandingConfig = {
	logoKey: null,
	defaultLogoVariant: "black",
	templateHtml: DEFAULT_EMAIL_TEMPLATE_HTML,
	applyToSystem: true,
	applyToOutbound: false,
};

function parseConfig(value: string | null | undefined): EmailBrandingConfig {
	if (!value) return { ...DEFAULT_CONFIG };
	try {
		const saved = JSON.parse(value) as StoredEmailBranding;
		return {
			logoKey: typeof saved.logoKey === "string" ? saved.logoKey : null,
			defaultLogoVariant: saved.defaultLogoVariant === "white" ? "white" : "black",
			templateHtml: typeof saved.templateHtml === "string" ? saved.templateHtml : DEFAULT_CONFIG.templateHtml,
			applyToSystem: typeof saved.applyToSystem === "boolean" ? saved.applyToSystem : true,
			applyToOutbound: typeof saved.applyToOutbound === "boolean" ? saved.applyToOutbound : false,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export async function getEmailBranding(env: CloudflareEnv): Promise<EmailBrandingResponse> {
	const [settings, entitlements] = await Promise.all([
		getDb(env).select({ emailBranding: appSettings.emailBranding, updatedAt: appSettings.updatedAt })
			.from(appSettings).where(eq(appSettings.id, APP_SETTINGS_ID)).limit(1).then((rows) => rows[0]),
		getLicenseEntitlements(env),
	]);
	const config = parseConfig(settings?.emailBranding);
	const logoVersion = settings?.updatedAt instanceof Date ? settings.updatedAt.getTime().toString() : config.defaultLogoVariant;
	return {
		...config,
		canCustomizeBranding: entitlements.canCustomizeBranding,
		logoUrl: `/api/branding/email-logo?v=${encodeURIComponent(logoVersion)}`,
		logoVersion,
	};
}
export async function saveEmailBranding(
	env: CloudflareEnv,
	input: EmailBrandingConfig,
	logo?: File | null,
	useDefaultLogo = false,
): Promise<EmailBrandingResponse> {
	if (!(await getLicenseEntitlements(env)).canCustomizeBranding) {
		throw new Error("A Pro or Team license is required to customize branding");
	}
	let logoKey = input.logoKey;
	if (useDefaultLogo) logoKey = null;
	if (logo) {
		logoKey = EMAIL_BRANDING_LOGO_KEY;
		await env.BUCKET.put(logoKey, await logo.arrayBuffer(), {
			httpMetadata: { contentType: logo.type },
		});
	}
	const next: EmailBrandingConfig = { ...input, logoKey, templateHtml: sanitizeEmailTemplateHtml(input.templateHtml) };
	await getDb(env)
		.insert(appSettings)
		.values({ id: APP_SETTINGS_ID, emailBranding: JSON.stringify(next) })
		.onConflictDoUpdate({
			target: appSettings.id,
			set: { emailBranding: JSON.stringify(next), updatedAt: new Date() },
		});
	if (useDefaultLogo) await env.BUCKET.delete(EMAIL_BRANDING_LOGO_KEY).catch(() => undefined);
	return getEmailBranding(env);
}

function replaceAll(source: string, token: string, value: string): string {
	return source.split(token).join(value);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

async function readLogo(env: CloudflareEnv, config: EmailBrandingConfig): Promise<AttachmentContent | null> {
	try {
		if (config.logoKey) {
			const object = await env.BUCKET.get(config.logoKey);
			if (!object) return null;
			return {
				filename: "brand-logo.png",
				type: object.httpMetadata?.contentType ?? "image/png",
				content: await object.arrayBuffer(),
				disposition: "inline",
				contentId: "mailos-brand-logo",
			};
		}
		const response = await env.ASSETS.fetch(`https://mailos.local/branding/14-technologies-horizontal-${config.defaultLogoVariant}.png`);
		if (!response.ok) return null;
		return {
			filename: "14-technologies-logo.png",
			type: response.headers.get("content-type") ?? "image/png",
			content: await response.arrayBuffer(),
			disposition: "inline",
			contentId: "mailos-brand-logo",
		};
	} catch {
		return null;
	}
}

/** Applies the shared HTML layout and embeds the logo so email clients need no remote image fetch. */
export async function applyEmailBranding(
	env: CloudflareEnv,
	kind: "system" | "outbound",
	message: { html?: string; text?: string; attachments?: AttachmentContent[] },
	appName: string,
): Promise<{ html?: string; text?: string; attachments: AttachmentContent[] }> {
	let savedTemplate: string | null | undefined;
	try {
		const [settings] = await getDb(env)
			.select({ emailBranding: appSettings.emailBranding })
			.from(appSettings)
			.where(eq(appSettings.id, APP_SETTINGS_ID))
			.limit(1);
		savedTemplate = settings?.emailBranding;
	} catch (error) {
		console.warn("Email branding settings unavailable; sending unwrapped email", error);
		return { html: message.html, text: message.text, attachments: message.attachments ?? [] };
	}
	const config = parseConfig(savedTemplate);
	if (!(kind === "system" ? config.applyToSystem : config.applyToOutbound)) {
		return { html: message.html, text: message.text, attachments: message.attachments ?? [] };
	}
	const [logo, effectiveName] = await Promise.all([
		readLogo(env, config),
		Promise.resolve(appName || "MailOS"),
	]);
	const htmlBody = message.html ?? `<pre style="white-space:pre-wrap;font:15px/1.6 Arial,sans-serif">${escapeHtml(message.text ?? "")}</pre>`;
	const logoMarkup = logo
		? `<img src="cid:mailos-brand-logo" alt="${escapeHtml(effectiveName)}" width="260" style="display:block;width:100%;max-width:260px;height:auto;border:0">`
		: "";
	let html = sanitizeEmailTemplateHtml(config.templateHtml);
	html = replaceAll(html, "{{logo}}", logoMarkup);
	html = replaceAll(html, "{{content}}", htmlBody);
	html = replaceAll(html, "{{appName}}", escapeHtml(effectiveName));
	html = replaceAll(html, "{{year}}", String(new Date().getUTCFullYear()));
	return {
		html,
		text: message.text,
		attachments: [...(message.attachments ?? []), ...(logo ? [logo] : [])],
	};
}
