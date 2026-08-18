/** ₹ + en-IN grouping, matching the prototype's inr() helper. */
export function inr(n: number): string {
  return '₹' + Number(n).toLocaleString('en-IN');
}

/** Compact number grouping without the currency symbol. */
export function group(n: number): string {
  return Number(n).toLocaleString('en-IN');
}
