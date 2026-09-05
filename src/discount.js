/* Discount Margin Guard — will this sale survive contact with your costs?
 *
 * Built on the same engine as the margin audit: money is an integer count of
 * cents throughout, and an unknown cost stays unknown rather than becoming a
 * free product with a flattering margin.
 *
 * The arithmetic is checked against a real merchant's worked example, from
 * Shopify Community thread 675541 (1-2 September 2026):
 *
 *   "$40 price, $23 cost. Break-even at 42.5% off. A 25% code stacked on a 20%
 *    automatic discount is 40% off, leaving $1 per unit."
 *
 * This module reproduces all three of those figures exactly, and there is a
 * test that fails if it ever stops doing so. That thread is the specification.
 */

import { MONEY_UNKNOWN, margin } from './audit.js';

/* ---------- stacking ---------------------------------------------------- */

/** How Shopify combines two percentage discounts: on the already-reduced price.
 *
 * 25% then 20% is not 45% off, it is 40% — 0.75 x 0.80 = 0.60 remaining. That
 * is *less* damaging than merchants fear, and it still took the thread's
 * example to $1 a unit, which is the point: the intuition people reach for is
 * wrong in both directions, so it has to be computed.
 */
export function combinedDiscount(percents) {
  let remaining = 1;
  for (const p of percents) {
    const frac = Number(p) / 100;
    if (!(frac >= 0) || frac >= 1) continue;
    remaining *= (1 - frac);
  }
  return 1 - remaining;
}

/* ---------- the two numbers that matter --------------------------------- */

/** The discount at which this product earns exactly nothing.
 *
 * At discount d the price is p(1-d); that equals cost when d = 1 - c/p, which
 * is the same figure as the product's margin. Returns null when either side is
 * unknown — never 0, which would read as "any discount loses money".
 */
export function breakEvenDiscount(priceMinor, costMinor) {
  const m = margin(priceMinor, costMinor);
  return m === null ? null : m;
}

/** The deepest discount that still holds a target margin.
 *
 *   price(1-d) - cost >= t * price(1-d)
 *   (1-d) >= cost / (price * (1-t))
 *   d     <= 1 - cost / (price * (1-t))
 *
 * Returns a negative number when the product cannot hold the target even at
 * full price — that is a real answer and it is left signed rather than clamped
 * to zero, because "you are already under target before discounting" is
 * different from "you may discount by nothing".
 */
export function maxDiscountForMargin(priceMinor, costMinor, targetMargin) {
  if (priceMinor === MONEY_UNKNOWN || costMinor === MONEY_UNKNOWN) return null;
  if (priceMinor <= 0) return null;
  if (!(targetMargin >= 0) || targetMargin >= 1) return null;
  return 1 - costMinor / (priceMinor * (1 - targetMargin));
}

/* ---------- the audit --------------------------------------------------- */

export const OUTCOME = {
  BELOW_COST: 'sells below cost',
  UNDER_TARGET: 'under target margin',
  THIN: 'thin but positive',
  FINE: 'fine',
  UNKNOWN: 'cannot tell',
};

const money = minor => minor / 100;

/**
 * Score a planned discount against a catalogue.
 *
 * `percents` is the list of discounts a merchant intends to allow to combine —
 * a 25% code and a 20% automatic discount is [25, 20], not [45].
 */
