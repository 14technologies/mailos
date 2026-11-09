import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createAuthenticator } from "../src/auth.js";
import { startPop3, stuff } from "../src/pop3.js";
import { startSmtp, withEnvelopeBcc } from "../src/smtp.js";

const TOKEN = "app-password-123";
const MBX = "mbx_1";

// --- fake MailOS JMAP server -------------------------------------------------
const state = {
	emails: [
		{ id: "e1", blobId: "msg~e1", size: 40, receivedAt: "2026-01-01T00:00:00Z", raw: "Subject: one\r\n\r\nhello\r\n.dot line\r\n", mailbox: `${MBX}~inbox` },
		{ id: "e2", blobId: "msg~e2", size: 30, receivedAt: "2026-01-02T00:00:00Z", raw: "Subject: two\r\n\r\nworld\r\n", mailbox: `${MBX}~inbox` },
	],
	uploads: new Map(),
	sent: [],
};

let base;
const fake = http.createServer(async (req, res) => {
	const json = (code, body) => {
		res.writeHead(code, { "Content-Type": "application/json" });
		res.end(JSON.stringify(body));
	};
	if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "unauthorized" });
	const chunks = [];
	for await (const c of req) chunks.push(c);
	const body = Buffer.concat(chunks);
	if (req.url === "/jmap/session") {
		return json(200, {
			primaryAccounts: { "urn:ietf:params:jmap:mail": "acc1" },
			apiUrl: `${base}/jmap/api`,
			uploadUrl: `${base}/jmap/upload/{accountId}`,
			downloadUrl: `${base}/jmap/download/{accountId}/{blobId}/{name}?type={type}`,
		});
	}
	if (req.url.startsWith("/jmap/upload/")) {
		const blobId = `up~${state.uploads.size + 1}`;
		state.uploads.set(blobId, body.toString("latin1"));
		return json(201, { blobId });
	}
	if (req.url.startsWith("/jmap/download/")) {
		const blobId = decodeURIComponent(req.url.split("/")[4]);
		const email = state.emails.find((e) => e.blobId === blobId);
		if (!email) return json(404, {});
		res.writeHead(200, { "Content-Type": "message/rfc822" });
		return res.end(email.raw);
	}
	if (req.url === "/jmap/api") {
		const { methodCalls } = JSON.parse(body.toString());
		const out = [];
		const created = {};
		for (const [name, args, id] of methodCalls) {
			if (name === "Mailbox/get") out.push([name, { list: [{ id: MBX, name: "Fariha <fariha@example.com>", parentId: null }, { id: `${MBX}~inbox`, name: "Inbox", parentId: MBX, role: "inbox" }] }, id]);
			else if (name === "Identity/get") out.push([name, { list: [{ id: "idn_1", email: "fariha@example.com" }] }, id]);
			else if (name === "Email/query") {
				const ids = state.emails.filter((e) => e.mailbox === args.filter.inMailbox).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((e) => e.id);
				out.push([name, { ids: ids.slice(0, args.limit) }, id]);
			} else if (name === "Email/get") {
				const prev = out.find(([, , callId]) => callId === args["#ids"].resultOf)[1].ids;
				out.push([name, { list: state.emails.filter((e) => prev.includes(e.id)) }, id]);
			} else if (name === "Email/set") {
				for (const [emailId, patch] of Object.entries(args.update)) state.emails.find((e) => e.id === emailId).mailbox = Object.keys(patch.mailboxIds)[0];
				out.push([name, { updated: args.update }, id]);
			} else if (name === "Email/import") {
				const draft = args.emails.draft;
				created.draft = { id: "draft1", raw: state.uploads.get(draft.blobId), mailboxIds: draft.mailboxIds };
				out.push([name, { created: { draft: { id: "draft1" } } }, id]);
			} else if (name === "EmailSubmission/set") {
				const sub = args.create.send;
				assert.equal(sub.emailId, "#draft");
				state.sent.push({ identityId: sub.identityId, ...created.draft });
				out.push([name, { created: { send: { id: "sent1" } } }, id]);
			}
		}
		return json(200, { methodResponses: out });
	}
	json(404, {});
});

