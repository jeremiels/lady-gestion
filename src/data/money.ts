/**
 * Money is stored as an integer number of cents, never a float.
 *
 * `0.1 + 0.2 !== 0.3`, and a sum of a year's budget in floats drifts. Cents
 * also map straight onto a Postgres `bigint` / `numeric` column later.
 */

export const DEFAULT_CURRENCY = 'EUR';

/** `12.5` -> `1250`. Returns `null` for blank or non-numeric input. */
export const toCents = (amount: number | string | null | undefined): number | null => {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = typeof amount === 'string' ? Number(amount.replace(',', '.')) : amount;
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
};

/** `1250` -> `12.5`. */
export const fromCents = (cents: number): number => cents / 100;

const formatters = new Map<string, Intl.NumberFormat>();

const formatterFor = (currency: string): Intl.NumberFormat => {
  let formatter = formatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency });
    formatters.set(currency, formatter);
  }
  return formatter;
};

/** `1250` -> `12,50 €`. `null` -> `—`. */
export const formatCents = (
  cents: number | null,
  currency: string = DEFAULT_CURRENCY,
): string => (cents === null ? '—' : formatterFor(currency).format(fromCents(cents)));

export const sumCents = (amounts: (number | null)[]): number =>
  amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0);
