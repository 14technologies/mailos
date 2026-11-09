"use client";

import { useEffect } from "react";

const INTERACTIVE = "button:not(:disabled), a[href], [role='button']:not([aria-disabled='true']), [role='menuitem']:not([aria-disabled='true']), [role='option'], [role='tab']";
const replayedAt = new WeakMap<HTMLElement, number>();

function animateAction(target: EventTarget | null) {
	if (!(target instanceof Element)) return;
	const control = target.closest<HTMLElement>(INTERACTIVE);
	if (!control || control.hasAttribute("disabled") || control.dataset.noActionFeedback === "true") return;
	const now = performance.now();
	if (now - (replayedAt.get(control) ?? -Infinity) < 80) return;
	replayedAt.set(control, now);
	control.classList.remove("mailos-action-feedback");
	// Restart the short compositor animation on every activation, including rapid taps.
	void control.offsetWidth;
	control.classList.add("mailos-action-feedback");
	window.setTimeout(() => control.classList.remove("mailos-action-feedback"), 480);
}

export function ActionFeedback() {
	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			if (event.isPrimary && event.button === 0) animateAction(event.target);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (!event.repeat && (event.key === "Enter" || event.key === " ")) animateAction(event.target);
		};
		const onClick = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Element)) return;
			const control = target.closest<HTMLElement>(INTERACTIVE);
			if (control && performance.now() - (replayedAt.get(control) ?? -Infinity) > 350) animateAction(control);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		document.addEventListener("keydown", onKeyDown, true);
		document.addEventListener("click", onClick, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown, true);
			document.removeEventListener("keydown", onKeyDown, true);
			document.removeEventListener("click", onClick, true);
		};
	}, []);
	return null;
}
