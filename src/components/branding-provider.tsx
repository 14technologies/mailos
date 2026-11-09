"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Branding } from "@/lib/branding/types";
import type { BrandingContextValue } from "./branding-provider-types";
import { DEFAULT_BRANDING, fetchBranding } from "./branding-provider-utils";

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children, initialBranding }: { children: React.ReactNode; initialBranding?: Branding }) {
	const [branding, setBranding] = useState(initialBranding ?? DEFAULT_BRANDING);
	const [iconVersion, setIconVersion] = useState(0);

	async function refreshBranding() {
		const nextBranding = await fetchBranding();
		setBranding(nextBranding);
		setIconVersion(Date.now());
		if (document.title === "MailOS" || document.title === branding.appName) {
			document.title = nextBranding.appName;
		}
	}

	useEffect(() => {
		// The server layout already supplied the branding; refetching it on mount is
		// a second round trip that competes with the rest of the boot.
		if (!initialBranding) void refreshBranding();
	}, [initialBranding]);

	return (
		<BrandingContext.Provider value={{
			...branding,
			iconUrl: branding.hasCustomIcon ? `/api/branding/icon?v=${iconVersion}` : "/icon-96.png",
			refreshBranding,
		}}>
			{children}
		</BrandingContext.Provider>
	);
}

export function useBranding() {
	return useContext(BrandingContext) ?? {
		...DEFAULT_BRANDING,
		iconUrl: "/icon-96.png",
		refreshBranding: async () => undefined,
	};
}

export function BrandIcon({ width = 32, height = 32, alt = "", className = "" }: {
	width?: number;
	height?: number;
	alt?: string;
	className?: string;
}) {
	const branding = useBranding();
	if (branding.hasCustomIcon) {
		return <img src={branding.iconUrl} width={width} height={height} alt={alt} className={`block shrink-0 object-contain ${className}`} />;
	}
	return (
		<span
			role={alt ? "img" : undefined}
			aria-label={alt || undefined}
			aria-hidden={alt ? undefined : true}
			className={`block shrink-0 text-blue-600 ${className}`}
			style={{
				width,
				height,
				backgroundColor: "currentColor",
				maskImage: "url('/mailos-plane-mask.png')",
				maskPosition: "center",
				maskRepeat: "no-repeat",
				maskSize: "contain",
				WebkitMaskImage: "url('/mailos-plane-mask.png')",
				WebkitMaskPosition: "center",
				WebkitMaskRepeat: "no-repeat",
				WebkitMaskSize: "contain",
			}}
		/>
	);
}
