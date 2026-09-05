/* MarginProof — the audit engine.
 *
 * Every number here is computed in plain deterministic arithmetic. There is no
 * model, no inference and no estimate: a merchant is going to reprice real
 * products off this output, and a plausible-looking guess is worse than no
 * answer at all.
 *
 * The rule that shapes the whole file: UNKNOWN IS NOT ZERO.
 *
 * That is not pedantry — it is the exact defect being exposed. Shopify's own
 * profit report omits variants that have no cost recorded, so the merchant sees
 * a profit number that quietly excludes part of the catalogue and looks
 * healthier than reality. If this tool treated a missing cost as a cost of 0 it
 * would invent 100% margins and repeat the same class of lie in the opposite
 * direction. So a missing cost produces a finding, never a margin.
 */

export const MONEY_UNKNOWN = null;

/* ---------- money is integers ------------------------------------------
 * Every monetary value in this file is an integer count of minor units
 * (cents). Nothing is stored or compared as a floating-point currency amount.
 *
 * This is not theoretical tidiness. In binary floating point
 * 19.99 - 19.99*0.3 is 13.992999999999999, and a merchant repricing a
 * catalogue off "13.99 vs 13.993" deserves better than an answer that depends
 * on which side of a rounding boundary the noise fell. Parsing converts to
 * cents once, at the edge; formatting converts back once, for display; and
 * everything between is integer arithmetic.
 */

/** Convert a parsed decimal amount to integer minor units, or null. */
export function toMinor(value) {
  if (value === MONEY_UNKNOWN) return MONEY_UNKNOWN;
  // Round half away from zero on the scaled value: the input already came from
  // a decimal string, so this only absorbs the representation error.
  return Math.round(value * 100);
}

/** Integer minor units back to a display number. */
export function fromMinor(minor) {
  return minor === MONEY_UNKNOWN ? MONEY_UNKNOWN : minor / 100;
}

/* ---------- parsing ---------------------------------------------------- */

/** RFC4180-ish CSV split: handles quoted fields, embedded commas and "" escapes. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  // Strip a UTF-8 BOM; Shopify and Excel both emit one and it corrupts the
  // first header name, which silently breaks column detection.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

/** Numbers as merchants actually export them: "1.234,56", "$12.00", "12 %".
 *
 * Returns a plain decimal. Callers that hold money call `toMinor` on the
 * result; quantities such as stock counts stay decimal.
 */
export function parseNumber(raw) {
  if (raw === undefined || raw === null) return MONEY_UNKNOWN;
  let s = String(raw).trim();
  if (s === '') return MONEY_UNKNOWN;
  s = s.replace(/[^\d.,\-]/g, '');
  if (s === '' || s === '-') return MONEY_UNKNOWN;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');   // 1.234,56
  else s = s.replace(/,/g, '');                                          // 1,234.56
  const n = Number(s);
  return Number.isFinite(n) ? n : MONEY_UNKNOWN;
}

const norm = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* Column aliases across Shopify, WooCommerce and hand-made spreadsheets.
 * Order matters: the first alias found wins, so the most explicit name is
 * listed first. */
const FIELDS = {
  sku:      ['variantsku', 'sku', 'itemsku', 'productsku', 'id'],
  title:    ['title', 'name', 'productname', 'producttitle', 'product'],
  variant:  ['option1value', 'variantname', 'variant', 'variationname'],
  price:    ['variantprice', 'price', 'regularprice', 'sellingprice', 'unitprice'],
  cost:     ['costperitem', 'variantcost', 'cost', 'cogs', 'costprice', 'unitcost',
             'purchaseprice', 'buyprice', 'wholesaleprice', '_wc_cog_cost'],
  compare:  ['variantcompareatprice', 'compareatprice', 'compareat', 'saleprice', 'rrp', 'msrp'],
  qty:      ['variantinventoryqty', 'inventoryquantity', 'stock', 'quantity', 'qty', 'instock'],
  status:   ['status', 'published', 'visibility', 'poststatus'],
};

export function detectColumns(header) {
  const map = {};
  const normalised = header.map(norm);
  for (const [key, aliases] of Object.entries(FIELDS)) {
    for (const alias of aliases) {
      const idx = normalised.indexOf(alias);
      if (idx !== -1) { map[key] = idx; break; }
    }
  }
  return map;
}

export function detectPlatform(header) {
  const h = header.map(norm);
  if (h.includes('variantsku') || h.includes('costperitem')) return 'Shopify';
  if (h.includes('poststatus') || h.some(x => x.startsWith('_wc_') || x === 'regularprice'))
    return 'WooCommerce';
  return 'Generic CSV';
}

