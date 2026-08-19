import { createHash } from "node:crypto";
import {
  optimizePortfolio,
  type PortfolioCandidateInput,
  type PortfolioConstraints,
  type PortfolioOptimizationOutput,
  type PortfolioScenarioOutput,
  type PortfolioSolution,
  type PortfolioStressAssumptions,
} from "@rizpoint/portfolio-optimizer";
import { Prisma } from "../generated/prisma/client.js";
import { db } from "../client.js";

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  return value;
}

function inputHash(input: {
  candidates: readonly PortfolioCandidateInput[];
  constraints: PortfolioConstraints;
  stressAssumptions?: PortfolioStressAssumptions | undefined;
}) {
  const canonical = {
    candidates: [...input.candidates].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    constraints: input.constraints,
    stressAssumptions: input.stressAssumptions ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(stable(canonical)))
    .digest("hex");
}

function solutionData(input: {
  organizationId: string;
  scenario: PortfolioScenarioOutput;
  solution: PortfolioSolution;
}) {
  const { scenario, solution } = input;
  return {
    organizationId: input.organizationId,
    scenario: scenario.scenario,
    rank: solution.rank,
    status: scenario.status,
    exactOptimal: scenario.exactOptimal,
    searchNodes: scenario.searchNodes,
    cashUsed: solution.cashUsed,
    cashRemaining: solution.cashRemaining,
    expectedProfitLow: solution.expectedProfitLow,
    expectedProfitHigh: solution.expectedProfitHigh,
    productCount: solution.productCount,
    diversificationScore: solution.diversificationScore,
    riskConcentration:
      solution.riskConcentration as unknown as Prisma.InputJsonValue,
    constraintAudit:
      solution.constraintAudit as unknown as Prisma.InputJsonValue,
    excludedProducts:
      solution.excludedProducts as unknown as Prisma.InputJsonValue,
    assumptions: scenario.assumptions as Prisma.InputJsonValue,
    reasonCodes: scenario.reasonCodes as unknown as Prisma.InputJsonValue,
    allocations: {
      create: solution.allocations.map((allocation) => ({
        organizationId: input.organizationId,
        catalogProductId: allocation.catalogProductId,
        candidateKey: allocation.candidateId,
        asin: allocation.asin,
        brand: allocation.brand,
        category: allocation.category,
        quantity: allocation.quantity,
        casePack: allocation.casePack,
        moq: allocation.moq,
        unitCost: allocation.unitCost,
        cashAllocated: allocation.cashAllocated,
        expectedProfitLow: allocation.expectedProfitLow,
        expectedProfitHigh: allocation.expectedProfitHigh,
        expectedUnitsSoldLow: allocation.expectedUnitsSoldLow,
        expectedUnitsSoldHigh: allocation.expectedUnitsSoldHigh,
        coverageDays: allocation.coverageDays,
        evidenceReferences:
          allocation.evidenceReferences as unknown as Prisma.InputJsonValue,
      })),
    },
  };
}

function scenarioData(input: {
  organizationId: string;
  scenario: PortfolioScenarioOutput;
}) {
  const portfolios = [
    ...(input.scenario.recommended ? [input.scenario.recommended] : []),
    ...input.scenario.alternatives,
  ];
  if (portfolios.length)
    return portfolios.map((solution) => solutionData({ ...input, solution }));
  return [
    {
      organizationId: input.organizationId,
      scenario: input.scenario.scenario,
      rank: 0,
      status: input.scenario.status,
      exactOptimal: input.scenario.exactOptimal,
      searchNodes: input.scenario.searchNodes,
      riskConcentration: {} as Prisma.InputJsonValue,
      constraintAudit: [] as Prisma.InputJsonValue,
      excludedProducts: [] as Prisma.InputJsonValue,
      assumptions: input.scenario.assumptions as Prisma.InputJsonValue,
      reasonCodes: input.scenario
        .reasonCodes as unknown as Prisma.InputJsonValue,
    },
  ];
}

