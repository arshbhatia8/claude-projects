// Money is always stored and summed as whole paise (₹1 = 100 paise) in plain
// integers. Integers are exact up to 9e15, so totals never pick up the
// floating-point drift you would get from adding 0.1 + 0.2 rupees.

export const MAX_PAISE = 1e15; // ₹10 lakh crore — far above any personal figure

/** Parse user text such as "1,250.5", "₹60" or "Rs. 99.99" into paise. Returns null if invalid. */
export function parseAmount(input) {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input >= 0 ? input : null; // already paise
  }
  const s = String(input ?? '')
    .trim()
    .replace(/^(?:₹|rs\.?|inr)\s*/i, '')
    .replace(/[,\s]/g, '');
  const m = /^(\d{1,13})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0'));
}

/** Paise → text for an <input> ("1250.50" style, no grouping). */
export function toInputValue(paise) {
  if (paise === null || paise === undefined || paise === '') return '';
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${paise < 0 ? '-' : ''}${rupees}${rest ? '.' + String(rest).padStart(2, '0') : ''}`;
}

const grouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * Format paise as Indian Rupees: ₹1,23,456.50
 * options.compact → ₹1.2L / ₹3.4Cr / ₹12.5K ; options.sign → always show + / −
 */
export function formatINR(paise, { compact = false, sign = false } = {}) {
  const value = Number(paise) || 0;
  const neg = value < 0;
  const abs = Math.abs(value);
  let body;
  if (compact && abs >= 100000) {
    const rupees = abs / 100;
    const [div, unit] = rupees >= 1e7 ? [1e7, 'Cr'] : rupees >= 1e5 ? [1e5, 'L'] : [1e3, 'K'];
    body = `${+(rupees / div).toFixed(rupees / div >= 100 ? 0 : 1)}${unit}`;
  } else {
    const rupees = Math.trunc(abs / 100);
    const rest = abs % 100;
    body = grouping.format(rupees) + (rest ? '.' + String(rest).padStart(2, '0') : '');
  }
  const prefix = neg ? '−' : sign && value > 0 ? '+' : '';
  return `${prefix}₹${body}`;
}

export const MASK = '₹••••••';

/** Percentage helper that refuses to divide by zero. */
export function percent(part, whole) {
  if (!whole) return null;
  return (part / whole) * 100;
}

export function sum(list, pick = (x) => x) {
  let total = 0;
  for (const item of list) total += pick(item);
  return total;
}
