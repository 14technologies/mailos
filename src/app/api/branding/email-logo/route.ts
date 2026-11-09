import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { EMAIL_BRANDING_LOGO_KEY } from "@/lib/branding/email";
import { APP_SETTINGS_ID } from "@/lib/branding/service";
import { getEnvAsync } from "@/lib/cloudflare";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
	const env = await getEnvAsync();
	let saved: { logoKey?: string | null; defaultLogoVariant?: string } | null = null;
	try {
		const [row] = await getDb(env).select({ emailBranding: appSettings.emailBranding })
			.from(appSettings).where(eq(appSettings.id, APP_SETTINGS_ID)).limit(1);
		saved = row?.emailBranding ? JSON.parse(row.emailBranding) as { logoKey?: string | null; defaultLogoVariant?: string } : null;
		if (saved?.logoKey === EMAIL_BRANDING_LOGO_KEY) {
			const logo = await env.BUCKET.get(EMAIL_BRANDING_LOGO_KEY);
			if (logo) {
				return new Response(logo.body, { headers: {
					"Content-Type": logo.httpMetadata?.contentType ?? "image/png",
					"Cache-Control": "public, max-age=300",
					"X-Content-Type-Options": "nosniff",
				} });
			}
		}
	} catch {
		// Use the bundled company logo if the saved branding is unavailable.
	}
	const defaultVariant = saved?.defaultLogoVariant === "white" ? "white" : "black";
	const asset = await env.ASSETS.fetch(`https://mailos.local/branding/14-technologies-horizontal-${defaultVariant}.png`);
	const headers = new Headers(asset.headers);
	headers.set("Cache-Control", "public, max-age=300");
	headers.set("X-Content-Type-Options", "nosniff");
	return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}
