# MarginProof

**Find the products losing you money — without your cost data leaving your computer.**

Drop in the CSV your store already exports. MarginProof shows which products sell
below cost, which have no cost recorded — and are therefore **missing from your
profit reports entirely** — and which are quietly wrong.

Open `index.html`. That is the whole thing. No account, no upload, no server, no
install. You can disconnect from the internet after the page loads and it still
works.

---

## Why this exists

Shopify stores a single current cost per item. When a supplier price changes,
that number overwrites what you actually paid, so margin reports start using
today's cost on last year's sales. Worse, the native profit report **silently
omits variants that have no cost recorded**, which means the profit figure a
merchant reads can exclude part of the catalogue and look healthier than the
business is.

Merchants have been reconciling this by hand in spreadsheets. In August 2026
Stocky shut down and took a lot of cost history with it — *"supplier data cannot
be exported from Stocky … or that information is permanently lost."*

The existing Shopify audit apps — Catalog Copilot, Product IQ, ShopDoctor,
CatalogIQ — audit SEO, alt text, images and Google feed. None of them audits
whether the money is right.

## The one rule the code is built around

**UNKNOWN IS NOT ZERO.**

If a product has no cost, MarginProof reports it as *unknown* and leaves it out
of the totals. It never assumes zero, because a zero cost would show a 100%
margin and reproduce — in the opposite direction — the exact reporting defect
this tool exists to expose.

That rule is asserted by tests, not just intended.

## What it checks

| Check | What it means |
|---|---|
| `below_cost` | Sells for less than it costs you. Priced per unit. |
| `missing_cost` | No cost recorded — excluded from profit reporting, true margin unknown. |
| `below_target_margin` | Under the target margin you set. |
| `price_inversion` | A compare-at price that is not actually higher, so the "discount" is zero or negative. |
| `published_unavailable` | Published with no stock — customers can order what you cannot ship. |
| `duplicate_sku` | Two or more rows share a SKU, often at different prices. |
| `no_price` | Zero or negative price. |
| `supplier_change_*` | With a second CSV: which margins moved, and which products now sell below cost. |

Findings are ranked by money at stake. **Unknown exposure sorts last but is never
scored as zero.**

## What it deliberately does not do

- **No guessing.** A missing cost stays missing. A missing price column stops the
  audit with an explanation rather than a silent assumption.
- **No writes.** It reads a file you chose. It cannot change anything in your store.
- **No AI in the arithmetic.** Every figure is plain deterministic calculation you
  could redo by hand. There is no model anywhere in this repository.
- **No totals it cannot know.** The per-unit column is per unit *sold*. A product
  export contains no sales volumes, so MarginProof will not invent an annual
  figure from one.

## Supported files

Shopify product export, WooCommerce product export, or any CSV with a price
column. Columns are detected by name across common aliases; European and
anglo number formats and currency symbols are both handled.

If the price column cannot be found, the tool says so and lists the columns it
did see — rather than producing a confident report from nothing.

## Running it

```
open index.html          # that's it
```

Tests:

```
npm test                 # 21 tests, no dependencies
```

There are no dependencies, no build step and no toolchain. `src/audit.js` is a
plain ES module used unchanged by both the page and the tests.

## Sample

`docs/sample/shopify-products-sample.csv` is a deliberately messy ten-row
catalogue containing one of each defect. Running it should produce 8 findings at
80% cost coverage.

## Privacy

There is no server to send anything to. The page never makes a network request
after it loads, and the file you select is read by your browser and held in
memory. This is verifiable: open developer tools, run an audit, and watch the
network tab stay empty.

## Status

Early. Built 2026-09-05. **No real merchant has run their catalogue through it
yet** — which is the next thing that needs to happen, and it will change things.
If it gets something wrong on a real catalogue, that is worth knowing; the checks
are deliberately strict rather than reassuring.

Not affiliated with Shopify, WooCommerce or any platform.
