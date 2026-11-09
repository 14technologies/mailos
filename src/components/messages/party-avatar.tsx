"use client";

import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { getManagedContactAvatarUrl } from "@/components/contacts/contact-avatar-utils";
import { getEmailAddress, splitEmailAddressList } from "@/lib/email/address";
import { cn } from "@/lib/utils";
import type { Message } from "@/hooks/types";

/** The person a list row is about: the sender of received mail, the first recipient of sent mail. */
export function getMessagePartyAddress(message: Pick<Message, "direction" | "fromAddr" | "toAddr">, folder: string): string {
	if (folder === "sent" || folder === "scheduled" || folder === "drafts" || message.direction === "outbound") {
		return getEmailAddress(splitEmailAddressList(message.toAddr ?? "")[0] ?? "");
	}
	return getEmailAddress(message.fromAddr ?? "");
}

/**
 * Small avatar for list rows and recipient chips: the profile picture when the
 * contact or mailbox has one (the request is cached, and a miss falls back), else a
 * coloured initial. It always asks for the picture so photos show everywhere.
 */
export function PartyAvatar({ mailboxId, address, name, className }: { mailboxId: string | null | undefined; address: string; name: string; className?: string }) {
	if (!address) return null;
	return (
		<ContactAvatar
			mailboxId={mailboxId ?? null}
			address={address}
			name={name}
			managedAvatarUrl={mailboxId ? getManagedContactAvatarUrl(mailboxId, address) : undefined}
			className={cn("h-7 w-7 text-[11px] transition-transform duration-200 group-hover:scale-105", className)}
		/>
	);
}
