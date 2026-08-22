import {
  assertLiveValidationOptIn,
  parseLiveValidationArguments,
  probeAmazonCapabilities,
} from "@rizpoint/amazon-sp-api";
import {
  db,
  getAmazonIntegrationStatus,
  resolveLiveAmazonConnection,
  upsertProviderEntitlement,
} from "@rizpoint/database";
import { ProviderError } from "@rizpoint/provider-contracts";
import { createEnrichmentProvider } from "../apps/worker/src/enrichment-provider.js";

function fallbackCurrency(marketplaceId: string) {
  return (
    {
      ATVPDKIKX0DER: "USD",
      A2EUQ1WTGCTBG2: "CAD",
      A1F83G8C2ARO7P: "GBP",
      A1PA6795UKMFR9: "EUR",
    }[marketplaceId] ?? "USD"
  );
}

async function main() {
  assertLiveValidationOptIn();
  const arguments_ = parseLiveValidationArguments(process.argv.slice(2));
  const organizationSlug =
    process.env.RIZPOINT_PRIVATE_ORGANIZATION_SLUG?.trim();
  if (!organizationSlug) throw new ProviderError("INVALID_REQUEST");
  const organization = await db.organization.findUnique({
    where: { slug: organizationSlug },
    select: { id: true },
  });
  if (!organization) throw new ProviderError("NOT_FOUND");
  const status = await getAmazonIntegrationStatus(organization.id);
  const marketplace = status?.marketplaces.find(
    (item) => item.isDefault && item.isParticipating,
  );
  if (!status || !marketplace) throw new ProviderError("UNAUTHORIZED");
  const connection = await resolveLiveAmazonConnection({
    organizationId: organization.id,
    marketplaceId: marketplace.marketplaceId,
  });
  if (!connection) throw new ProviderError("UNAUTHORIZED");
  const bundle = createEnrichmentProvider({
    ...connection,
    marketplaceId: marketplace.marketplaceId,
  });
  const health = await bundle.provider.health(bundle.marketplace);
  const report = await probeAmazonCapabilities({
    provider: bundle.provider,
    marketplace: bundle.marketplace,
    asins: arguments_.asins,
    feePrice: arguments_.price,
    currency:
      arguments_.currency ??
      marketplace.defaultCurrencyCode ??
      fallbackCurrency(marketplace.marketplaceId),
  });
  for (const capability of report.capabilities)
    await upsertProviderEntitlement({
      organizationId: organization.id,
      providerConnectionId: connection.id,
      providerKey: "amazon-sp-api",
      marketplaceId: marketplace.marketplaceId,
      capability: capability.capability,
      mode: "LIVE",
      state: capability.state,
      ...(capability.reason ? { reason: capability.reason } : {}),
      completeness: capability.completeness,
      checkedAt: new Date(capability.checkedAt),
      ...(capability.retryAt ? { retryAt: new Date(capability.retryAt) } : {}),
    });
  process.stdout.write(
    `${JSON.stringify(
      {
        reportVersion: report.reportVersion,
        source: "amazon-sp-api",
        dataOrigin: "LIVE_AMAZON",
        marketplaceId: report.marketplaceId,
        checkedAt: report.checkedAt,
        marketplaceParticipation: {
          state: health.status,
          checkedAt: health.checkedAt,
        },
        probeAsinCount: report.probeAsinCount,
        capabilities: report.capabilities,
        operations: report.operations,
      },
      null,
      2,
    )}\n`,
  );
}

main()
  .catch((error: unknown) => {
    const code =
      error instanceof ProviderError ? error.code : "VALIDATION_FAILED";
    process.stderr.write(`SP_API_LIVE_VALIDATION_ERROR=${code}\n`);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
