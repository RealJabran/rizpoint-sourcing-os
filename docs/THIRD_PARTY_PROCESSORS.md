# Third-party processor register

Status: production providers not yet attested

Owner: RizPoint LLC security owner

Last reviewed: not yet completed for production
Review cadence: before production access changes and at least annually

This register covers any external party that hosts, stores, backs up, monitors, processes, or has infrastructure access to Amazon Information. It must describe the **actual** production deployment. A sample vendor name is not evidence and must not be entered until contracted and verified.

## Actual external processors

No production hosting, backup, monitoring, SIEM, endpoint-security, email, object-storage, or managed database provider has been attested in this repository. The operator must complete the table before answering that outside-party processing is controlled.

| Provider                  | Service                     | Purpose                   | Data categories         | Region/location                         | Security review date | Contract/DPA status               | Access type                                   | Annual review due |
| ------------------------- | --------------------------- | ------------------------- | ----------------------- | --------------------------------------- | -------------------- | --------------------------------- | --------------------------------------------- | ----------------- |
| _Operator entry required_ | _Actual contracted service_ | _Why access is necessary_ | _Use inventory classes_ | _Verified processing/storage locations_ | _YYYY-MM-DD_         | _Executed/pending/not applicable_ | _Logical/administrative/support/subprocessor_ | _YYYY-MM-DD_      |

## Internal deployment components (not external processors)

The supported architecture includes the RizPoint web and worker processes, PostgreSQL, Redis, private object storage, scanner, and ClamAV. They are systems in the trust boundary, not named third-party processors by themselves. A company operating a managed version of any component must be recorded above.

## Approval checklist

Before a processor can access Amazon Information, record:

1. necessity and least-privilege access;
2. data categories, region, transfers, and subprocessors;
3. security assessment and material findings;
4. contract/DPA and Amazon-policy obligations where applicable;
5. encryption, retention, deletion, incident-notification, and access-removal terms;
6. named control owner and annual review date;
7. exit/deletion evidence when service ends.

An annual `THIRD_PARTY_RISK_REVIEW` operational control record is required. Documentation alone is not completion evidence.