export async function createPortfolioOptimization(input: {
  organizationId: string;
  projectId: string;
  name: string;
  candidates: readonly PortfolioCandidateInput[];
  constraints: PortfolioConstraints;
  stressAssumptions?: PortfolioStressAssumptions | undefined;
}) {
  if (!input.name.trim()) throw new Error("PORTFOLIO_NAME_REQUIRED");
  const project = await db.researchProject.findFirst({
    where: {
      id: input.projectId,
      organizationId: input.organizationId,
      status: "ACTIVE",
    },
    select: { id: true, marketplaceId: true },
  });
  if (!project) throw new Error("ACTIVE_RESEARCH_PROJECT_REQUIRED");
  const productIds = input.candidates.map(
    (candidate) => candidate.catalogProductId,
  );
  if (new Set(productIds).size !== productIds.length)
    throw new Error("DUPLICATE_CATALOG_PRODUCT_CANDIDATE");
  const projectProducts = await db.researchProjectItem.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      catalogProductId: { in: productIds },
    },
    select: {
      catalogProductId: true,
      catalogProduct: { select: { asin: true } },
    },
  });
  const byProduct = new Map(
    projectProducts.map((item) => [item.catalogProductId, item.catalogProduct]),
  );
  for (const candidate of input.candidates) {
    const product = byProduct.get(candidate.catalogProductId);
    if (!product) throw new Error("PORTFOLIO_PRODUCT_NOT_IN_PROJECT");
    if (
      product.asin &&
      product.asin.toLocaleUpperCase() !== candidate.asin.toLocaleUpperCase()
    )
      throw new Error("PORTFOLIO_ASIN_PRODUCT_MISMATCH");
  }
  const output = optimizePortfolio({
    candidates: input.candidates,
    constraints: input.constraints,
    ...(input.stressAssumptions
      ? { stressAssumptions: input.stressAssumptions }
      : {}),
  });
  if (output.status === "INVALID_INPUT")
    throw new Error(output.reasonCodes[0] ?? "PORTFOLIO_INPUT_INVALID");
  const fingerprint = inputHash(input);
  const calculatedAt = new Date();
  return db.portfolioOptimizationRun.upsert({
    where: {
      organizationId_projectId_inputHash: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        inputHash: fingerprint,
      },
    },
    update: {},
    create: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name.trim(),
      status: output.status,
      solverVersion: output.solverVersion,
      inputHash: fingerprint,
      currency: output.currency,
      cashBudget: input.constraints.cashBudget,
      constraints: input.constraints as unknown as Prisma.InputJsonValue,
      stressAssumptions: (input.stressAssumptions ?? {
        demandDecreasePercent: "20",
        priceDecreasePercent: "10",
        feeIncreasePercent: "5",
        replenishmentDelayDays: 30,
        adCostIncreasePercent: "20",
      }) as Prisma.InputJsonValue,
      inputSnapshot: {
        candidates: input.candidates,
        marketplaceId: project.marketplaceId,
      } as unknown as Prisma.InputJsonValue,
      reasonCodes: output.reasonCodes as unknown as Prisma.InputJsonValue,
      calculatedAt,
      results: {
        create: output.scenarios.flatMap((scenario) =>
          scenarioData({ organizationId: input.organizationId, scenario }),
        ),
      },
    },
    include: {
      results: {
        include: { allocations: { orderBy: { candidateKey: "asc" } } },
        orderBy: [{ scenario: "asc" }, { rank: "asc" }],
      },
    },
  });
}

export async function listPortfolioOptimizations(input: {
  organizationId: string;
  projectId: string;
}) {
  const project = await db.researchProject.findFirst({
    where: { id: input.projectId, organizationId: input.organizationId },
    select: { id: true, name: true, marketplaceId: true },
  });
  if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
  const runs = await db.portfolioOptimizationRun.findMany({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
    },
    include: {
      results: {
        include: { allocations: { orderBy: { candidateKey: "asc" } } },
        orderBy: [{ scenario: "asc" }, { rank: "asc" }],
      },
    },
    orderBy: { calculatedAt: "desc" },
    take: 25,
  });
  return { project, runs };
}

export type PortfolioOptimizationEngineOutput = PortfolioOptimizationOutput;
