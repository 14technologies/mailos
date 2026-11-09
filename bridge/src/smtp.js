// SMTP submission (RFC 6409) into MailOS: authenticated clients only, no relaying.
import { SMTPServer } from "smtp-server";

/** Every address in a header value (To/Cc/Bcc), lower-cased. */
export function addressesIn(value) {
	return [...String(value ?? "").matchAll(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0].toLowerCase());
}

/** Unfolded header block of a raw message, as [name, value] pairs. */
export function readHeaders(raw) {
	const text = raw.toString("latin1");
	const end = text.search(/\r?\n\r?\n/);
	const block = (end < 0 ? text : text.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
	return block.split(/\r?\n/).map((line) => {
		const i = line.indexOf(":");
		return i < 0 ? null : [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
	}).filter(Boolean);
}

/**
 * Mail apps put Bcc recipients only in the SMTP envelope and strip the header.
 * MailOS sends to the recipients named in the message, so envelope recipients that
 * are not in To/Cc are written back as a Bcc header (MailOS removes it before delivery).
 */
export function withEnvelopeBcc(raw, envelopeRecipients) {
	const headers = readHeaders(raw);
	const named = new Set(headers.filter(([name]) => name === "to" || name === "cc" || name === "bcc").flatMap(([, value]) => addressesIn(value)));
	const extra = [...new Set(envelopeRecipients.map((a) => a.toLowerCase()))].filter((a) => !named.has(a));
	if (!extra.length) return raw;
	return Buffer.concat([Buffer.from(`Bcc: ${extra.join(", ")}\r\n`, "latin1"), raw]);
}

export function createSmtpServer({ authenticate, tlsOptions, secure, maxSize = 25 * 1024 * 1024, log = () => {} }) {
	return new SMTPServer({
		name: process.env.BRIDGE_HOSTNAME || "mailos-bridge",
		banner: "MailOS SMTP submission (by 14 Technologies)",
		secure,
		...(tlsOptions ?? {}),
		authMethods: ["PLAIN", "LOGIN"],
		authOptional: false,
		allowInsecureAuth: !tlsOptions, // only for local testing without certificates
		disabledCommands: tlsOptions ? [] : ["STARTTLS"],
		size: maxSize,
		logger: false,
		async onAuth(auth, _session, callback) {
			const result = await authenticate(auth.username, auth.password);
			if (!result.ok) {
				const error = new Error(result.reason);
				error.responseCode = result.temporary ? 454 : 535;
				return callback(error);
			}
			callback(null, { user: result });
		},
		async onMailFrom(address, session, callback) {
			const auth = session.user;
			const from = address.address.toLowerCase();
			try {
				const identity = await auth.client.findIdentity(from);
				if (!identity) {
					const error = new Error(`${auth.address} may not send as ${from}`);
					error.responseCode = 553;
					return callback(error);
				}
				session.identityId = identity.id;
				callback();
			} catch (error) {
				log("smtp identity", error?.message);
				const tempError = new Error("MailOS is unreachable, try again");
				tempError.responseCode = 451;
				callback(tempError);
			}
		},
		onData(stream, session, callback) {
			const chunks = [];
			stream.on("data", (chunk) => chunks.push(chunk));
			stream.on("end", async () => {
				if (stream.sizeExceeded) {
					const error = new Error("Message exceeds the size limit");
					error.responseCode = 552;
					return callback(error);
				}
				const auth = session.user;
				try {
					const raw = withEnvelopeBcc(Buffer.concat(chunks), session.envelope.rcptTo.map((r) => r.address));
					const id = await auth.client.sendRaw({ raw, draftsId: auth.mailbox.drafts, identityId: session.identityId });
					log("smtp sent", auth.address, id);
					callback(null, `Message accepted by MailOS${id ? ` (${id})` : ""}`);
				} catch (error) {
					log("smtp send failed", auth.address, error?.message);
					const failure = new Error(`MailOS could not send this message: ${error?.message ?? "unknown error"}`);
					failure.responseCode = error?.status && error.status < 500 ? 554 : 451;
					callback(failure);
				}
			});
		},
	});
}

export function startSmtp({ port, host = "0.0.0.0", ...options }) {
	const server = createSmtpServer(options);
	server.on("error", (error) => options.log?.("smtp server error", error?.message));
	return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
