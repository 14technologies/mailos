import { defaultTranslator, type Translator } from "@/lib/i18n/utils";
import { Building2, Sparkles } from "@/components/icons";
import type { LicensePlan } from "./types";
import { authFetch } from "@/lib/auth/client";
import { formatUserDate } from "@/lib/time/utils";
import { LICENSE_STATUS_CHANGED_EVENT } from "@/lib/licenses/constants";
import { checkoutUrlFor, MAILOS_PLANS } from "@/lib/licenses/mailos-plans";
import type { ActivatableLicensePlan, LicenseAction, LicenseResponse } from "./types";

export const LICENSE_PLANS: LicensePlan[] = [
	{
		name: MAILOS_PLANS.pro.name,
		descriptionKey: "licenses.pro.description",
		featureKeys: ["licenses.pro.feature1", "licenses.pro.feature2", "licenses.pro.feature3", "licenses.pro.feature4", "licenses.keepVersion"],
		icon: Sparkles,
		checkoutUrl: checkoutUrlFor("pro"),
	},
	{
		name: MAILOS_PLANS.team.name,
		descriptionKey: "licenses.team.description",
		featureKeys: ["licenses.team.feature1", "licenses.team.feature2", "licenses.team.feature3", "licenses.team.feature4", "licenses.keepVersion"],
		icon: Building2,
		checkoutUrl: checkoutUrlFor("team"),
	},
];

export async function loadLicenseStatus(): Promise<NonNullable<LicenseResponse["license"]>> {
	const response = await authFetch("/api/licenses");
	const data = (await response.json()) as LicenseResponse;
	if (!response.ok || !data.license) throw new Error(data.error ?? defaultTranslator("licenses.loadFailed"));
	return data.license;
}

export async function runLicenseAction(
	action: LicenseAction,
	licenseKey: string,
	plan?: ActivatableLicensePlan,
): Promise<NonNullable<LicenseResponse["license"]>> {
	const response = await authFetch(`/api/licenses/${action}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ licenseKey, ...(plan ? { plan } : {}) }),
	});
	const data = (await response.json()) as LicenseResponse;
	if (!response.ok || !data.license) throw new Error(data.error ?? defaultTranslator("licenses.requestFailed"));
	window.dispatchEvent(new Event(LICENSE_STATUS_CHANGED_EVENT));
	return data.license;
}

export function formatLicensePlan(plan: string, t: Translator = defaultTranslator): string {
	return plan === "team" ? MAILOS_PLANS.team.name : plan === "pro" ? MAILOS_PLANS.pro.name : t("licenses.communityPlan");
}

export function formatLicenseDate(value: Date | string | null): string | null {
	if (!value) return null;
	return formatUserDate(value, { dateStyle: "medium", timeStyle: "short" });
}
