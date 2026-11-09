import { NextResponse } from "next/server";
import { getEnv } from "@/lib/cloudflare";
import { deactivateLicense } from "@/lib/licenses/service";
import { getLicenseErrorResponse, requireLicenseAdmin } from "../utils";

export async function POST(request: Request) {
	const env = getEnv();
	const forbidden = await requireLicenseAdmin(env, request);
	if (forbidden) return forbidden;

	try {
		// Polar needs the key to release this installation's activation; without it the
		// license is only removed here and can be freed in the Polar customer portal.
		const body = (await request.json().catch(() => ({}))) as { licenseKey?: unknown };
		const licenseKey = typeof body.licenseKey === "string" ? body.licenseKey.trim() : "";
		const license = await deactivateLicense(env, licenseKey);
		return NextResponse.json({ license });
	} catch (error) {
		return getLicenseErrorResponse(error);
	}
}