/* ---------- model ------------------------------------------------------ */

export function toRows(rows) {
  if (!rows.length) return { rows: [], columns: {}, platform: 'unknown', header: [] };
  const header = rows[0];
  const columns = detectColumns(header);
  const platform = detectPlatform(header);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = k => (columns[k] === undefined ? undefined : r[columns[k]]);
    const price = toMinor(parseNumber(get('price')));
    const cost = toMinor(parseNumber(get('cost')));
    const title = (get('title') || '').trim();
    const sku = (get('sku') || '').trim();
    // A row with neither a name nor a price is padding, not a product.
    if (!title && !sku && price === MONEY_UNKNOWN) continue;
    out.push({
      line: i + 1,
      sku, title,
      variant: (get('variant') || '').trim(),
      price, cost,                                   // integer minor units
      compare: toMinor(parseNumber(get('compare'))),  // integer minor units
      qty: parseNumber(get('qty')),                   // a count, not money
      status: (get('status') || '').trim(),
    });
  }
  return { rows: out, columns, platform, header };
}

/* ---------- money ------------------------------------------------------ */

/** Margin as a fraction of price, from integer minor units. */
export function margin(priceMinor, costMinor) {
  if (priceMinor === MONEY_UNKNOWN || costMinor === MONEY_UNKNOWN) return null;
  if (priceMinor <= 0) return null;
  return (priceMinor - costMinor) / priceMinor;
}

/** Display helper: integer minor units -> a 2dp number. */
const money = minor => minor / 100;

/* ---------- checks ------------------------------------------------------
 * Each returns findings with an `atStake` in currency where that is
 * *derivable*, and null where it is not. Sorting by money is only honest when
 * the money is real, so a finding with unknown exposure says so rather than
 * being scored as zero and sinking to the bottom.
 */

export const SEVERITY = { LOSS: 'losing money', WRONG: 'reported wrong', RISK: 'needs checking' };

export function auditRows(rows, opts = {}) {
  const targetMargin = opts.targetMargin ?? 0.30;
  const findings = [];
  const add = f => findings.push(f);

  const bySku = new Map();

  for (const r of rows) {
    const label = [r.title, r.variant].filter(Boolean).join(' — ') || r.sku || `line ${r.line}`;
    const m = margin(r.price, r.cost);

    if (r.sku) {
      if (!bySku.has(r.sku)) bySku.set(r.sku, []);
      bySku.get(r.sku).push(r);
    }

    // 1. Below cost — the most expensive error in the file.
    if (m !== null && r.price > 0 && r.cost > r.price) {
      add({
        check: 'below_cost', severity: SEVERITY.LOSS, label, sku: r.sku, line: r.line,
        detail: `Sells for ${money(r.price)} but costs ${money(r.cost)}.`,
        atStake: money(r.cost - r.price),
        atStakeNote: 'lost on every unit sold',
      });
    }
    // 2. Missing cost — the variant the platform's profit report drops.
    else if (r.cost === MONEY_UNKNOWN && r.price !== MONEY_UNKNOWN && r.price > 0) {
      add({
        check: 'missing_cost', severity: SEVERITY.WRONG, label, sku: r.sku, line: r.line,
        detail: 'No cost recorded, so this product is excluded from profit reporting '
              + 'and its true margin is unknown.',
        atStake: null,
        atStakeNote: 'unknown — cannot be calculated without a cost',
      });
    }
    // 3. Thin margin against the merchant's own target.
    else if (m !== null && m < targetMargin && r.cost <= r.price) {
      add({
        check: 'below_target_margin', severity: SEVERITY.RISK, label, sku: r.sku, line: r.line,
        detail: `Margin ${(m * 100).toFixed(1)}% is under the ${(targetMargin * 100).toFixed(0)}% target.`,
        atStake: money((targetMargin - m) * r.price),
        atStakeNote: 'per unit, to reach target',
      });
    }

    // 4. Price inversion — a "sale" that is not one.
    if (r.compare !== MONEY_UNKNOWN && r.price !== MONEY_UNKNOWN
        && r.compare > 0 && r.compare <= r.price) {
      add({
        check: 'price_inversion', severity: SEVERITY.WRONG, label, sku: r.sku, line: r.line,
        detail: `Compare-at price ${money(r.compare)} is not above the selling price `
              + `${money(r.price)}, so the discount shown is zero or negative.`,
        atStake: null, atStakeNote: 'misleading display, no direct unit cost',
      });
    }

    // 5. Zero or negative price.
    if (r.price !== MONEY_UNKNOWN && r.price <= 0) {
      add({
        check: 'no_price', severity: SEVERITY.LOSS, label, sku: r.sku, line: r.line,
        detail: `Price is ${money(r.price)}.`,
        atStake: null, atStakeNote: 'given away at this price',
      });
    }

    // 6. Published but unavailable.
    const published = /active|publish|visible|1|true/i.test(r.status || '');
    if (published && r.qty !== MONEY_UNKNOWN && r.qty <= 0) {
      add({
        check: 'published_unavailable', severity: SEVERITY.RISK, label, sku: r.sku, line: r.line,
        detail: `Published with ${r.qty} in stock — customers can reach a product you cannot ship.`,
        atStake: null, atStakeNote: 'cancellations and support time',
      });
    }
  }

  // 7. Duplicate SKUs — two rows claiming to be the same item.
  for (const [sku, group] of bySku) {
    if (group.length < 2) continue;
    const prices = [...new Set(group.map(g => g.price).filter(p => p !== MONEY_UNKNOWN))];
    add({
      check: 'duplicate_sku', severity: SEVERITY.WRONG, label: sku, sku, line: group[0].line,
      detail: `${group.length} rows share this SKU`
            + (prices.length > 1 ? `, at ${prices.length} different prices (${prices.map(money).join(', ')}).` : '.'),
      atStake: null, atStakeNote: 'reporting and stock will disagree',
    });
  }

  return rank(findings);
}

