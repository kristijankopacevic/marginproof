/* MarginProof audit tests — run with: node --test tests/
 *
 * The tests that matter most are the ones asserting that an unknown cost stays
 * unknown. Treating a missing cost as zero would invent a 100% margin and
 * reproduce, in reverse, the exact reporting defect this tool exists to expose.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCsv, parseNumber, detectColumns, detectPlatform, toRows,
  margin, auditRows, auditSupplierChange, summarise, MONEY_UNKNOWN,
  priceForMargin, auditCatalogueDrift, toMinor, fromMinor,
} from '../src/audit.js';

/* Money inside the engine is an integer count of cents. `parseNumber` still
 * returns a decimal (it also parses quantities), so money tests convert with
 * `toMinor` exactly as `toRows` does. */

/* ---------- parsing ---------------------------------------------------- */

test('csv parser handles quotes, embedded commas and escaped quotes', () => {
  const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n');
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"']]);
});

test('csv parser strips a BOM so the first header still matches', () => {
  const rows = parseCsv('﻿Title,Price\nCandle,10\n');
  assert.equal(rows[0][0], 'Title');
});

test('numbers parse in both european and anglo formats, with currency noise', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('$12.00'), 12);
  assert.equal(parseNumber('12,50 €'), 12.5);
  assert.equal(parseNumber('-3.5'), -3.5);
});

test('empty and junk values are unknown, never zero', () => {
  assert.equal(parseNumber(''), MONEY_UNKNOWN);
  assert.equal(parseNumber('   '), MONEY_UNKNOWN);
  assert.equal(parseNumber(undefined), MONEY_UNKNOWN);
  assert.equal(parseNumber('n/a'), MONEY_UNKNOWN);
  assert.notEqual(parseNumber(''), 0);
});

test('platform and columns are detected from real export headers', () => {
  const shopify = ['Handle', 'Title', 'Variant SKU', 'Variant Price', 'Cost per item'];
  assert.equal(detectPlatform(shopify), 'Shopify');
  const cols = detectColumns(shopify);
  assert.equal(cols.sku, 2);
  assert.equal(cols.price, 3);
  assert.equal(cols.cost, 4);

  const woo = ['Name', 'Regular price', 'post_status', '_wc_cog_cost'];
  assert.equal(detectPlatform(woo), 'WooCommerce');
});

/* ---------- the core rule ---------------------------------------------- */

test('UNKNOWN IS NOT ZERO: a missing cost yields no margin', () => {
  assert.equal(margin(1000, MONEY_UNKNOWN), null);
  assert.notEqual(margin(1000, MONEY_UNKNOWN), 1);   // would be "100% margin"
});

test('money is held as integer minor units, so decimals cannot drift', () => {
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor(0.1) + toMinor(0.2), 30, '0.1+0.2 is exact in cents');
  assert.equal(toMinor(MONEY_UNKNOWN), MONEY_UNKNOWN, 'unknown stays unknown');
  assert.equal(fromMinor(1999), 19.99);
  const { rows } = toRows(parseCsv('Title,Price,Cost per item\nA,19.99,8.10\n'));
  assert.equal(rows[0].price, 1999);
  assert.equal(rows[0].cost, 810);
  assert.equal(margin(1999, 810), (1999 - 810) / 1999);
});

test('a missing cost is reported as unknown, not as a free product', () => {
  const { rows } = toRows(parseCsv('Title,Price,Cost per item\nCandle,20,\n'));
  const findings = auditRows(rows);
  const f = findings.find(x => x.check === 'missing_cost');
  assert.ok(f, 'missing cost must be flagged');
  assert.equal(f.atStake, null, 'exposure is not calculable without a cost');
  assert.ok(/unknown/i.test(f.atStakeNote));
  assert.ok(!findings.some(x => x.check === 'below_target_margin'),
    'must not invent a margin verdict for a product with no cost');
});

test('a real zero cost is different from a missing cost', () => {
  const { rows } = toRows(parseCsv('Title,Price,Cost per item\nFreebie,20,0\n'));
  const findings = auditRows(rows);
  assert.ok(!findings.some(f => f.check === 'missing_cost'));
  assert.equal(margin(2000, 0), 1);
});

/* ---------- checks ------------------------------------------------------ */

