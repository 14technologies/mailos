import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "MailOS by 14 Technologies",
		short_name: "MailOS",
		description: "Business email by 14 Technologies.",
		id: "/",
		scope: "/",
		start_url: "/inbox",
		display: "fullscreen",
		// Browsers without full-screen support fall back to an app window without browser bars.
		display_override: ["fullscreen", "standalone"],
		background_color: "#0b0d10",
		theme_color: "#0e1013",
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
	};
}
