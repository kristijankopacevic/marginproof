# MarginProof — V1 scope (frozen 2026-09-05)

**Positioning:** *Find the products losing you money — without your cost data
leaving your computer.*

**Buyer:** small/mid Shopify and WooCommerce merchants who price by hand; the
bookkeepers and agencies who clean up after them. Immediate segment: Stocky
refugees holding a CSV export and nowhere to put it.

## In scope — shipped

- Client-side CSV parse (quotes, embedded commas, BOM, EU/anglo numbers, currency symbols)
- Platform and column auto-detection across Shopify / WooCommerce / generic
- 7 deterministic catalogue checks plus supplier price-change comparison
- Findings ranked by money at stake; unknown exposure never scored as zero
- Cost-coverage warning stated before any margin figure
- CSV download and print/PDF of findings
- Adjustable target margin
- Dark mode, mobile layout, lazy-loaded assets

## Out of scope, deliberately

Account, login, server, upload, OAuth, app-store listing, inventory management,
purchase orders, forecasting, ERP, dashboards, billing, and any LLM anywhere in
the arithmetic.

## Monetisation

**Not priced.** The audit is free. Evidence points to a one-off or per-store fee
rather than a subscription — this is a periodic clean-up, not a daily habit — but
no price is set until real merchants have run real catalogues. The subscription
hypothesis belongs to the continuous product (the agency monitor), where the
behaviour actually matches.

**EUR 0 mandatory monthly cost.** Static files, no backend, no paid service.

## Activation and first value

- **Activation:** a merchant drops in their export and sees a findings table.
- **First value:** the first finding they did not already know about.

## Honest limits of V1

1. **No real merchant has used it.** Every check was validated on a synthetic
   ten-row catalogue and unit tests.
2. **Product exports carry no sales volume**, so exposure is per unit only.
3. **Column detection is alias-based** and will meet exports it does not
   recognise. It fails loudly rather than guessing.
4. **It audits a file, not a live store** — a snapshot, not monitoring.
