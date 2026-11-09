"use client";

import { MessageFolderPage } from "@/components/messages/message-folder-page";
import { allInboxesFolderConfig } from "@/components/messages/message-folder-configs";

export default function AllInboxesPage() {
	return <MessageFolderPage config={allInboxesFolderConfig} />;
}
