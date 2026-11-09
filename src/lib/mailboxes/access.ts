import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { domains, mailboxAccess, mailboxes, users } from "@/db/schema";
import { getAccountStatus } from "@/lib/accounts/deletion-utils";
import type { SessionUser } from "@/lib/auth/types";
import { isTeamMailboxSharingEnabled } from "./access-utils";
import type { MailboxAccessLevel, MailboxPermission } from "./types";

const permissionRank: Record<MailboxPermission, number> = {
	read_only: 1,
	send_on_behalf: 2,
	send_as: 3,
	full_access: 4,
};

export function hasMailboxPermission(permission: MailboxPermission, required: MailboxPermission): boolean {
	return permissionRank[permission] >= permissionRank[required];
}

/**
 * `adminView` is passed only by read-only code paths (showing a message, its thread,
 * attachments or source). There the primary admin may view any mailbox, which is what
 * the unified inbox uses. Every other caller leaves it off, so the admin can never
 * change, move, mark or send from someone else's mailbox through this access.
 */
export async function getMailboxAccessLevel(
	db: AppDatabase,
	user: Pick<SessionUser, "id" | "role"> & { isPrimaryAdmin?: boolean },
	mailboxId: string,
	options: { adminView?: boolean } = {},
): Promise<MailboxAccessLevel | null> {
	const [mailbox] = await db.select().from(mailboxes).where(eq(mailboxes.id, mailboxId)).limit(1);
	if (!mailbox || mailbox.disabled) return null;

	const isOwner = mailbox.userId === user.id;
	if (isOwner) return buildAccess(mailbox, "full_access", true);

	if (mailbox.type === "shared" && (await isTeamMailboxSharingEnabled(db))) {
		const [delegatedAccess] = await db
			.select({ permission: mailboxAccess.permission })
			.from(mailboxAccess)
			.where(and(eq(mailboxAccess.mailboxId, mailbox.id), eq(mailboxAccess.userId, user.id)))
			.limit(1);
		if (delegatedAccess) return buildAccess(mailbox, delegatedAccess.permission, false);
	}

	if (options.adminView && user.role === "admin" && user.isPrimaryAdmin) {
		return { ...buildAccess(mailbox, "read_only", false), adminView: true };
	}
	return null;
}

/** Every active mailbox on the installation, for the primary admin's unified inbox. */
export async function listAllMailboxesForAdmin(db: AppDatabase) {
	return db
		.select({ id: mailboxes.id, localPart: mailboxes.localPart, displayName: mailboxes.displayName, hostname: domains.hostname })
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(eq(mailboxes.disabled, false));
}

export async function listAccessibleMailboxes(db: AppDatabase, user: Pick<SessionUser, "id" | "email" | "role">) {
	const ownedRows = await db
		.select({
			id: mailboxes.id,
			userId: mailboxes.userId,
			domainId: mailboxes.domainId,
		localPart: mailboxes.localPart,
		displayName: mailboxes.displayName,
		signature: mailboxes.signature,
		autoReplyEnabled: mailboxes.autoReplyEnabled,
		autoReplySubject: mailboxes.autoReplySubject,
		autoReplyBody: mailboxes.autoReplyBody,
		useAllDomains: mailboxes.useAllDomains,
			avatarKey: mailboxes.avatarKey,
			type: mailboxes.type,
			disabled: mailboxes.disabled,
			createdAt: mailboxes.createdAt,
			hostname: domains.hostname,
			ownerLastSignInAt: users.lastSignInAt,
			ownerDisabled: users.disabled,
			ownerDeletedAt: users.deletedAt,
		})
		.from(mailboxes)
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.leftJoin(users, eq(mailboxes.userId, users.id))
		.where(and(eq(mailboxes.userId, user.id), eq(mailboxes.disabled, false)));
	const owned = ownedRows
		.map((row) => {
			const { avatarKey, ownerLastSignInAt, ownerDisabled, ownerDeletedAt, ...mailbox } = row;
			return {
				...mailbox,
				hasAvatar: !!avatarKey,
				status: row.type === "shared" ? "active" as const : getAccountStatus({ disabled: !!ownerDisabled, deletedAt: ownerDeletedAt }),
				lastSignInAt: row.type === "shared" ? null : ownerLastSignInAt ?? null,
				permission: "full_access" as MailboxPermission,
				isPrimary: `${row.localPart}@${row.hostname}` === user.email,
			};
		});

	if (!(await isTeamMailboxSharingEnabled(db))) return owned;
	const sharedRows = await db
		.select({
			id: mailboxes.id,
			userId: mailboxes.userId,
			domainId: mailboxes.domainId,
		localPart: mailboxes.localPart,
		displayName: mailboxes.displayName,
		signature: mailboxes.signature,
		autoReplyEnabled: mailboxes.autoReplyEnabled,
		autoReplySubject: mailboxes.autoReplySubject,
		autoReplyBody: mailboxes.autoReplyBody,
		useAllDomains: mailboxes.useAllDomains,
			avatarKey: mailboxes.avatarKey,
			type: mailboxes.type,
			disabled: mailboxes.disabled,
			createdAt: mailboxes.createdAt,
			hostname: domains.hostname,
			permission: mailboxAccess.permission,
		})
		.from(mailboxAccess)
		.innerJoin(mailboxes, eq(mailboxAccess.mailboxId, mailboxes.id))
		.innerJoin(domains, eq(mailboxes.domainId, domains.id))
		.where(
			and(
				eq(mailboxAccess.userId, user.id),
				eq(mailboxes.type, "shared"),
				eq(mailboxes.disabled, false),
			),
		);
	const shared = sharedRows.map((row) => {
		const { avatarKey, ...mailbox } = row;
		return {
			...mailbox,
			hasAvatar: !!avatarKey,
			status: "active" as const,
			lastSignInAt: null,
			isPrimary: false,
		};
	});

	return [...owned, ...shared];
}

export async function listAccessibleMailboxIds(db: AppDatabase, user: Pick<SessionUser, "id" | "email" | "role">) {
	const rows = await listAccessibleMailboxes(db, user);
	return rows.map((row) => row.id);
}

function buildAccess(
	mailbox: MailboxAccessLevel["mailbox"],
	permission: MailboxPermission,
	isOwner: boolean,
): MailboxAccessLevel {
	return {
		mailbox,
		permission,
		isOwner,
		canRead: hasMailboxPermission(permission, "read_only"),
		canSendAs: hasMailboxPermission(permission, "send_as"),
		canSendOnBehalf: hasMailboxPermission(permission, "send_on_behalf"),
		canManage: hasMailboxPermission(permission, "full_access"),
	};
}