/** The price that restores a target margin at a given cost, or null.
 *
 * margin = (price - cost) / price, so price = cost / (1 - margin).
 *
 * Returns null rather than a number when the target is 100% or more, because
 * that equation has no finite solution and quietly returning a huge figure
 * would look like an answer. Also null when the cost is unknown — the whole
 * point is not to invent one.
 */
export function priceForMargin(costMinor, targetMargin) {
  if (costMinor === MONEY_UNKNOWN || costMinor < 0) return null;
  if (!(targetMargin >= 0) || targetMargin >= 1) return null;
  // Integer arithmetic all the way down. Dividing by (1 - 0.30) in floating
  // point gives 1400 / 0.7 = 2000.0000000000002, and rounding that UP produced
  // a recommended price of 20.01 instead of 20.00 — a visible, wrong number on
  // a page whose whole promise is that the arithmetic is trustworthy.
  // Basis points keep both sides integral: price = cost * 10000 / (10000 - bp).
  const bp = Math.round(targetMargin * 10000);
  if (bp >= 10000) return null;
  const num = costMinor * 10000;
  const den = 10000 - bp;
  // Round UP to the cent: rounding down would leave the merchant fractionally
  // under the target they asked to hold, which is the wrong way to err.
  // `|| 0` normalises negative zero: ceil(-1e-9) is -0, which is not strictly
  // equal to 0 and would surface as "-0.00" on a price.
  return Math.ceil(num / den - 1e-9) || 0;
}

/** Supplier price comparison: what a new cost list does to existing margins. */
export function auditSupplierChange(rows, supplierRows, opts = {}) {
  const targetMargin = opts.targetMargin ?? 0.30;
  const newCost = new Map();
  for (const s of supplierRows) {
    if (s.sku && s.cost !== MONEY_UNKNOWN) newCost.set(s.sku, s.cost);
    else if (s.sku && s.price !== MONEY_UNKNOWN) newCost.set(s.sku, s.price);
  }
  const findings = [];
  for (const r of rows) {
    if (!r.sku || !newCost.has(r.sku)) continue;
    const nc = newCost.get(r.sku);
    if (r.cost === MONEY_UNKNOWN) continue;
    if (nc === r.cost) continue;   // exact: integers, no epsilon needed
    const label = [r.title, r.variant].filter(Boolean).join(' — ') || r.sku;
    const before = margin(r.price, r.cost), after = margin(r.price, nc);
    const rise = nc > r.cost;
    const nowLoses = after !== null && after < 0;
    const dropsBelowTarget = before !== null && after !== null
      && before >= targetMargin && after < targetMargin;
    // What the merchant actually needs: the price to set. Only offered when it
    // would be an increase — telling someone to cut their price because a
    // supplier got cheaper is a commercial decision, not an arithmetic one.
    const suggested = priceForMargin(nc, targetMargin);
    const needsRepricing = suggested !== null && r.price !== MONEY_UNKNOWN
      && suggested > r.price;

    findings.push({
      check: nowLoses ? 'supplier_change_now_below_cost'
            : dropsBelowTarget ? 'supplier_change_below_target' : 'supplier_change',
      severity: nowLoses ? SEVERITY.LOSS : dropsBelowTarget ? SEVERITY.RISK : SEVERITY.WRONG,
      label, sku: r.sku, line: r.line,
      detail: `Cost ${rise ? 'rose' : 'fell'} ${money(r.cost)} → ${money(nc)}`
            + (before !== null && after !== null
               ? `, margin ${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%.` : '.')
            + (nowLoses ? ' This product now sells below cost.' : '')
            + (needsRepricing
               ? ` Charge ${money(suggested)} to hold ${(targetMargin * 100).toFixed(0)}%.`
               : ''),
      atStake: money(Math.abs(nc - r.cost)),
      atStakeNote: 'per unit change in cost',
      currentPrice: r.price === MONEY_UNKNOWN ? null : money(r.price),
      newCost: money(nc),
      suggestedPrice: needsRepricing ? money(suggested) : null,
      action: nowLoses ? 'reprice or stop selling'
            : needsRepricing ? 'reprice'
            : rise ? 'accept the thinner margin' : 'no action needed',
    });
  }
  return rank(findings);
}

