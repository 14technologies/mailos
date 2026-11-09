"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { CalendarDays, HardDrive, Inbox, MailPlus, Menu } from "@/components/icons";
import type { LucideIcon } from "@/components/icons";
import { useCompose } from "@/components/compose/compose-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { useLanguage } from "./language-provider";
import { useSidebar } from "./sidebar-state";

type TabProps = {
	href: string;
	label: string;
	icon: LucideIcon;
	active: boolean;
	badge?: number;
};

function Tab({ href, label, icon: Icon, active, badge }: TabProps) {
	return (
		<Link
			href={href}
			aria-current={active ? "page" : undefined}
			className={clsx("relative z-10 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-300", active ? "text-blue-700" : "text-neutral-500")}
		>
			<span className="mailos-tab-icon relative flex h-8 w-14 items-center justify-center rounded-full">
				<Icon size={21} />
				{!!badge && badge > 0 && (
					<span key={badge} className="mailos-badge-pop absolute -top-1 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold leading-none text-white">
						{badge > 99 ? "99+" : badge}
					</span>
				)}
			</span>
			{label}
		</Link>
	);
}

/**
 * Phone navigation: Mail, Calendar, Compose, Drive and Menu at the bottom of the screen, where thumbs
 * reach. Menu opens the section's full menu (folders, settings…). Hidden from tablet width up.
 * `composeHref` is for sections without the pop-up composer: Compose then opens the compose page.
 */
export function MobileBottomNav({ composeHref }: { composeHref?: string }) {
	const { t } = useLanguage();
	const pathname = usePathname() ?? "";
	const { toggle, mobileOpen } = useSidebar();
	const { openComposer, open: composing } = useCompose();
	const user = useCurrentUser();
	// Same count as the menu's Inbox: the selected mailbox.
	const { selectedMailbox, isLoading } = useSelectedMailbox();
	const { counts } = useMessageCounts(selectedMailbox?.id, !isLoading);

	const inCalendar = pathname.startsWith("/calendar") || pathname.startsWith("/booking");
	const inDrive = pathname.startsWith("/drive");
	const inMail = !inCalendar && !inDrive;
	const unread = counts.folders.inbox?.unread ?? 0;
	// Tab order: Mail, Calendar, Compose, Drive, Menu. The open menu takes the highlight.
	const activeIndex = mobileOpen ? 4 : inCalendar ? 1 : inDrive ? 3 : inMail ? 0 : -1;

	const [typing, setTyping] = useState(false);
	const hidden = composing || typing;

	// Floating buttons (New event, install banner, uploads) read this to sit above the bar on phones.
	useEffect(() => {
		const root = document.documentElement;
		root.style.setProperty("--bottom-nav", hidden ? "0px" : "calc(4rem + env(safe-area-inset-bottom))");
		return () => {
			root.style.removeProperty("--bottom-nav");
		};
	}, [hidden]);

	useEffect(() => {
		const isField = (element: Element | null) =>
			!!element && (element instanceof HTMLTextAreaElement || (element as HTMLElement).isContentEditable
				|| (element instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range", "color", "file"].includes(element.type)));
		const update = () => setTyping(isField(document.activeElement));
		const later = () => requestAnimationFrame(update);
		document.addEventListener("focusin", update);
		document.addEventListener("focusout", later);
		return () => {
			document.removeEventListener("focusin", update);
			document.removeEventListener("focusout", later);
		};
	}, []);

	// The phone composer covers the screen, and while typing the keyboard needs the space;
	// the bar comes back when either ends.
	if (hidden) return null;

	const composeClass = "mailos-compose-fab relative z-10 mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-950 shadow-sm";
	return (
		<nav
			aria-label={t("bottomNav.label")}
			className="shrink-0 border-t border-neutral-200 bg-white md:hidden"
			style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
		>
			<div className="relative grid h-16 grid-cols-5 items-center">
				{activeIndex >= 0 && (
					<span aria-hidden="true" className="mailos-tab-indicator pointer-events-none absolute left-0 top-[7px] flex h-8 w-1/5 justify-center" style={{ transform: `translateX(${activeIndex * 100}%)` }}>
						<span className="h-8 w-14 rounded-full bg-blue-50" />
					</span>
				)}
				<Tab href="/inbox" label={t("bottomNav.mail")} icon={Inbox} active={inMail} badge={unread} />
				{user?.calendarEnabled === false ? <span /> : <Tab href="/calendar" label={t("bottomNav.calendar")} icon={CalendarDays} active={inCalendar} />}
				{composeHref ? (
					<Link href={composeHref} aria-label={t("navigation.compose")} className={composeClass}><MailPlus size={22} /></Link>
				) : (
					<button type="button" onClick={openComposer} aria-label={t("navigation.compose")} className={composeClass}><MailPlus size={22} /></button>
				)}
				{user?.driveEnabled === false ? <span /> : <Tab href="/drive" label={t("bottomNav.drive")} icon={HardDrive} active={inDrive} />}
				<button
					type="button"
					onClick={toggle}
					aria-expanded={mobileOpen}
					data-active={mobileOpen ? "true" : undefined}
					className={clsx("relative z-10 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors duration-300", mobileOpen ? "text-blue-700" : "text-neutral-500")}
				>
					<span className="mailos-tab-icon flex h-8 w-14 items-center justify-center rounded-full"><Menu size={21} /></span>
					{t("bottomNav.menu")}
				</button>
			</div>
		</nav>
	);
}
