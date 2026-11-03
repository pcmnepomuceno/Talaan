// Philippine time (Asia/Manila, UTC+08:00, no DST) for the interview time input. Interviews are
// entered and shown in PHT only, whatever zone the browser is in, so nothing here may read the
// device zone: no local getters, no Date parsing of zone-less strings. A <input type="datetime-local">
// value is a zone-less "YYYY-MM-DDTHH:mm"; it is rebuilt as a string with "+08:00", never run through Date.
import { parse } from "./format";

const OFFSET_MS = 8 * 60 * 60 * 1000;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** API instant (UTC or any offset) -> "YYYY-MM-DDTHH:mm" in PHT, for the input. null if empty, date-only or invalid. */
export function toPhtInput(value: string | null | undefined): string | null {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const p = parse(value);
  if (!p) return null;
  const d = new Date(p.date.getTime() + OFFSET_MS); // shifted so the UTC getters read Manila wall time
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Input value read as PHT -> "YYYY-MM-DDTHH:mm:00+08:00" (seconds dropped). null if empty or not a real date and time. */
export function fromPhtInput(local: string | null | undefined): string | null {
  const m = local ? LOCAL.exec(local) : null;
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  const s = m[6] === undefined ? 0 : Number(m[6]);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // A UTC round trip rejects Feb 30, month 13, hour 24 (Date.UTC rolls them over).
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+08:00`;
}

/** The API accepts years 1900-2200 in the offset that was sent (here +08:00, so the PHT year). */
export const phtYearOk = (local: string) => {
  const y = Number(local.slice(0, 4));
  return y >= 1900 && y <= 2200;
};