export function auditDiscount(rows, percents, opts = {}) {
  const target = opts.targetMargin ?? 0.30;
  const stack = combinedDiscount(percents);
  const findings = [];

  for (const r of rows) {
    const label = [r.title, r.variant].filter(Boolean).join(' — ') || r.sku || `line ${r.line}`;

    if (r.price === MONEY_UNKNOWN || r.price <= 0) continue;

    if (r.cost === MONEY_UNKNOWN) {
      findings.push({
        sku: r.sku, label, line: r.line, outcome: OUTCOME.UNKNOWN,
        price: money(r.price), cost: null,
        discountedPrice: money(Math.round(r.price * (1 - stack))),
        unitProfit: null, breakEven: null, maxDiscount: null,
        detail: 'No cost recorded, so there is no way to tell whether this '
              + 'discount is survivable. It is excluded from the totals rather '
              + 'than assumed safe.',
      });
      continue;
    }

    // Integer cents throughout; the discounted price is what the customer pays.
    const discounted = Math.round(r.price * (1 - stack));
    const unitProfit = discounted - r.cost;
    const be = breakEvenDiscount(r.price, r.cost);
    const maxD = maxDiscountForMargin(r.price, r.cost, target);
    const marginAfter = margin(discounted, r.cost);

    let outcome;
    if (unitProfit < 0) outcome = OUTCOME.BELOW_COST;
    else if (marginAfter !== null && marginAfter < target) outcome = OUTCOME.UNDER_TARGET;
    else if (marginAfter !== null && marginAfter < target + 0.05) outcome = OUTCOME.THIN;
    else outcome = OUTCOME.FINE;

    findings.push({
      sku: r.sku, label, line: r.line, outcome,
      price: money(r.price), cost: money(r.cost),
      discountedPrice: money(discounted),
      unitProfit: money(unitProfit),
      marginAfter,
      breakEven: be,
      maxDiscount: maxD,
      detail: outcome === OUTCOME.BELOW_COST
        ? `At ${(stack * 100).toFixed(1)}% off this sells for ${money(discounted).toFixed(2)} `
          + `against a cost of ${money(r.cost).toFixed(2)} — a loss of `
          + `${Math.abs(money(unitProfit)).toFixed(2)} on every unit. `
          + `It breaks even at ${(be * 100).toFixed(1)}% off.`
        : `At ${(stack * 100).toFixed(1)}% off it earns ${money(unitProfit).toFixed(2)} a unit`
          + (marginAfter !== null ? ` (${(marginAfter * 100).toFixed(1)}% margin)` : '')
          + `. Break-even is ${(be * 100).toFixed(1)}% off`
          + (maxD !== null && maxD >= 0
             ? `; ${(maxD * 100).toFixed(1)}% is the deepest that still holds ${(target * 100).toFixed(0)}%.`
             : '.'),
    });
  }

  // Worst first: real losses, by size, then everything else.
  const rank = { [OUTCOME.BELOW_COST]: 0, [OUTCOME.UNDER_TARGET]: 1,
                 [OUTCOME.THIN]: 2, [OUTCOME.UNKNOWN]: 3, [OUTCOME.FINE]: 4 };
  findings.sort((a, b) => {
    if (rank[a.outcome] !== rank[b.outcome]) return rank[a.outcome] - rank[b.outcome];
    if (a.unitProfit === null || b.unitProfit === null) return 0;
    return a.unitProfit - b.unitProfit;
  });

  return { stack, findings, summary: summariseDiscount(findings, stack, target) };
}

export function summariseDiscount(findings, stack, target) {
  const count = o => findings.filter(f => f.outcome === o).length;
  const losing = findings.filter(f => f.outcome === OUTCOME.BELOW_COST);
  // Per unit, and labelled as such. A product export carries no sales volume,
  // so any total loss figure would be invented.
  const worstUnit = losing.length
    ? Math.min(...losing.map(f => f.unitProfit)) : null;

  return {
    stackPercent: stack * 100,
    products: findings.length,
    belowCost: count(OUTCOME.BELOW_COST),
    underTarget: count(OUTCOME.UNDER_TARGET),
    thin: count(OUTCOME.THIN),
    fine: count(OUTCOME.FINE),
    unknown: count(OUTCOME.UNKNOWN),
    worstUnitLoss: worstUnit,
    targetMargin: target,
    safeCeiling: safeCeiling(findings),
  };
}

/** The deepest discount that keeps EVERY priced product above cost.
 *
 * Deliberately the minimum across products rather than an average: a site-wide
 * discount is only as safe as the thinnest product it touches.
 */
export function safeCeiling(findings) {
  const bes = findings.map(f => f.breakEven).filter(b => b !== null && b >= 0);
  return bes.length ? Math.min(...bes) : null;
}
