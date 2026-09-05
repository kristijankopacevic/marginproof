# MarginProof — release report

**Date:** 2026-09-05 · **Version:** 0.1.0 · **Status:** usable, not yet published

## What was built

A single-page, dependency-free margin and catalogue audit. `src/audit.js` is a
plain ES module consumed unchanged by both the browser page and the test runner.

| | |
|---|---|
| Source | `src/audit.js` (~330 lines), `index.html` |
| Tests | **21 passing**, `node --test`, zero dependencies |
| Dependencies | **none** |
| Build step | **none** |
| Backend | **none** |
| Mandatory monthly cost | **€0.00** |
| Paid services activated | **none** |

## Verified

- **21/21 unit tests** covering CSV edge cases, number formats, every check,
  ranking order, supplier comparison and the summary.
- **Browser-verified end to end** with Playwright against the messy sample:
  10 products read, platform detected as Shopify, 8 findings, 80% cost coverage,
  top finding = below-cost candle at 2.50 per unit.
- **UNKNOWN-is-not-ZERO asserted by test** in three places, including an explicit
  assertion that a missing cost never yields a margin verdict.
- **Empty file, junk values and a missing price column** all handled without a
  crash and without a fabricated result.

## Security

- **No network calls at all** after page load — there is nothing to exfiltrate to.
- No dependencies, therefore no supply chain.
- No `eval`. Every CSV field rendered into the page passes through an escape
  helper, so a malicious product title cannot inject markup.
- No secrets and no customer data in the repository.
- `.gitignore` blocks `docs/customer/` and `*-real.csv`, so a real merchant's
  catalogue cannot be committed by accident.
- **BLOCK 0 / HIGH 0.**

## Not done

- **Not published.** No repository has been created and nothing has been pushed.
  Publishing is an outward-facing action and the repository decision is the
  owner's.
- **No real merchant has used it.**
- Order and payout reconciliation is out of scope for V1.

## Next

Put it in front of the merchants already asking, in the Shopify Community threads
recorded in `PAIN_SIGNALS.csv` — answering with a working free tool rather than an
advertisement.
