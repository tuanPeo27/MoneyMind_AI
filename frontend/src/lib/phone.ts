/**
 * Phone number rules, identical to backend/Helpers/PhoneNumberRules.cs (the backend has the final say).
 * Spaces, dots, dashes and parentheses are ignored. Accepted: Vietnamese mobile 0[35789]xxxxxxxx (also +84 / 84),
 * Vietnamese landline 02xxxxxxxxx, or another country in E.164 form (+ country code, 8-15 digits).
 */
const SEPARATORS = /[\s.\-()]/g;
const VN_MOBILE = /^0[35789]\d{8}$/;
const VN_LANDLINE = /^02\d{9}$/;
const INTERNATIONAL = /^\+[1-9]\d{7,14}$/;

/** Canonical form (Vietnamese numbers as 0xxxxxxxxx, others as +xxxxxxxx), or null when the number is invalid. */
export function normalizePhone(value: string): string | null {
  let compact = value.trim().replace(SEPARATORS, '');
  if (!compact) return null;
  if (compact.startsWith('+84')) compact = '0' + compact.slice(3);
  else if (compact.startsWith('0084')) compact = '0' + compact.slice(4);
  else if (compact.startsWith('84') && compact.length === 11) compact = '0' + compact.slice(2);
  if (VN_MOBILE.test(compact) || VN_LANDLINE.test(compact)) return compact;
  return INTERNATIONAL.test(compact) && !compact.startsWith('+84') ? compact : null;
}

/** Characters a phone number may contain while typing; anything else (letters, symbols) is never valid. */
export const hasInvalidPhoneChars = (value: string) => /[^\d+\s.\-()]/.test(value);

/** Readable grouping for Vietnamese numbers: 0901 234 567 / 024 3826 1234. Others are returned unchanged. */
export function formatPhone(value: string): string {
  if (VN_MOBILE.test(value)) return `${value.slice(0, 4)} ${value.slice(4, 7)} ${value.slice(7)}`;
  if (VN_LANDLINE.test(value)) return `${value.slice(0, 3)} ${value.slice(3, 7)} ${value.slice(7)}`;
  return value;
}
