// A page load that fails because the connection dropped shows MailOS's own "Reconnecting…" screen,
// which reopens the page by itself, instead of the browser's "site can't be reached".
const OFFLINE_CACHE = "mailos-offline-v3";
// Cloudflare serves static pages without ".html" (/offline.html redirects to /offline), so store the final URL.
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
	console.log("[sw] installed, activating immediately");
	event.waitUntil(
		caches
			.open(OFFLINE_CACHE)
			.then((cache) => cache.addAll([OFFLINE_URL, "/icon-192.png"]))
			.catch(() => undefined)
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	console.log("[sw] activated, claiming clients");
	event.waitUntil(
		(async () => {
			const names = await caches.keys();
			await Promise.all(names.filter((name) => name.startsWith("mailos-offline-") && name !== OFFLINE_CACHE).map((name) => caches.delete(name)));
			await self.clients.claim();
		})(),
	);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Only page navigations are handled; API calls, assets and realtime go straight to the network.
self.addEventListener("fetch", (event) => {
	// The reconnecting screen's logo: network first, the stored copy when offline.
	if (event.request.method === "GET" && new URL(event.request.url).pathname === "/icon-192.png") {
		event.respondWith(fetch(event.request).catch(async () => (await caches.match("/icon-192.png")) || Response.error()));
		return;
	}
	if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
	event.respondWith(
		(async () => {
			try {
				return await fetch(event.request);
			} catch {
				// Mobile networks often drop for a second: try once more before showing the screen.
				await wait(1500);
				try {
					return await fetch(event.request);
				} catch {
					const cached = await caches.match(OFFLINE_URL);
					return cached || Response.error();
				}
			}
		})(),
	);
});

self.addEventListener("message", (event) => {
	if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const DEFAULT_NOTIFICATION = {
	title: "New email",
	body: "You have a new message",
	icon: "/icon-192.png",
	badge: "/icon-96.png",
	url: "/inbox",
};

async function syncAppBadge() {
	if (!("setAppBadge" in self.navigator)) return;
	try {
		const response = await fetch("/api/messages/counts", { credentials: "include" });
		if (!response.ok) return;
		const unread = (await response.json())?.counts?.folders?.inbox?.unread;
		if (typeof unread !== "number") return;
		await (unread > 0 ? self.navigator.setAppBadge(unread) : self.navigator.clearAppBadge());
	} catch {
		// Leave the badge as it was when the network is down or the API rejects outside an installed app.
	}
}

self.addEventListener("push", (event) => {
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			if (windows.some((client) => client.visibilityState === "visible")) return;

			let payload = DEFAULT_NOTIFICATION;
			try {
				payload = { ...DEFAULT_NOTIFICATION, ...(event.data?.json() ?? {}) };
			} catch {
				// Keep the generic notification if a provider delivers an empty or malformed payload.
			}

			await Promise.all([
				self.registration.showNotification(payload.title, {
					body: payload.body,
					icon: payload.icon,
					badge: payload.badge,
					tag: payload.tag,
					data: { url: payload.url },
				}),
				syncAppBadge(),
			]);
		})(),
	);
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const target = new URL(event.notification.data?.url || "/inbox", self.location.origin).href;
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			for (const client of windows) {
				if (client.url.startsWith(self.location.origin)) {
					await client.focus();
					await client.navigate(target);
					return;
				}
			}
			await self.clients.openWindow(target);
		})(),
	);
});