test('below-cost products are found and priced per unit', () => {
  const { rows } = toRows(parseCsv('Title,Price,Cost per item\nMug,8.00,12.50\n'));
  const f = auditRows(rows).find(x => x.check === 'below_cost');
  assert.ok(f);
  assert.equal(f.atStake, 4.5);
  assert.match(f.detail, /8/);
});

test('thin margin is measured against the target, not a fixed number', () => {
  const csv = 'Title,Price,Cost per item\nSoap,10,8\n';
  const { rows } = toRows(parseCsv(csv));
  assert.ok(auditRows(rows, { targetMargin: 0.30 }).some(f => f.check === 'below_target_margin'));
  assert.ok(!auditRows(rows, { targetMargin: 0.15 }).some(f => f.check === 'below_target_margin'));
});

test('a compare-at price at or below the selling price is flagged', () => {
  const { rows } = toRows(parseCsv(
    'Title,Price,Compare at price,Cost per item\nA,20,20,5\nB,20,15,5\nC,20,30,5\n'));
  const hits = auditRows(rows).filter(f => f.check === 'price_inversion').map(f => f.label);
  assert.deepEqual(hits.sort(), ['A', 'B']);
});

test('published products with no stock are flagged', () => {
  const { rows } = toRows(parseCsv(
    'Title,Price,Cost per item,Status,Inventory quantity\nX,20,5,active,0\nY,20,5,draft,0\n'));
  const hits = auditRows(rows).filter(f => f.check === 'published_unavailable');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].label, 'X');
});

test('duplicate SKUs are reported once, with differing prices called out', () => {
  const { rows } = toRows(parseCsv(
    'Title,Variant SKU,Price,Cost per item\nA,S1,10,4\nB,S1,12,4\nC,S2,9,3\n'));
  const hits = auditRows(rows).filter(f => f.check === 'duplicate_sku');
  assert.equal(hits.length, 1);
  assert.match(hits[0].detail, /2 rows/);
  assert.match(hits[0].detail, /different prices/);
});

test('a clean catalogue produces no findings', () => {
  const { rows } = toRows(parseCsv(
    'Title,Variant SKU,Price,Cost per item,Status,Inventory quantity\n'
    + 'A,S1,20,5,active,10\nB,S2,30,9,active,4\n'));
  assert.equal(auditRows(rows).length, 0);
});

/* ---------- ranking ----------------------------------------------------- */

test('findings rank by money at stake, and unknown never sorts as zero', () => {
  const { rows } = toRows(parseCsv(
    'Title,Price,Cost per item\nSmall,10,11\nBig,10,40\nNoCost,10,\n'));
  const f = auditRows(rows);
  assert.equal(f[0].label, 'Big');      // 30 at stake
  assert.equal(f[1].label, 'Small');    // 1 at stake
  assert.equal(f[2].check, 'missing_cost');
  assert.equal(f[2].atStake, null, 'unknown exposure sorts last but is not 0');
});

/* ---------- supplier change --------------------------------------------- */

test('a supplier price rise that pushes a product below cost is escalated', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nA,S1,10,6\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,12\n')).rows;
  const f = auditSupplierChange(rows, supplier);
  assert.equal(f.length, 1);
  assert.equal(f[0].check, 'supplier_change_now_below_cost');
  assert.equal(f[0].atStake, 6);
  assert.match(f[0].detail, /below cost/);
});

test('a supplier change that only thins the margin is a lesser finding', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nA,S1,10,3\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,8\n')).rows;
  const f = auditSupplierChange(rows, supplier, { targetMargin: 0.3 });
  assert.equal(f[0].check, 'supplier_change_below_target');
});

test('unchanged supplier costs produce nothing', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nA,S1,10,6\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,6.001\n')).rows;
  assert.equal(auditSupplierChange(rows, supplier).length, 0);
});

/* ---------- summary ----------------------------------------------------- */

test('cost coverage is reported so every other number carries its caveat', () => {
  const { rows } = toRows(parseCsv(
    'Title,Price,Cost per item\nA,10,5\nB,10,\nC,10,4\nD,10,\n'));
  const s = summarise(rows, auditRows(rows));
  assert.equal(s.rows, 4);
  assert.equal(s.withCost, 2);
  assert.equal(s.missingCost, 2);
  assert.equal(s.costCoverage, 0.5);
});

test('known and unknown exposure are totalled separately', () => {
  const { rows } = toRows(parseCsv('Title,Price,Cost per item\nA,10,25\nB,10,\n'));
  const s = summarise(rows, auditRows(rows));
  assert.equal(s.knownAtStake, 15);
  assert.equal(s.unknownAtStake, 1, 'the unknown one is counted, not folded into the total');
});

