# Provider data-rights matrix

Last reviewed: 2026-08-20

This matrix is an operational control, not a legal interpretation. A provider
contract must be reviewed by an authorized person before live use. Unknown
rights remain internal-only and non-exportable.

## Runtime policy fields

Each organization/provider/marketplace/capability entitlement stores:

- operational mode/state, completeness, checked/expiry/retry times;
- `dataUsageScope`: `INTERNAL_ONLY` or `REDISTRIBUTABLE`;
- `exportPolicy`: `BLOCK`, `ALLOW`, or `FIELD_ALLOWLIST`;
- exact normalized export field names for an allowlist;
- contractual retention days;
- terms reference, version, review date, effective date, and optional expiry.

The database defaults to `INTERNAL_ONLY` and `BLOCK`. A constraint prevents an
allowing policy without redistributable scope, a retention period, terms
metadata, and an effective date. Expired or not-yet-effective rights fail
closed. Policy updates are organization-scoped and write a workflow audit
event. Raw provider payloads are never an exportable field.

## Current provider matrix

| Provider/source                                          | Capabilities in this repository                        | Runtime origin                           | Default usage/export                                                                            | Retention                              | Notes                                                              |
| -------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Amazon SP-API                                            | Catalog, offers, fees, restrictions                    | Live, account-authorized                 | Internal-only / blocked until current Amazon terms and account rights are reviewed and recorded | Must be configured from reviewed terms | First-party account access is not a blanket redistribution license |
| Keepa                                                    | Market history                                         | Optional live licensed provider          | Internal-only / blocked until the customer's licensed plan is reviewed and recorded             | Required before ingestion              | No credential or guessed rights are bundled                        |
| Mock Amazon                                              | Catalog, offers, fees, restrictions                    | Mock                                     | Redistributable synthetic fixture / allowed                                                     | 730 days                               | Test/demo data only; always labeled mock                           |
| Recorded history                                         | Market history                                         | Mock/recorded                            | Redistributable synthetic fixture / allowed                                                     | 730 days                               | Redacted deterministic fixtures only; never shown as live          |
| User-imported supplier data                              | Supplier facts/costs                                   | User supplied                            | Tenant-controlled                                                                               | Per tenant privacy/retention policy    | Provider entitlement does not apply, but confidentiality does      |
| User-imported/licensed reviews                           | Review intelligence                                    | User supplied or future licensed adapter | Tenant-controlled for user data; future provider defaults blocked                               | Source-specific                        | Review PII is minimized; evidence references remain private        |
| Keyword/rank/advertising/brand/seller/category providers | Contracts and capability states only unless configured | Not configured                           | Internal-only / blocked                                                                         | Not configured                         | UI remains unsupported/partial; no live metrics are fabricated     |

## Export enforcement

Product Explorer resolves rights once per distinct provider, marketplace, and
capability in the requested server window. It exports tenant-owned universe
labels but replaces blocked provider-derived cells with empty values and adds
an `Export rights` decision column. A field allowlist can permit, for example,
`history.rating` while blocking `history.salesRank`. Missing, expired, future,
or internal-only rights are not treated as permission.

Wholesale analysis, shortlist, purchase-order, and audit exports also resolve
the exact catalog/pricing/fee/restriction capabilities used by their rows.
Because their deterministic financial outputs combine those inputs, they fail
the export job with `PROVIDER_EXPORT_RIGHTS_BLOCKED` if any required field is
blocked rather than emitting a misleading partial financial report. All
exporters exclude raw payloads and secrets. Copying a provider value into a
derived table does not bypass this rule.

## Administration procedure

1. Identify the organization, exact provider, marketplace, and capability.
2. Review the current signed terms/plan and record a non-secret reference and
   version; never upload credentials or the full confidential contract here.
3. Set the shortest applicable retention period and explicit effective/expiry
   dates.
4. Prefer `FIELD_ALLOWLIST`. Use `ALLOW` only when every normalized field for
   that capability is affirmatively redistributable.
5. Verify a blocked and allowed export fixture, then enable live collection.
6. On expiry or contract change, set `BLOCK` first, review, then issue a new
   version. Retention workers remove expired evidence under the approved mode.
