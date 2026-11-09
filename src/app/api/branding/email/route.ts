import { NextResponse } from "next/server";
import { assertPrimaryAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/cookies";
import { getEmailBranding, saveEmailBranding } from "@/lib/branding/email";
import { getEnv } from "@/lib/cloudflare";
import { isBrandingIcon, BRANDING_ICON_TYPES, MAX_BRANDING_ICON_SIZE } from "@/app/api/branding/utils";
import { hasValidSessionMutationOrigin } from "@/lib/auth/origin";

export async function GET(request: Request) {
	const env = getEnv();
	try {
		assertPrimaryAdmin(await requireUser(env, request));
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	return NextResponse.json(await getEmailBranding(env), { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request) {
	const env = getEnv();
	try {
		assertPrimaryAdmin(await requireUser(env, request));
	} catch {
		return NextResponse.json({ error: "Forbidden" }, { status: 403 });
	}
	if (!hasValidSessionMutationOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

	const form = await request.formData();
	const templateHtml = String(form.get("templateHtml") ?? "");
	if (!templateHtml.trim() || templateHtml.length > 50_000) {
		return NextResponse.json({ error: "Email HTML must be between 1 and 50,000 characters" }, { status: 400 });
	}
	if (!templateHtml.includes("{{logo}}") || !templateHtml.includes("{{content}}")) {
		return NextResponse.json({ error: "Keep both {{logo}} and {{content}} placeholders in the template" }, { status: 400 });
	}
	const logoValue = form.get("logo");
	const logo = isBrandingIcon(logoValue) && logoValue.size > 0 ? logoValue : null;
	if (logo && !BRANDING_ICON_TYPES.includes(logo.type)) {
		return NextResponse.json({ error: "Use a PNG, JPEG, WebP, or GIF image" }, { status: 400 });
	}
	if (logo && logo.size > MAX_BRANDING_ICON_SIZE) {
		return NextResponse.json({ error: "Logo must be 2 MB or smaller" }, { status: 413 });
	}
	const applyToSystem = String(form.get("applyToSystem")) === "true";
	const applyToOutbound = String(form.get("applyToOutbound")) === "true";
	const useDefaultLogo = String(form.get("useDefaultLogo")) === "true";
	const defaultLogoVariant = String(form.get("defaultLogoVariant")) === "white" ? "white" : "black";
	try {
		const current = await getEmailBranding(env);
		const settings = await saveEmailBranding(env, {
			logoKey: current.logoKey,
			defaultLogoVariant,
			templateHtml,
			applyToSystem,
			applyToOutbound,
		}, logo, useDefaultLogo);
		return NextResponse.json(settings);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unable to save email branding";
		return NextResponse.json({ error: message }, { status: /license is required/i.test(message) ? 403 : 500 });
	}
}