/** SKUs that appeared in or vanished from the supplier list since the catalogue.
 *
 * A supplier dropping a line is how a shop keeps selling something nobody can
 * source any more, and neither event shows up in a price comparison — the SKU
 * is simply absent from one side, which is easy to read as "no change".
 */
export function auditCatalogueDrift(rows, supplierRows) {
  const cat = new Set(rows.map(r => r.sku).filter(Boolean));
  const sup = new Set(supplierRows.map(r => r.sku).filter(Boolean));
  const findings = [];

  for (const r of rows) {
    if (!r.sku || sup.has(r.sku)) continue;
    findings.push({
      check: 'dropped_by_supplier', severity: SEVERITY.RISK,
      label: [r.title, r.variant].filter(Boolean).join(' — ') || r.sku,
      sku: r.sku, line: r.line,
      detail: 'You sell this, but it is not on the new supplier list. '
            + 'Check whether it has been discontinued before you take another order.',
      atStake: null, atStakeNote: 'unknown — may be unsourceable',
      action: 'confirm availability',
    });
  }
  for (const s of supplierRows) {
    if (!s.sku || cat.has(s.sku)) continue;
    findings.push({
      check: 'new_from_supplier', severity: SEVERITY.WRONG,
      label: [s.title, s.variant].filter(Boolean).join(' — ') || s.sku,
      sku: s.sku, line: s.line,
      detail: 'On the supplier list but not in your catalogue — a product you '
            + 'could sell and currently do not.',
      atStake: null, atStakeNote: 'opportunity, not a loss',
      action: 'consider listing',
    });
  }
  return rank(findings);
}

/** Money first, then severity. Unknown exposure sorts after known, never as 0. */
function rank(findings) {
  const sev = { [SEVERITY.LOSS]: 0, [SEVERITY.WRONG]: 1, [SEVERITY.RISK]: 2 };
  return findings.sort((a, b) => {
    if ((a.atStake === null) !== (b.atStake === null)) return a.atStake === null ? 1 : -1;
    if (a.atStake !== null && b.atStake !== a.atStake) return b.atStake - a.atStake;
    return sev[a.severity] - sev[b.severity];
  });
}

/* ---------- summary ---------------------------------------------------- */

export function summarise(rows, findings) {
  const withCost = rows.filter(r => r.cost !== MONEY_UNKNOWN).length;
  const priced = rows.filter(r => r.price !== MONEY_UNKNOWN && r.price > 0).length;
  const margins = rows.map(r => margin(r.price, r.cost)).filter(m => m !== null);
  margins.sort((a, b) => a - b);
  const byCheck = {};
  for (const f of findings) byCheck[f.check] = (byCheck[f.check] || 0) + 1;

  return {
    rows: rows.length,
    priced,
    withCost,
    // Reported as a share, and the missing part is named rather than ignored —
    // this number is the confidence interval on every other number here.
    costCoverage: rows.length ? withCost / rows.length : null,
    missingCost: rows.length - withCost,
    medianMargin: margins.length ? margins[Math.floor(margins.length / 2)] : null,
    findings: findings.length,
    byCheck,
    // `atStake` on a finding is already a display amount, so it is summed as
    // one. Passing it through `money()` again divided by 100 twice and turned
    // 15.00 into 0.15 — caught by the exposure test when money moved to minor
    // units, which is exactly what that test is for.
    knownAtStake: Math.round(findings.reduce((s, f) => s + (f.atStake || 0), 0) * 100) / 100,
    unknownAtStake: findings.filter(f => f.atStake === null).length,
  };
}
