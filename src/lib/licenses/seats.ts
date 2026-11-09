import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { domains, mailboxes, users } from "@/db/schema";
import { getLicenseEntitlements } from "./service";
import { FREE_DOMAIN_LIMIT, FREE_DRIVE_BYTES, FREE_MAILBOX_LIMIT, MAILOS_PLANS } from "./mailos-plans";

/** Enabled accounts occupy a seat; the primary admin is one of them. */
export async function countUsedAccountSeats(env: CloudflareEnv): Promise<number> {
	const [row] = await getDb(env).select({ total: count() }).from(users).where(eq(users.disabled, false));
	return row?.total ?? 0;
}

/** Returns an error message when no seat is free for one more enabled account, otherwise null. */
export async function getAccountSeatError(env: CloudflareEnv): Promise<string | null> {
	const { accountSeatLimit } = await getLicenseEntitlements(env);
	if (accountSeatLimit === null) return null;
	const used = await countUsedAccountSeats(env);
	return used >= accountSeatLimit
		? `All ${accountSeatLimit} account seats of this license are in use. Disable an account or add seats to your license`
		: null;
}

/** Domains allowed by the active plan: 1 free, 3 with Pro, unlimited with Team. */
export async function getDomainLimitError(env: CloudflareEnv): Promise<string | null> {
	const { plan } = await getLicenseEntitlements(env);
	const limit = plan === "pro" ? MAILOS_PLANS.pro.domains : plan === "team" ? MAILOS_PLANS.team.domains : FREE_DOMAIN_LIMIT;
	if (limit === null) return null;
	const [row] = await getDb(env).select({ total: count() }).from(domains);
	return (row?.total ?? 0) >= limit
		? `Your plan includes ${limit} domain${limit === 1 ? "" : "s"}. Upgrade to MailOS Pro or Team on 14technologies.com (Admin → Upgrade) to add more.`
		: null;
}

/** Drive storage per person allowed by the plan: 1 GB free, 25 GB Pro, 100 GB Team. */
export async function getPlanDriveBytes(env: CloudflareEnv): Promise<number> {
	const { plan } = await getLicenseEntitlements(env);
	return plan === "pro" ? MAILOS_PLANS.pro.driveBytes : plan === "team" ? MAILOS_PLANS.team.driveBytes : FREE_DRIVE_BYTES;
}

/** Mailboxes allowed by the active plan: 10 free, more with MailOS Pro, unlimited with Team. */
export async function getMailboxLimit(env: CloudflareEnv): Promise<number | null> {
	const { plan } = await getLicenseEntitlements(env);
	if (plan === "pro") return MAILOS_PLANS.pro.mailboxes;
	if (plan === "team") return MAILOS_PLANS.team.mailboxes;
	return FREE_MAILBOX_LIMIT;
}

/** Returns an error message when one more mailbox would exceed the plan, otherwise null. */
export async function getMailboxLimitError(env: CloudflareEnv): Promise<string | null> {
	const limit = await getMailboxLimit(env);
	if (limit === null) return null;
	const [row] = await getDb(env).select({ total: count() }).from(mailboxes);
	return (row?.total ?? 0) >= limit
		? `Your plan includes ${limit} mailboxes and all are in use. Upgrade to MailOS Pro or Team on 14technologies.com (Admin → Upgrade) to add more.`
		: null;
}
