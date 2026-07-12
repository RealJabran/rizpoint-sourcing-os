# Matching policy

Matching is a cascade: supplied ASIN, exact GTIN, MPN plus brand, then normalized title search. Candidate scoring records independent evidence for identifiers, brand, model, size, pack/count, variation, and title similarity.

A candidate can be auto-accepted only with a qualifying score and no brand, model, size, or pack contradiction. Any contradiction requires human review. Unknown pack relationships produce `BLOCKED_PACK_UNCERTAIN` for profitability.

Phase 0 contains only contract and state boundaries; it does not match catalog rows.
