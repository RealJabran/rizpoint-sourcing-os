# RizPoint FBA Research browser extension

A Manifest V3 extension for Chrome, Brave and Microsoft Edge. It supports Amazon USA, UK, UAE and Saudi Arabia product pages.

## What it does

- Detects the marketplace from the active Amazon domain and always displays the country and currency.
- Extracts ASIN, Buy Box price, title, category/breadcrumbs, BSRs, package dimensions and weight from the product page.
- Requests the current ASIN fee result from that marketplace's **official Amazon Revenue Calculator** endpoint (`rcpublic/productmatch` and `rcpublic/getfees`). It does not use a guessed, hard-coded fulfilment fee table.
- Breaks out referral, fulfilment, closing, digital-service, other Amazon and optional storage fees.
- Calculates payout, profit, margin and ROI from editable product, prep, inbound and other costs.
- Loads the Amazon All Offers response available to the current browser session and classifies unique observed sellers as FBA, FBM or Amazon.
- Provides a compact side widget, full page lightbox, toolbar popup, per-field copy buttons and a tab-separated “Copy row for sheet” action.
- Lets the user hide unwanted fields, disable automatic network requests and optionally add a VAT planning reserve.

## Install locally

1. Download or clone the repository.
2. Open `chrome://extensions` in Chrome, `brave://extensions` in Brave, or `edge://extensions` in Edge.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `browser-extension` folder.
5. Open a supported Amazon product detail page and click the RizPoint panel on the right.

## Accuracy contract

“Official” means the fee components were returned at that moment by Amazon's Revenue Calculator for the detected marketplace, ASIN and displayed/entered selling price. The extension refuses to label locally inferred numbers as official.

No browser extension can truthfully guarantee that every Amazon value is always 100% available:

- Amazon can change its private page markup or the public calculator endpoint without notice.
- Fees can depend on Amazon's catalog dimensions, fee category, price, seller program enrolment, inventory age, inbound-placement choice, dangerous-goods status and promotions.
- The public All Offers response can omit offers due to pagination, delivery location, suppression, availability, login state or Amazon experiments. Seller totals are therefore labelled **observed offers**, not total marketplace sellers.
- BSR and Buy Box values are point-in-time page observations and can change immediately.
- VAT reserve is optional planning math, not a tax-liability calculation.

When the official fee call fails, the UI shows the failure and links to the matching Amazon Revenue Calculator. It never silently substitutes a fabricated fee.

## Privacy and security

The extension has access only to the four supported Amazon marketplace families. Product research inputs and preferences stay in Chromium storage. It does not send product or company data to RizPoint or any third party. Requests go only to the Amazon marketplace already being researched and its matching Seller Central Revenue Calculator.

## Development

Requires Node.js 22+; there are no runtime dependencies.

```bash
npm test
npm run check
```

## Marketplace mapping

| Store        | Marketplace  | Currency | Official calculator host   |
| ------------ | ------------ | -------: | -------------------------- |
| amazon.com   | USA          |      USD | sellercentral.amazon.com   |
| amazon.co.uk | UK           |      GBP | sellercentral.amazon.co.uk |
| amazon.ae    | UAE          |      AED | sellercentral.amazon.ae    |
| amazon.sa    | Saudi Arabia |      SAR | sellercentral.amazon.sa    |
