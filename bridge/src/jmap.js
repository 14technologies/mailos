// Minimal JMAP client for the MailOS server (RFC 8620 / 8621).
// A bridge login is "mailbox address + MailOS app password"; the app password is a
// jmap-scoped API key, sent as a Bearer token. MailOS ignores the Basic username.

const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";
const CORE = "urn:ietf:params:jmap:core";

export class JmapError extends Error {
	constructor(message, { status, type } = {}) {
		super(message);
		this.status = status;
		this.type = type;
	}
}

export class JmapClient {
	/**
	 * @param {{ baseUrl: string, token: string, fetch?: typeof fetch }} options
	 */
	constructor({ baseUrl, token, fetch: fetchImpl = globalThis.fetch }) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.token = token;
		this.fetch = fetchImpl;
		this.session = null;
	}

	headers(extra = {}) {
		return { Authorization: `Bearer ${this.token}`, ...extra };
	}

	async getSession() {
		if (this.session) return this.session;
		const res = await this.fetch(`${this.baseUrl}/jmap/session`, { headers: this.headers({ Accept: "application/json" }) });
		if (res.status === 401 || res.status === 403) throw new JmapError("Invalid app password", { status: res.status, type: "auth" });
		if (!res.ok) throw new JmapError(`JMAP session failed (${res.status})`, { status: res.status });
		const session = await res.json();
		const accountId = session.primaryAccounts?.[MAIL];
		if (!accountId) throw new JmapError("JMAP session has no mail account");
		this.session = { ...session, accountId };
		return this.session;
	}

	/** Runs method calls and returns the responses keyed by call id; a method error throws. */
	async call(methodCalls, using = [CORE, MAIL]) {
		const session = await this.getSession();
		const res = await this.fetch(session.apiUrl, {
			method: "POST",
			headers: this.headers({ "Content-Type": "application/json", Accept: "application/json" }),
			body: JSON.stringify({ using, methodCalls }),
		});
		if (res.status === 401 || res.status === 403) throw new JmapError("Invalid app password", { status: res.status, type: "auth" });
		if (!res.ok) throw new JmapError(`JMAP request failed (${res.status})`, { status: res.status });
		const body = await res.json();
		const out = {};
		for (const [name, args, id] of body.methodResponses ?? []) {
			if (name === "error") throw new JmapError(args.description ?? `JMAP ${args.type}`, { type: args.type });
			out[id] = args;
		}
		return out;
	}

	/** Finds the top-level JMAP Mailbox that is the MailOS mailbox for this address. */
	async findMailbox(address) {
		const session = await this.getSession();
		const want = address.trim().toLowerCase();
		const r = await this.call([["Mailbox/get", { accountId: session.accountId, properties: ["id", "name", "parentId", "role"] }, "m"]]);
		const top = (r.m.list ?? []).filter((box) => !box.parentId);
		const match = top.find((box) => {
			const name = String(box.name ?? "").toLowerCase();
			const inAngles = name.match(/<([^>]+)>\s*$/);
			return (inAngles ? inAngles[1] : name).trim() === want;
		});
		return match ? { id: match.id, inbox: `${match.id}~inbox`, drafts: `${match.id}~drafts`, trash: `${match.id}~trash` } : null;
	}

	async findIdentity(address) {
		const session = await this.getSession();
		const want = address.trim().toLowerCase();
		const r = await this.call([["Identity/get", { accountId: session.accountId }, "i"]], [CORE, MAIL, SUBMISSION]);
		return (r.i.list ?? []).find((identity) => String(identity.email).toLowerCase() === want) ?? null;
	}

	/** Inbox messages, oldest first, newest `limit` only: [{ id, blobId, size, receivedAt }]. */
	async listInbox(inboxId, limit) {
		const session = await this.getSession();
		const r = await this.call([
			["Email/query", { accountId: session.accountId, filter: { inMailbox: inboxId }, sort: [{ property: "receivedAt", isAscending: false }], limit }, "q"],
			["Email/get", { accountId: session.accountId, "#ids": { resultOf: "q", name: "Email/query", path: "/ids" }, properties: ["id", "blobId", "size", "receivedAt"] }, "g"],
		]);
		const byId = new Map((r.g.list ?? []).map((email) => [email.id, email]));
		return (r.q.ids ?? []).map((id) => byId.get(id)).filter(Boolean).reverse();
	}

	async downloadBlob(blobId) {
		const session = await this.getSession();
		const url = session.downloadUrl
			.replace("{accountId}", encodeURIComponent(session.accountId))
			.replace("{blobId}", encodeURIComponent(blobId))
			.replace("{name}", "message.eml")
			.replace("{type}", encodeURIComponent("message/rfc822"));
		const res = await this.fetch(url, { headers: this.headers() });
		if (!res.ok) throw new JmapError(`Download failed (${res.status})`, { status: res.status });
		return Buffer.from(await res.arrayBuffer());
	}

	async moveToTrash(emailIds, trashId) {
		if (!emailIds.length) return;
		const session = await this.getSession();
		const update = Object.fromEntries(emailIds.map((id) => [id, { mailboxIds: { [trashId]: true } }]));
		const r = await this.call([["Email/set", { accountId: session.accountId, update }, "s"]]);
		const failed = Object.keys(r.s.notUpdated ?? {});
		if (failed.length) throw new JmapError(`Could not delete ${failed.length} message(s)`);
	}

	async upload(raw) {
		const session = await this.getSession();
		const url = session.uploadUrl.replace("{accountId}", encodeURIComponent(session.accountId));
		const res = await this.fetch(url, { method: "POST", headers: this.headers({ "Content-Type": "message/rfc822" }), body: raw });
		if (res.status === 413) throw new JmapError("Message too large", { status: 413, type: "tooLarge" });
		if (!res.ok) throw new JmapError(`Upload failed (${res.status})`, { status: res.status });
		return (await res.json()).blobId;
	}

	/** Stores raw MIME as a draft in the mailbox, then sends it from the identity. */
	async sendRaw({ raw, draftsId, identityId }) {
		const session = await this.getSession();
		const blobId = await this.upload(raw);
		const r = await this.call(
			[
				["Email/import", { accountId: session.accountId, emails: { draft: { blobId, mailboxIds: { [draftsId]: true }, keywords: { $draft: true, $seen: true } } } }, "imp"],
				["EmailSubmission/set", { accountId: session.accountId, create: { send: { identityId, emailId: "#draft" } } }, "sub"],
			],
			[CORE, MAIL, SUBMISSION],
		);
		const importError = r.imp.notCreated?.draft;
		if (importError) throw new JmapError(importError.description ?? `Import failed: ${importError.type}`, { type: importError.type });
		const sendError = r.sub.notCreated?.send;
		if (sendError) throw new JmapError(sendError.description ?? `Send failed: ${sendError.type}`, { type: sendError.type });
		return r.sub.created?.send?.id ?? null;
	}
}
