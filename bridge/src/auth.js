import { createHash } from "node:crypto";
import { JmapClient, JmapError } from "./jmap.js";

const CACHE_MS = 5 * 60 * 1000;

/**
 * Checks "mailbox address + MailOS app password" against MailOS and returns a
 * ready client for that mailbox. Results are cached briefly so a mail app that
 * opens many connections does not hammer the API; a wrong password is cached too
 * (shorter) to slow down guessing.
 */
export function createAuthenticator({ baseUrl, fetch: fetchImpl, now = () => Date.now() }) {
	const cache = new Map();

	function prune() {
		const t = now();
		for (const [key, entry] of cache) if (entry.expires <= t) cache.delete(key);
	}

	return async function authenticate(username, password) {
		const address = String(username ?? "").trim().toLowerCase();
		const secret = String(password ?? "");
		if (!address.includes("@") || !secret) return { ok: false, reason: "Username must be the full email address" };
		prune();
		const key = createHash("sha256").update(`${address}\0${secret}`).digest("hex");
		const hit = cache.get(key);
		if (hit) return hit.result;

		let result;
		try {
			const client = new JmapClient({ baseUrl, token: secret, fetch: fetchImpl });
			const mailbox = await client.findMailbox(address);
			result = mailbox ? { ok: true, address, client, mailbox } : { ok: false, reason: "This app password has no access to that mailbox" };
		} catch (error) {
			if (error instanceof JmapError && error.type === "auth") result = { ok: false, reason: "Invalid app password" };
			else return { ok: false, reason: "MailOS is unreachable, try again", temporary: true };
		}
		cache.set(key, { result, expires: now() + (result.ok ? CACHE_MS : 30_000) });
		return result;
	};
}
