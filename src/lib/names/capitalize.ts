/**
 * Names are shown and sent with each word starting in a capital letter
 * ("fariha jabeen" → "Fariha Jabeen"). The rest of each word is kept, so "CEO",
 * "HR" and "McDonald" stay as typed.
 */
export function capitalizeName(value: string): string;
export function capitalizeName(value: string | null | undefined): string | null | undefined;
export function capitalizeName(value: string | null | undefined) {
	if (typeof value !== "string") return value;
	return value.replace(/(^|[\s\-'.(])(\p{Ll})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase());
}
