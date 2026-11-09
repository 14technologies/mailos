// MailOS bridge: lets ordinary mail apps (Gmail, Outlook, Apple Mail, Thunderbird)
// receive (POP3) and send (SMTP submission) through a MailOS server.
import { readFileSync, watchFile } from "node:fs";
import { createAuthenticator } from "./auth.js";
import { startPop3 } from "./pop3.js";
import { startSmtp } from "./smtp.js";

const env = process.env;
const baseUrl = env.MAILOS_URL;
if (!baseUrl) {
	console.error("Set MAILOS_URL, e.g. https://mail.example.com");
	process.exit(1);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

function loadTls() {
	if (!env.TLS_CERT || !env.TLS_KEY) return null;
	return { cert: readFileSync(env.TLS_CERT), key: readFileSync(env.TLS_KEY) };
}

const tlsOptions = loadTls();
if (!tlsOptions && env.ALLOW_PLAINTEXT !== "true") {
	console.error("Set TLS_CERT and TLS_KEY (or ALLOW_PLAINTEXT=true for local testing only).");
	process.exit(1);
}

const authenticate = createAuthenticator({ baseUrl });
const maxMessages = Number(env.POP3_MAX_MESSAGES || 1000);
const servers = [];

if (tlsOptions) {
	servers.push(await startPop3({ port: Number(env.POP3S_PORT || 995), implicitTls: true, tlsOptions, authenticate, maxMessages, log }));
	servers.push(await startSmtp({ port: Number(env.SMTPS_PORT || 465), secure: true, tlsOptions, authenticate, log }));
}
servers.push(await startPop3({ port: Number(env.POP3_PORT || 110), implicitTls: false, tlsOptions, authenticate, maxMessages, log }));
servers.push(await startSmtp({ port: Number(env.SUBMISSION_PORT || 587), secure: false, tlsOptions, authenticate, log }));

log(`MailOS bridge ready for ${baseUrl} (${tlsOptions ? "TLS" : "PLAINTEXT - testing only"})`);

// Let's Encrypt renews certificates in place; restart to pick them up.
if (env.TLS_CERT) watchFile(env.TLS_CERT, { interval: 60 * 60 * 1000 }, () => {
	log("certificate changed, restarting");
	process.exit(0);
});

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
	for (const server of servers) server.close();
	process.exit(0);
});
