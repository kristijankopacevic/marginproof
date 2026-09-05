# MarginProof — release scope

**Date:** 2026-09-05 · **Version:** 0.2.0 · **Decision: RELEASE** (not merged)

---

## What it is

| | |
|---|---|
| **Target buyer** | A Shopify or WooCommerce merchant who prices by hand, has more SKUs than they can check, and gets a supplier price list they must act on |
| **Problem** | They cannot tell which products lose money — and their platform's profit report silently omits every variant with no cost, so it reads healthier than the business is |
| **Local path** | `D:\models\KWNLOEDGE\products\marginproof` |
| **Repo** | created at release (see below) |
| **Distribution** | GitHub Pages — a static page, no install, no account |
| **Tests** | **32**, `node --test`, zero dependencies |

## Duplication check — the question that could have stopped this

Three products in this ecosystem touch cost and margin. They are not the same
product, and the difference is delivery, not features.

| | ProfitGuard for WooCommerce | MarginGuard AI | **MarginProof** |
|---|---|---|---|
| Form | WordPress plugin | Next.js SaaS (10,339 lines: auth, billing, db, jobs) | Static page (~380 lines) |
| Platform | WooCommerce only | Any, via upload | **Any, via CSV** |
| To use it | Install a plugin on a live store | Sign up, upload | **Open a page** |
| Data | Stays on their server | **Uploaded to ours** | **Never leaves the browser** |
| Operating cost | n/a | Hosting + database | **€0** |

**Verdict: not duplicative. `MERGE_INTO` is not set.**

The standalone wedge is one sentence: **it is the only one a merchant can use
without installing anything, creating an account, or sending their cost data to
a stranger.** For the most commercially sensitive numbers a small retailer has,
that is a real difference and not a packaging trick.

ProfitGuard remains the deeper WooCommerce product. MarginGuard remains the paid
continuous version if demand appears. MarginProof is the front door.

## V1 — frozen

- **Target buyer:** above.
- **Problem:** above.
- **Input:** one product-export CSV. Optionally a second CSV of new supplier costs.
- **Output:** findings ranked by money at stake, a recommended price where one
  applies, a reprice-list CSV, and a full findings CSV.
- **Activation event:** a merchant drops in their export and sees a findings table.
- **First value moment:** the first finding they did not already know about.

### Out of scope, deliberately

No account, login, server, upload, OAuth, app-store listing, billing, dashboard,
team features, analytics, integrations, and **no LLM anywhere in the arithmetic**.

## Financial correctness

- **All money is an integer count of cents.** Converted once at parse, formatted
  once for display, integer arithmetic in between.
- **Recommended price uses basis points**, not float division. `1400 / 0.7` is
  `2000.0000000000002` in floating point, and rounding that up produced a
  recommended price of **20.01 instead of 20.00** — caught by test, fixed with
  `cost × 10000 / (10000 − bp)`.
- **Rounding is up, never down**, so a suggested price never lands fractionally
  under the target the merchant asked to hold. Asserted by test.
- **UNKNOWN ≠ ZERO.** A missing cost yields no margin, no exposure figure, and
  never a "100% margin". Asserted in four places.
- **No language model touches any number.** There is no model in this repository.

## Honest limits

1. **No real merchant has used it.** Validated on a synthetic catalogue and 32 unit tests.
2. **Product exports carry no sales volume**, so exposure is per unit, never annualised.
3. **Column detection is alias-based** and will meet exports it does not know. It
   fails loudly and lists the columns it saw rather than guessing.
4. **It audits a file, not a live store** — a snapshot, not monitoring.