let pop3;
let smtp;
before(async () => {
	await new Promise((r) => fake.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${fake.address().port}`;
	const authenticate = createAuthenticator({ baseUrl: base });
	pop3 = await startPop3({ port: 0, host: "127.0.0.1", implicitTls: false, tlsOptions: null, authenticate, maxMessages: 100 });
	smtp = await startSmtp({ port: 0, host: "127.0.0.1", secure: false, tlsOptions: null, authenticate });
});
after(() => {
	pop3.close();
	smtp.close();
	fake.close();
});

/** Talks to a line-based server: sends each command once the expected reply arrives. */
function converse(port, steps) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(port, "127.0.0.1");
		let transcript = "";
		let i = 0;
		socket.setTimeout(5000, () => reject(new Error(`timeout; transcript:\n${transcript}`)));
		socket.on("data", (d) => {
			transcript += d.toString("latin1");
			while (i < steps.length && steps[i].until.test(transcript)) {
				const step = steps[i++];
				if (step.send !== undefined) socket.write(`${step.send}\r\n`);
				if (i === steps.length) socket.end();
			}
		});
		socket.on("end", () => resolve(transcript));
		socket.on("error", reject);
	});
}

test("dot-stuffing escapes leading dots and normalises line endings", () => {
	assert.equal(stuff(Buffer.from("a\n.b\n")).toString(), "a\r\n..b\r\n");
});

test("envelope-only recipients become a Bcc header", () => {
	const raw = Buffer.from("To: a@x.com\r\nCc: b@x.com\r\nSubject: s\r\n\r\nbody");
	const out = withEnvelopeBcc(raw, ["a@x.com", "B@x.com", "secret@x.com"]).toString();
	assert.match(out, /^Bcc: secret@x\.com\r\n/);
	assert.equal(withEnvelopeBcc(raw, ["a@x.com"]), raw);
});

test("POP3 rejects a wrong app password", async () => {
	const t = await converse(pop3.address().port, [
		{ until: /\+OK MailOS/, send: "USER fariha@example.com" },
		{ until: /Send your/, send: "PASS wrong" },
		{ until: /-ERR \[AUTH\]/, send: "QUIT" },
		{ until: /Bye|-ERR/ },
	]);
	assert.match(t, /-ERR \[AUTH\] Invalid app password/);
});

test("POP3 lists, retrieves (dot-stuffed) and deletes to Trash", async () => {
	const t = await converse(pop3.address().port, [
		{ until: /\+OK MailOS/, send: "USER fariha@example.com" },
		{ until: /Send your/, send: `PASS ${TOKEN}` },
		{ until: /\+OK 2 messages/, send: "UIDL" },
		{ until: /2 e2\r\n\.\r\n/, send: "RETR 1" },
		{ until: /\.\.dot line\r\n\.\r\n/, send: "DELE 1" },
		{ until: /deleted/, send: "STAT" },
		{ until: /\+OK 1 30/, send: "QUIT" },
		{ until: /Bye/ },
	]);
	assert.match(t, /1 e1\r\n2 e2/, "oldest first");
	assert.match(t, /Subject: one\r\n\r\nhello\r\n\.\.dot line/);
	assert.equal(state.emails.find((e) => e.id === "e1").mailbox, `${MBX}~trash`);
});

test("POP3 AUTH PLAIN with a continuation line", async () => {
	const plain = Buffer.from(`\0fariha@example.com\0${TOKEN}`).toString("base64");
	const t = await converse(pop3.address().port, [
		{ until: /\+OK MailOS/, send: "AUTH PLAIN" },
		{ until: /\+ \r\n/, send: plain },
		{ until: /\+OK \d+ messages/, send: "QUIT" },
		{ until: /Bye/ },
	]);
	assert.match(t, /\+OK 1 messages/);
});

test("SMTP sends through MailOS and keeps Bcc recipients", async () => {
	const auth = Buffer.from(`\0fariha@example.com\0${TOKEN}`).toString("base64");
	const t = await converse(smtp.server.address().port, [
		{ until: /^220 /m, send: "EHLO client.test" },
		{ until: /^250 /m, send: `AUTH PLAIN ${auth}` },
		{ until: /^235 /m, send: "MAIL FROM:<fariha@example.com>" },
		{ until: /^250 .*Accepted/im, send: "RCPT TO:<to@dest.com>" },
		{ until: /(250 .*Accepted[\s\S]*){2}/i, send: "RCPT TO:<hidden@dest.com>" },
		{ until: /(250 .*Accepted[\s\S]*){3}/i, send: "DATA" },
		{ until: /^354 /m, send: "From: fariha@example.com\r\nTo: to@dest.com\r\nSubject: hi\r\n\r\nhello\r\n." },
		{ until: /Message accepted by MailOS/, send: "QUIT" },
		{ until: /^221 /m },
	]);
	assert.match(t, /Message accepted by MailOS \(sent1\)/);
	const sent = state.sent.at(-1);
	assert.equal(sent.identityId, "idn_1");
	assert.match(sent.raw, /^Bcc: hidden@dest\.com\r\n/);
	assert.deepEqual(Object.keys(sent.mailboxIds), [`${MBX}~drafts`]);
});

test("SMTP refuses sending as an address the account does not own", async () => {
	const auth = Buffer.from(`\0fariha@example.com\0${TOKEN}`).toString("base64");
	const t = await converse(smtp.server.address().port, [
		{ until: /^220 /m, send: "EHLO client.test" },
		{ until: /^250 /m, send: `AUTH PLAIN ${auth}` },
		{ until: /^235 /m, send: "MAIL FROM:<ceo@other.com>" },
		{ until: /^553 /m, send: "QUIT" },
		{ until: /^221 /m },
	]);
	assert.match(t, /553 .*may not send as ceo@other\.com/);
});
