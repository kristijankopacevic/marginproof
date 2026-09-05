/* Discount Margin Guard tests.
 *
 * The first test is the specification: it reproduces the worked example a real
 * merchant posted in Shopify Community thread 675541 on 1-2 September 2026. If
 * that test ever fails, the tool disagrees with the people it was built for.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, toRows, MONEY_UNKNOWN } from '../src/audit.js';
import {
  combinedDiscount, breakEvenDiscount, maxDiscountForMargin,
  auditDiscount, safeCeiling, OUTCOME,
} from '../src/discount.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- the merchant's own example ---------------------------------- */

test("reproduces the merchant's worked example exactly", () => {
  // "$40 price, $23 cost. Break-even at 42.5% off. A 25% code stacked on a 20%
  //  automatic discount is 40% off, leaving $1 per unit."
  const stack = combinedDiscount([25, 20]);
  assert.ok(near(stack, 0.40), `stacked discount should be 40%, got ${stack * 100}%`);

  assert.ok(near(breakEvenDiscount(4000, 2300), 0.425), 'break-even should be 42.5%');

  const { findings } = auditDiscount(
    toRows(parseCsv('Title,Price,Cost per item\nWidget,40.00,23.00\n')).rows,
    [25, 20], { targetMargin: 0.30 });
  assert.equal(findings[0].discountedPrice, 24);
  assert.equal(findings[0].unitProfit, 1, 'the thread says $1 a unit');
});

/* ---------- stacking ---------------------------------------------------- */

test('percentage discounts combine on the reduced price, not additively', () => {
  assert.ok(near(combinedDiscount([25, 20]), 0.40));   // not 0.45
  assert.ok(near(combinedDiscount([50, 50]), 0.75));   // not 1.00 — never free
  assert.equal(combinedDiscount([]), 0);
  assert.equal(combinedDiscount([0]), 0);
});

test('a nonsensical discount is ignored rather than making things free', () => {
  assert.equal(combinedDiscount([100]), 0, '100% off is not modelled as a giveaway');
  assert.equal(combinedDiscount([-10]), 0);
  assert.ok(near(combinedDiscount([25, 'x', 20]), 0.40), 'junk entries are skipped');
});

/* ---------- the two numbers --------------------------------------------- */

test('break-even discount equals the margin', () => {
  assert.ok(near(breakEvenDiscount(4000, 2300), 0.425));
  assert.ok(near(breakEvenDiscount(1000, 500), 0.5));
  assert.equal(breakEvenDiscount(1000, MONEY_UNKNOWN), null, 'unknown, never 0');
  assert.equal(breakEvenDiscount(0, 500), null);
});

test('the ceiling that still holds a target margin', () => {
  // 40.00 price, 23.00 cost, hold 30%: 1 - 23/(40*0.7) = 0.17857...
  const d = maxDiscountForMargin(4000, 2300, 0.30);
  assert.ok(near(d, 1 - 2300 / (4000 * 0.7)));
  // and at that discount the margin is exactly the target
  const priced = 4000 * (1 - d);
  assert.ok(near((priced - 2300) / priced, 0.30, 1e-9));
});

test('a product already under target reports a negative ceiling, not zero', () => {
  const d = maxDiscountForMargin(1000, 900, 0.30);   // 10% margin, wants 30%
  assert.ok(d < 0, 'must not be clamped to 0 — "already under" is a different fact');
  assert.equal(maxDiscountForMargin(1000, MONEY_UNKNOWN, 0.3), null);
  assert.equal(maxDiscountForMargin(1000, 500, 1), null, 'a 100% target has no solution');
});

/* ---------- the audit --------------------------------------------------- */

const CATALOGUE =
  'Title,Variant SKU,Price,Cost per item\n'
  + 'Healthy,H1,100.00,20.00\n'      // 80% margin, survives anything sane
  + 'Thin,T1,10.00,8.00\n'           // 20% margin, dies quickly
  + 'Doomed,D1,10.00,9.50\n'         // 5% margin
  + 'NoCost,N1,50.00,\n';            // unknown

test('a deep stack finds the products that go under', () => {
  const { rows } = toRows(parseCsv(CATALOGUE));
  const { summary, findings } = auditDiscount(rows, [25, 20], { targetMargin: 0.30 });

  assert.ok(near(summary.stackPercent, 40));
  assert.equal(summary.belowCost, 2, 'Thin and Doomed both sell below cost at 40% off');
  assert.equal(summary.unknown, 1);
  assert.equal(findings[0].outcome, OUTCOME.BELOW_COST);
  assert.ok(findings[0].unitProfit < 0);
});

test('losses are reported per unit and never extrapolated to a total', () => {
  const { rows } = toRows(parseCsv(CATALOGUE));
  const { summary } = auditDiscount(rows, [25, 20]);
  assert.ok(summary.worstUnitLoss < 0);
  assert.equal(summary.totalLoss, undefined,
    'a product export has no sales volume, so no total may be claimed');
});

test('a product with no cost is "cannot tell", never "fine"', () => {
  const { rows } = toRows(parseCsv(CATALOGUE));
  const { findings } = auditDiscount(rows, [40]);
  const f = findings.find(x => x.sku === 'N1');
  assert.equal(f.outcome, OUTCOME.UNKNOWN);
  assert.equal(f.unitProfit, null);
  assert.equal(f.breakEven, null);
  assert.match(f.detail, /excluded from the totals rather than assumed safe/);
});

test('a modest discount leaves a healthy product alone', () => {
  const { rows } = toRows(parseCsv(CATALOGUE));
  const { findings } = auditDiscount(rows, [10], { targetMargin: 0.30 });
  const f = findings.find(x => x.sku === 'H1');
  assert.equal(f.outcome, OUTCOME.FINE);
  assert.equal(f.discountedPrice, 90);
  assert.equal(f.unitProfit, 70);
});

test('no discount at all still reports the break-even for planning', () => {
  const { rows } = toRows(parseCsv(CATALOGUE));
  const { summary, findings } = auditDiscount(rows, []);
  assert.equal(summary.stackPercent, 0);
  assert.equal(summary.belowCost, 0);
  const f = findings.find(x => x.sku === 'T1');
  assert.ok(near(f.breakEven, 0.2), 'still tells you where the cliff is');
});

/* ---------- the site-wide ceiling --------------------------------------- */

test('the safe ceiling is the thinnest product, not the average', () => {
  const { rows } = toRows(parseCsv(CATALOGUE));
  const { findings } = auditDiscount(rows, [10]);
  const ceiling = safeCeiling(findings);
  assert.ok(near(ceiling, 0.05), 'Doomed at 5% margin sets the limit for everyone');
});

test('with nothing priceable there is no ceiling, and it is null not zero', () => {
  const { rows } = toRows(parseCsv('Title,Price,Cost per item\nA,50.00,\n'));
  const { findings } = auditDiscount(rows, [10]);
  assert.equal(safeCeiling(findings), null);
});

test('an empty catalogue does not crash', () => {
  const { findings, summary } = auditDiscount([], [25, 20]);
  assert.equal(findings.length, 0);
  assert.equal(summary.belowCost, 0);
  assert.equal(summary.safeCeiling, null);
});
