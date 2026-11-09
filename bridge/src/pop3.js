// POP3 (RFC 1939, RFC 2449 CAPA, RFC 2595 STLS, RFC 5034 SASL PLAIN) over the MailOS Inbox.
import net from "node:net";
import tls from "node:tls";

const MAX_LINE = 4096;

/** Dot-stuffs a message and guarantees CRLF line endings (RFC 1939 §3). */
export function stuff(buffer) {
	const text = buffer.toString("latin1").replace(/\r?\n/g, "\r\n");
	const stuffed = text.replace(/(^|\r\n)\./g, "$1..");
	return Buffer.from(stuffed.endsWith("\r\n") ? stuffed : `${stuffed}\r\n`, "latin1");
}

/** Headers, blank line, then the first `lines` body lines (TOP). */
export function topOf(buffer, lines) {
	const text = buffer.toString("latin1").replace(/\r?\n/g, "\r\n");
	const split = text.indexOf("\r\n\r\n");
	if (split < 0) return Buffer.from(text, "latin1");
	const head = text.slice(0, split + 4);
	const body = text.slice(split + 4).split("\r\n").slice(0, lines).join("\r\n");
	return Buffer.from(head + body, "latin1");
}

export function createPop3Handler({ authenticate, maxMessages = 1000, log = () => {}, tlsOptions = null, implicitTls = false }) {
	return function handle(rawSocket) {
		let socket = rawSocket; // replaced by the TLS socket after STLS
		let awaitingPlain = false;
		let state = "AUTH";
		let user = null;
		let session = null; // { client, mailbox, messages: [{id, blobId, size}], deleted: Set<number> }
		let buffer = "";
		let busy = Promise.resolve();
		let secure = implicitTls;
		let authFailures = 0;

		const write = (line) => socket.write(`${line}\r\n`);
		const ok = (text = "") => write(`+OK${text ? ` ${text}` : ""}`);
		const err = (text) => write(`-ERR ${text}`);

		socket.setTimeout(10 * 60 * 1000, () => socket.destroy());
		socket.on("error", () => socket.destroy());
		ok("MailOS POP3 ready (by 14 Technologies)");

		const onData = (chunk) => {
			buffer += chunk.toString("latin1");
			if (buffer.length > MAX_LINE * 4 && !buffer.includes("\n")) return socket.destroy();
			let index;
			while ((index = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, index).replace(/\r$/, "");
				buffer = buffer.slice(index + 1);
				busy = busy.then(() => command(line)).catch((error) => {
					log("pop3 error", error?.message);
					err("Server error, try again");
				});
			}
		};
		socket.on("data", onData);

		const message = (arg) => {
			const n = Number(arg);
			if (!Number.isInteger(n) || n < 1 || n > session.messages.length) return null;
			if (session.deleted.has(n)) return null;
			return { n, msg: session.messages[n - 1] };
		};

		async function login(username, password) {
			const result = await authenticate(username, password);
			if (!result.ok) {
				authFailures += 1;
				err(result.temporary ? `[SYS/TEMP] ${result.reason}` : `[AUTH] ${result.reason}`);
				if (authFailures >= 3) socket.end();
				return;
			}
			const messages = await result.client.listInbox(result.mailbox.inbox, maxMessages);
			session = { client: result.client, mailbox: result.mailbox, messages, deleted: new Set() };
			state = "TRANSACTION";
			log("pop3 login", result.address, messages.length);
			ok(`${messages.length} messages`);
		}

		function plainLogin(b64) {
			const parts = Buffer.from(b64, "base64").toString("utf8").split("\0");
			return login(parts[1] ?? "", parts[2] ?? "");
		}

		async function command(line) {
			if (awaitingPlain) {
				awaitingPlain = false;
				if (line === "*") return err("Authentication cancelled");
				return plainLogin(line.trim());
			}
			const [rawCmd, ...args] = line.split(" ");
			const cmd = (rawCmd ?? "").toUpperCase();
			if (cmd === "QUIT") {
				if (state === "TRANSACTION" && session.deleted.size) {
					const ids = [...session.deleted].map((n) => session.messages[n - 1].id);
					try {
						await session.client.moveToTrash(ids, session.mailbox.trash);
					} catch {
						err("Some messages could not be deleted");
						return socket.end();
					}
				}
				ok("Bye");
				return socket.end();
			}
			if (cmd === "NOOP") return ok();
			if (cmd === "CAPA") {
				ok("Capability list follows");
				for (const capability of ["USER", "UIDL", "TOP", "SASL PLAIN", "RESP-CODES", "AUTH-RESP-CODE", "PIPELINING", "IMPLEMENTATION MailOS-Bridge"]) write(capability);
				if (tlsOptions && !secure) write("STLS");
				return write(".");
			}
			if (state === "AUTH") {
				if (cmd === "STLS") {
					if (!tlsOptions || secure) return err("TLS not available");
					ok("Begin TLS");
					rawSocket.removeListener("data", onData);
					buffer = "";
					const secured = new tls.TLSSocket(rawSocket, { isServer: true, ...tlsOptions });
					secured.on("data", onData);
					secured.on("error", () => secured.destroy());
					socket = secured;
					secure = true;
					return;
				}
				if (tlsOptions && !secure && (cmd === "USER" || cmd === "PASS" || cmd === "AUTH")) return err("[AUTH] Use STLS or port 995 first");
				if (cmd === "USER") {
					user = args.join(" ");
					return ok("Send your MailOS app password");
				}
				if (cmd === "PASS") {
					if (!user) return err("USER first");
					return login(user, args.join(" "));
				}
				if (cmd === "AUTH" && (args[0] ?? "").toUpperCase() === "PLAIN") {
					if (args[1]) return plainLogin(args[1]);
					awaitingPlain = true;
					return write("+ ");
				}
				return err("Authenticate first");
			}
			// TRANSACTION
			const live = session.messages.map((m, i) => ({ ...m, n: i + 1 })).filter((m) => !session.deleted.has(m.n));
			switch (cmd) {
				case "STAT":
					return ok(`${live.length} ${live.reduce((sum, m) => sum + (m.size ?? 0), 0)}`);
				case "LIST":
				case "UIDL": {
					const field = (m) => (cmd === "LIST" ? m.size ?? 0 : m.id);
					if (args[0]) {
						const found = message(args[0]);
						return found ? ok(`${found.n} ${field(found.msg)}`) : err("No such message");
					}
					ok(cmd === "LIST" ? `${live.length} messages` : "");
					for (const m of live) write(`${m.n} ${field(m)}`);
					return write(".");
				}
				case "RETR":
				case "TOP": {
					const found = message(args[0]);
					if (!found) return err("No such message");
					const raw = await session.client.downloadBlob(found.msg.blobId);
					const body = cmd === "TOP" ? topOf(raw, Math.max(0, Number(args[1]) || 0)) : raw;
					ok(`${raw.length} octets`);
					socket.write(stuff(body));
					return write(".");
				}
				case "DELE": {
					const found = message(args[0]);
					if (!found) return err("No such message");
					session.deleted.add(found.n);
					return ok(`Message ${found.n} deleted`);
				}
				case "RSET":
					session.deleted.clear();
					return ok();
				default:
					return err("Unknown command");
			}
		}
	};
}

export function startPop3({ port, host = "0.0.0.0", tlsOptions, implicitTls, ...options }) {
	const handler = createPop3Handler({ ...options, tlsOptions, implicitTls });
	const server = implicitTls ? tls.createServer(tlsOptions, handler) : net.createServer(handler);
	return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
