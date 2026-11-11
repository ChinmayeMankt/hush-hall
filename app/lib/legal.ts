// Version of the house rules / terms / privacy text people accept at sign-up.
// Bump this when the text in app/rules/page.tsx changes in a meaningful way.
export const TERMS_VERSION = "2026-11-11-draft"; // draft until reviewed before public launch

// Age check used by the sign-up form and re-checked on the server.
// Returns whole years between a YYYY-MM-DD birth date and today (local calendar).
export function ageOn(birth: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth); // strict date format from <input type="date">
  if (!m) return null; // not a date
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]; // parts
  const b = new Date(Date.UTC(y, mo - 1, d)); // as UTC midnight
  if (b.getUTCFullYear() !== y || b.getUTCMonth() !== mo - 1 || b.getUTCDate() !== d) return null; // e.g. 31 Feb
  let age = today.getFullYear() - y; // rough years
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--; // birthday not reached yet this year
  return age >= 0 && age < 130 ? age : null; // sanity range
}

// Privacy contact and the date the privacy policy (app/privacy/page.tsx) last changed.
export const PRIVACY_CONTACT = "mankataliachinmaye@gmail.com"; // developer contact already used in the docs
export const PRIVACY_UPDATED = "11 November 2026"; // shown at the top of /privacy

export const MIN_AGE = 18; // decision: Hush Hall is 18+ (DPDP Act 2023 treats under-18s as children)
