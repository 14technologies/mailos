import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, driveItems } from "@/db/schema";
import { getPlanDriveBytes } from "@/lib/licenses/seats";

/** Per-user Drive cap in bytes: the plan's allowance (1 GB Free, 25 GB Pro, 100 GB Team), or the
 * admin's lower setting on the General page. */
export async function getDriveStorageLimit(env: CloudflareEnv): Promise<number | null> {
	const [settings] = await getDb(env).select({ limit: appSettings.driveStorageLimitBytes }).from(appSettings).where(eq(appSettings.id, "default")).limit(1);
	const admin = settings?.limit && settings.limit > 0 ? settings.limit : null;
	const plan = await getPlanDriveBytes(env);
	return admin === null ? plan : Math.min(admin, plan);
}

export async function getDriveStorageUsed(db: ReturnType<typeof getDb>, ownerId: string): Promise<number> {
	const [usage] = await db.select({ total: sql<number>`coalesce(sum(${driveItems.size}), 0)` }).from(driveItems).where(eq(driveItems.ownerId, ownerId));
	return Number(usage?.total ?? 0);
}
