// MailOS plans are sold and licensed by 14technologies.com (Fourteen Store & Licensing).
// Prices, tiers (monthly / annual / lifetime …) and checkout live on that store;
// MailOS only links to it and verifies the signed license replies.

/** The store and license server. Override with the FOURTEEN_LICENSE_SERVER Worker variable. */
export const FOURTEEN_STORE_URL = "https://14technologies.com";

/** Mailboxes (addresses) an installation may have without a license. */
export const FREE_MAILBOX_LIMIT = 10;
/** Other Free limits: one domain, 1 GB Drive per person, no AI assistant. */
export const FREE_DOMAIN_LIMIT = 1;
export const FREE_DRIVE_BYTES = 1024 ** 3;
const GIB = 1024 ** 3;

export const MAILOS_PLANS = {
	pro: {
		name: "MailOS Pro",
		/** Product slug in Store → Products on 14technologies.com. Keep it fixed after launch. */
		product: "mailos-pro",
		/** Accounts (separate logins) a Pro license allows. */
		seats: 10,
		/** Mailboxes a Pro license allows. */
		mailboxes: 50,
		domains: 3,
		driveBytes: 25 * GIB,
	},
	team: {
		name: "MailOS Team",
		product: "mailos-team",
		/** null = unlimited accounts. */
		seats: null as number | null,
		/** null = unlimited mailboxes. */
		mailboxes: null as number | null,
		domains: null as number | null,
		driveBytes: 100 * GIB,
	},
} as const;

export type MailosPlan = keyof typeof MAILOS_PLANS;

/** The MailOS page on 14technologies.com; Pro and Team are priced together under #pricing. */
export function checkoutUrlFor(_plan: MailosPlan): string {
	return `${FOURTEEN_STORE_URL}/products/mailos/#pricing`;
}

export function planForProduct(product: unknown): MailosPlan | null {
	if (product === MAILOS_PLANS.pro.product) return "pro";
	if (product === MAILOS_PLANS.team.product) return "team";
	return null;
}