test('an empty file does not crash and reports nothing', () => {
  const { rows } = toRows(parseCsv(''));
  assert.equal(rows.length, 0);
  assert.equal(auditRows(rows).length, 0);
  assert.equal(summarise(rows, []).costCoverage, null);
});

/* ---------- repricing: the actionable half ------------------------------ */

test('the price that restores a target margin is plain arithmetic', () => {
  // margin = (p - c)/p  ->  p = c / (1 - m), in cents, rounded up
  assert.equal(priceForMargin(800, 0.30), 1143);   // 8.00 -> 11.43
  assert.equal(priceForMargin(1000, 0.50), 2000);  // 10.00 -> 20.00
  assert.equal(priceForMargin(0, 0.30), 0);
});

test('the suggested price rounds up, never leaving the merchant under target', () => {
  const p = priceForMargin(333, 0.30);          // 3.33 / 0.7 = 4.757...
  assert.equal(p, 476);                          // 4.76, not 4.75
  assert.ok((p - 333) / p >= 0.30, 'rounding must not undershoot the target');
});

test('an impossible or unknown target yields no price, not a huge one', () => {
  assert.equal(priceForMargin(800, 1), null, '100% margin has no finite solution');
  assert.equal(priceForMargin(800, 1.5), null);
  assert.equal(priceForMargin(MONEY_UNKNOWN, 0.3), null, 'never invent a cost');
  assert.equal(priceForMargin(-100, 0.3), null);
});

test('a supplier rise tells the merchant what to charge', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nSoap,S1,10,5\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,8\n')).rows;
  const f = auditSupplierChange(rows, supplier, { targetMargin: 0.30 })[0];
  assert.equal(f.newCost, 8);
  assert.equal(f.currentPrice, 10);
  assert.equal(f.suggestedPrice, 11.43);   // display amount
  assert.equal(f.action, 'reprice');
  assert.match(f.detail, /Charge 11\.43/);
});

test('a supplier price cut suggests no reprice — that is a commercial call', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nSoap,S1,20,10\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,6\n')).rows;
  const f = auditSupplierChange(rows, supplier, { targetMargin: 0.30 })[0];
  assert.equal(f.suggestedPrice, null, 'do not tell a merchant to cut their price');
  assert.equal(f.action, 'no action needed');
});

test('a product already above target after a rise needs no reprice', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nSoap,S1,100,10\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,12\n')).rows;
  const f = auditSupplierChange(rows, supplier, { targetMargin: 0.30 })[0];
  assert.equal(f.suggestedPrice, null);
  assert.equal(f.action, 'accept the thinner margin');
});

test('below-cost after a rise is escalated and still priced', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nSoap,S1,10,6\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,14\n')).rows;
  const f = auditSupplierChange(rows, supplier, { targetMargin: 0.30 })[0];
  assert.equal(f.check, 'supplier_change_now_below_cost');
  assert.equal(f.action, 'reprice or stop selling');
  assert.equal(f.suggestedPrice, 20);
});

/* ---------- catalogue drift --------------------------------------------- */

test('a product the supplier no longer lists is flagged', () => {
  const { rows } = toRows(parseCsv(
    'Title,Variant SKU,Price,Cost per item\nA,S1,10,5\nB,S2,10,5\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,6\n')).rows;
  const f = auditCatalogueDrift(rows, supplier);
  const dropped = f.filter(x => x.check === 'dropped_by_supplier');
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].sku, 'S2');
  assert.equal(dropped[0].atStake, null, 'unsourceable is not a computable loss');
});

test('a supplier line you do not stock is reported as an opportunity, not a loss', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nA,S1,10,5\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,6\nS9,4\n')).rows;
  const f = auditCatalogueDrift(rows, supplier);
  const added = f.filter(x => x.check === 'new_from_supplier');
  assert.equal(added.length, 1);
  assert.equal(added[0].sku, 'S9');
  assert.match(added[0].atStakeNote, /opportunity/);
});

test('matching catalogues drift not at all', () => {
  const { rows } = toRows(parseCsv('Title,Variant SKU,Price,Cost per item\nA,S1,10,5\n'));
  const supplier = toRows(parseCsv('Variant SKU,Cost\nS1,6\n')).rows;
  assert.equal(auditCatalogueDrift(rows, supplier).length, 0);
});
