import {
  calculatePrivateLabelScenario,
  PRIVATE_LABEL_ENGINE_VERSION,
  stressPrivateLabelScenario,
  type PrivateLabelScenarioInput,
  type PrivateLabelScenarioOutput,
} from "@rizpoint/profit-engine";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

export type PrivateLabelStressInput = {
  name: string;
  priceChangePercent: string;
  costChangePercent: string;
};

function resultData(input: {
  organizationId: string;
  kind: "BASE" | "STRESS";
  stressName: string;
  result: PrivateLabelScenarioOutput;
  snapshot: Prisma.InputJsonValue;
  calculatedAt: Date;
}) {
  const output = input.result;
  return {
    organizationId: input.organizationId,
    kind: input.kind,
    stressName: input.stressName,
    status: output.status,
    formulaVersion: output.formulaVersion,
    currency: output.currency,
    ...(output.landedCostPerUnit
      ? { landedCostPerUnit: output.landedCostPerUnit }
      : {}),
    ...(output.contributionMarginPerUnit
      ? { contributionMarginPerUnit: output.contributionMarginPerUnit }
      : {}),
    ...(output.netProfitPerUnit
      ? { netProfitPerUnit: output.netProfitPerUnit }
      : {}),
    ...(output.roiPercent ? { roiPercent: output.roiPercent } : {}),
    ...(output.marginPercent ? { marginPercent: output.marginPercent } : {}),
    ...(output.breakEvenSalePrice
      ? { breakEvenSalePrice: output.breakEvenSalePrice }
      : {}),
    ...(output.breakEvenAdSpendPerUnit
      ? { breakEvenAdSpendPerUnit: output.breakEvenAdSpendPerUnit }
      : {}),
    ...(output.breakEvenAcosPercent
      ? { breakEvenAcosPercent: output.breakEvenAcosPercent }
      : {}),
    ...(output.initialCashRequired
      ? { initialCashRequired: output.initialCashRequired }
      : {}),
    ...(output.moqCashExposure
      ? { moqCashExposure: output.moqCashExposure }
      : {}),
    waterfall: (output.waterfall ?? []) as Prisma.InputJsonValue,
    uncertainCosts: output.uncertainCosts as Prisma.InputJsonValue,
    reasonCodes: output.reasonCodes as Prisma.InputJsonValue,
    inputSnapshot: input.snapshot,
    calculatedAt: input.calculatedAt,
  };
}

export async function createPrivateLabelQuoteScenario(input: {
  organizationId: string;
  projectId: string;
  name: string;
  targetPriceSource: string;
  targetPriceAssumedAt: Date;
  scenario: PrivateLabelScenarioInput;
  stresses?: PrivateLabelStressInput[] | undefined;
}) {
  if (!input.name.trim() || !input.targetPriceSource.trim())
    throw new Error("SCENARIO_NAME_AND_PRICE_SOURCE_REQUIRED");
  const baseResult = calculatePrivateLabelScenario(input.scenario);
  if (baseResult.status === "BLOCKED_INVALID_INPUT")
    throw new Error(baseResult.reasonCodes[0] ?? "INVALID_SCENARIO_INPUT");
  if (
    baseResult.status === "BLOCKED_MISSING_COST" &&
    baseResult.reasonCodes.some((code) => code.startsWith("MISSING_"))
  )
    throw new Error("COMPLETE_COST_REGISTER_REQUIRED");
  if (Number.isNaN(input.targetPriceAssumedAt.getTime()))
    throw new Error("TARGET_PRICE_DATE_INVALID");
  const stresses = (input.stresses ?? []).slice(0, 10).map((stress) => {
    if (!stress.name.trim()) throw new Error("STRESS_NAME_REQUIRED");
    return stressPrivateLabelScenario(input.scenario, stress);
  });
  return db.$transaction(async (transaction) => {
    const project = await transaction.researchProject.findFirst({
      where: {
        id: input.projectId,
        organizationId: input.organizationId,
        mode: "PRIVATE_LABEL",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!project) throw new Error("ACTIVE_PRIVATE_LABEL_PROJECT_REQUIRED");
    const latest = await transaction.privateLabelQuoteScenario.aggregate({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        name: input.name.trim(),
      },
      _max: { version: true },
    });
    const calculatedAt = new Date();
    const snapshot = input.scenario as unknown as Prisma.InputJsonValue;
    return transaction.privateLabelQuoteScenario.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        name: input.name.trim(),
        version: (latest._max.version ?? 0) + 1,
        incoterm: input.scenario.incoterm,
        supplierCurrency: input.scenario.supplierCurrency,
        analysisCurrency: input.scenario.analysisCurrency,
        unitCost: input.scenario.unitCost,
        unitCostSource: input.scenario.unitCostSource,
        unitCostAssumedAt: new Date(input.scenario.unitCostAssumedAt),
        moq: input.scenario.moq,
        targetSellingPrice: input.scenario.targetSellingPrice,
        targetPriceSource: input.targetPriceSource.trim(),
        targetPriceAssumedAt: input.targetPriceAssumedAt,
        ...(input.scenario.fxObservation
          ? {
              fxRate: input.scenario.fxObservation.rate,
              fxSource: input.scenario.fxObservation.source,
              fxObservedAt: new Date(input.scenario.fxObservation.observedAt),
            }
          : {}),
        formulaVersion: PRIVATE_LABEL_ENGINE_VERSION,
        costs: {
          create: input.scenario.costs.map((cost) => ({
            organizationId: input.organizationId,
            category: cost.category,
            allocation: cost.allocation,
            amount: cost.amount ?? null,
            currency: cost.currency,
            source: cost.source,
            assumedAt: new Date(cost.assumedAt),
            confidence: cost.confidence,
          })),
        },
        results: {
          create: [
            resultData({
              organizationId: input.organizationId,
              kind: "BASE",
              stressName: "BASE",
              result: baseResult,
              snapshot,
              calculatedAt,
            }),
            ...stresses.map((stress, index) =>
              resultData({
                organizationId: input.organizationId,
                kind: "STRESS",
                stressName: stress.name.trim(),
                result: stress.result,
                snapshot: {
                  base: snapshot,
                  stress: input.stresses![index],
                } as Prisma.InputJsonValue,
                calculatedAt,
              }),
            ),
          ],
        },
      },
      include: {
        costs: { orderBy: { category: "asc" } },
        results: { orderBy: [{ kind: "asc" }, { stressName: "asc" }] },
      },
    });
  });
}

export async function listPrivateLabelQuoteScenarios(input: {
  organizationId: string;
  projectId: string;
}) {
  const project = await db.researchProject.findFirst({
    where: {
      id: input.projectId,
      organizationId: input.organizationId,
      mode: "PRIVATE_LABEL",
    },
    select: { id: true, name: true, marketplaceId: true },
  });
  if (!project) throw new Error("PRIVATE_LABEL_PROJECT_NOT_FOUND");
  const scenarios = await db.privateLabelQuoteScenario.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
    },
    include: {
      costs: { orderBy: { category: "asc" } },
      results: { orderBy: [{ kind: "asc" }, { stressName: "asc" }] },
    },
    orderBy: [{ name: "asc" }, { version: "desc" }],
    take: 100,
  });
  return { project, scenarios };
}
