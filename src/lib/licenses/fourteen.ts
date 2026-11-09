// Client for the 14 Technologies license server (WordPress plugin "Fourteen Store & Licensing").
//   POST {server}/wp-json/fourteen/v1/license/activate   {key, product, site, instance, nonce, version}
//   POST {server}/wp-json/fourteen/v1/license/check      {key, product, site, instance, nonce}
//   POST {server}/wp-json/fourteen/v1/license/deactivate {key, product, site, instance}
// A success is {token, signature}: token is JSON signed with the server's Ed25519 key.
// The reply is trusted only if the signature verifies against FOURTEEN_LICENSE_PUBLIC_KEY
// and it echoes this request's one-time nonce, site and install id.
import type { LicenseState, PaymugLicenseAction, PaymugLicenseResponse } from "./types";
import { FOURTEEN_STORE_URL, MAILOS_PLANS, planForProduct, type MailosPlan } from "./mailos-plans";

export type FourteenToken = {
	license?: number;
	product?: string;
	site?: string;
	instance?: string;
	nonce?: string;
	plan?: string; // tier: monthly | yearly | two_year | four_year | lifetime
	max_sites?: number;
	expires?: number | null; // unix seconds; 0/null = never
	status?: string;
	customer?: string;
	checked_at?: number;
	kid?: string;
};

type FourteenConfig = { server: string; publicKey: Uint8Array<ArrayBuffer> };

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value.trim());
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

export function readFourteenConfig(env: CloudflareEnv): FourteenConfig {
	const vars = env as unknown as Record<string, string | undefined>;
	const key = vars.FOURTEEN_LICENSE_PUBLIC_KEY?.trim();
	if (!key) throw new Error("License checks are not configured: set FOURTEEN_LICENSE_PUBLIC_KEY (Store → Settings → Product build settings on 14technologies.com).");
	const publicKey = base64ToBytes(key);
	if (publicKey.length !== 32) throw new Error("FOURTEEN_LICENSE_PUBLIC_KEY is not a valid Ed25519 public key.");
	return { server: (vars.FOURTEEN_LICENSE_SERVER?.trim() || FOURTEEN_STORE_URL).replace(/\/+$/, ""), publicKey };
}

/** The site name the license is bound to: the bare host, as WordPress products send it. */
export function siteFromUrl(instanceUrl: string): string {
	try {
		return new URL(instanceUrl).host.toLowerCase();
	} catch {
		return instanceUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
	}
}

export async function verifySignature(publicKey: Uint8Array<ArrayBuffer>, token: string, signatureB64: string): Promise<boolean> {
	try {
		const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
		return await crypto.subtle.verify({ name: "Ed25519" }, key, base64ToBytes(signatureB64), new TextEncoder().encode(token));
	} catch {
		return false;
	}
}

/** Checks a verified token against what this request asked for and maps it to a license result. */
export function evaluateToken(
	token: FourteenToken,
	expected: { plan: MailosPlan; site: string; instance: string; nonce: string },
	now = Date.now(),
): PaymugLicenseResponse {
	if (token.nonce !== expected.nonce || token.site !== expected.site || (token.instance && token.instance !== expected.instance)) {
		return { valid: false, state: "invalid" };
	}
	const plan = planForProduct(token.product);
	let state: Exclude<LicenseState, "inactive"> = "active";
	if (token.expires && token.expires * 1000 <= now) state = "expired";
	else if (token.status !== "active" || plan !== expected.plan) state = "invalid";
	return { valid: state === "active", state, plan: plan ?? undefined, seatLimit: MAILOS_PLANS[expected.plan].seats };
}

function randomNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function post(server: string, action: string, body: unknown): Promise<Response> {
	try {
		return await fetch(`${server}/wp-json/fourteen/v1/license/${action}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		throw new Error("Unable to reach 14technologies.com. Try again later.");
	}
}

/** The server explains refusals (expired, suspended, already used on another site…); show its message. */
async function failure(response: Response): Promise<Error> {
	const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
	if (body && typeof body.message === "string" && body.message) return new Error(body.message);
	if (response.status === 429) return new Error("Too many attempts. Try again in a few minutes.");
	if (response.status >= 500) return new Error("14technologies.com is temporarily unavailable. Try again later.");
	return new Error("14technologies.com could not process this license request.");
}

export async function callFourteenLicenseApi(
	env: CloudflareEnv,
	action: PaymugLicenseAction,
	input: { licenseKey: string; plan: MailosPlan; instanceId: string; instanceUrl: string; version: string },
): Promise<PaymugLicenseResponse> {
	const config = readFourteenConfig(env);
	const site = siteFromUrl(input.instanceUrl);
	const base = { key: input.licenseKey, product: MAILOS_PLANS[input.plan].product, site, instance: input.instanceId };

	if (action === "deactivate") {
		if (input.licenseKey) {
			const response = await post(config.server, "deactivate", base);
			if (!response.ok && response.status !== 404) throw await failure(response);
		}
		return { valid: false, state: "deactivated" };
	}

	const nonce = randomNonce();
	const response = await post(config.server, action === "activate" ? "activate" : "check", {
		...base,
		nonce,
		...(action === "activate" ? { version: input.version } : {}),
	});
	if (!response.ok) throw await failure(response);
	const reply = (await response.json().catch(() => null)) as { token?: unknown; signature?: unknown } | null;
	if (!reply || typeof reply.token !== "string" || typeof reply.signature !== "string") throw new Error("14technologies.com returned an invalid license reply.");
	if (!(await verifySignature(config.publicKey, reply.token, reply.signature))) throw new Error("The license reply's signature is invalid.");
	let token: FourteenToken;
	try {
		token = JSON.parse(reply.token) as FourteenToken;
	} catch {
		throw new Error("14technologies.com returned an invalid license reply.");
	}
	return evaluateToken(token, { plan: input.plan, site, instance: input.instanceId, nonce });
}
