"use client";

import { MessageSplitLayout } from "@/components/messages/message-split-layout";
import { allInboxesFolderConfig } from "@/components/messages/message-folder-configs";

export default function AllInboxesLayout({ children }: { children: React.ReactNode }) {
	return <MessageSplitLayout config={allInboxesFolderConfig}>{children}</MessageSplitLayout>;
}
