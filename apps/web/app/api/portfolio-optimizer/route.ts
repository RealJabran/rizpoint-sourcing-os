import { NextRequest, NextResponse } from "next/server";
import {
  createPortfolioOptimization,
  ensurePhaseZeroOrganization,
  listPortfolioOptimizations,
  type ComplianceRisk,
  type PortfolioCandidateInput,
  type PortfolioConstraints,
  type PortfolioStressAssumptions,
  type RiskBand,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

const riskBands = new Set<RiskBand>(["LOW", "MEDIUM", "HIGH"]);
const complianceRisks = new Set<ComplianceRisk>([
  "LOW",
  "REVIEW",
  "HIGH",
  "UNKNOWN",
]);
function text(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? body[key] : "";
}
function integer(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "number" && Number.isSafeInteger(body[key])
    ? body[key]
    : Number.NaN;
}
function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 50)
    : [];
}
function riskBand(body: Record<string, unknown>, key: string): RiskBand {
  const value = text(body, key) as RiskBand;
  if (!riskBands.has(value)) throw new Error(`INVALID_${key.toUpperCase()}`);
  return value;
}
function complianceRisk(
  body: Record<string, unknown>,
  key: string,
): ComplianceRisk {
  const value = text(body, key) as ComplianceRisk;
  if (!complianceRisks.has(value))
    throw new Error(`INVALID_${key.toUpperCase()}`);
  return value;
}
function candidates(value: unknown): PortfolioCandidateInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 24)
    throw new Error("PORTFOLIO_CANDIDATES_INVALID");
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("PORTFOLIO_CANDIDATE_INVALID");
    const item = raw as Record<string, unknown>;
    return {
      id: text(item, "id"),
      catalogProductId: text(item, "catalogProductId"),
      asin: text(item, "asin"),
      brand: text(item, "brand"),
      category: text(item, "category"),
      currency: text(item, "currency").toUpperCase(),
      unitCost: text(item, "unitCost"),
      sellingPrice: text(item, "sellingPrice"),
      feePerUnit: text(item, "feePerUnit"),
      adCostPerUnit: text(item, "adCostPerUnit"),
      moq: integer(item, "moq"),
      casePack: integer(item, "casePack"),
      expectedMonthlyDemandLow: text(item, "expectedMonthlyDemandLow"),
      expectedMonthlyDemandHigh: text(item, "expectedMonthlyDemandHigh"),
      netProfitPerUnitLow: text(item, "netProfitPerUnitLow"),
      netProfitPerUnitHigh: text(item, "netProfitPerUnitHigh"),
      leadTimeDays: integer(item, "leadTimeDays"),
      marginPercent: text(item, "marginPercent"),
      roiPercent: text(item, "roiPercent"),
      confidencePercent: text(item, "confidencePercent"),
      seasonalityRisk: riskBand(item, "seasonalityRisk"),
      complianceRisk: complianceRisk(item, "complianceRisk"),
      priceVolatilityPercent: text(item, "priceVolatilityPercent"),
      competitionRisk: riskBand(item, "competitionRisk"),
      targetInventoryDays: integer(item, "targetInventoryDays"),
      observedAt: text(item, "observedAt"),
      evidenceReferences: stringArray(item.evidenceReferences),
    };
  });
}

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const projectId = request.nextUrl.searchParams.get("projectId");
  if (!projectId)
    return NextResponse.json({ error: "PROJECT_ID_REQUIRED" }, { status: 400 });
  const organization = await ensurePhaseZeroOrganization();
  try {
    return NextResponse.json(
      await listPortfolioOptimizations({
        organizationId: organization.id,
        projectId,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PORTFOLIO_OPTIMIZATIONS_UNAVAILABLE",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  const body = (await request.json()) as Record<string, unknown>;
  try {
    const rawConstraints =
      body.constraints &&
      typeof body.constraints === "object" &&
      !Array.isArray(body.constraints)
        ? (body.constraints as Record<string, unknown>)
        : {};
    const rawStress =
      body.stressAssumptions &&
      typeof body.stressAssumptions === "object" &&
      !Array.isArray(body.stressAssumptions)
        ? (body.stressAssumptions as Record<string, unknown>)
        : {};
    const allowedComplianceRisks = stringArray(
      rawConstraints.allowedComplianceRisks,
    ).filter((value): value is ComplianceRisk =>
      complianceRisks.has(value as ComplianceRisk),
    );
    const constraints: PortfolioConstraints = {
      cashBudget: text(rawConstraints, "cashBudget"),
      currency: text(rawConstraints, "currency").toUpperCase(),
      maxAsinExposurePercent: text(rawConstraints, "maxAsinExposurePercent"),
      maxBrandExposurePercent: text(rawConstraints, "maxBrandExposurePercent"),
      maxCategoryExposurePercent: text(
        rawConstraints,
        "maxCategoryExposurePercent",
      ),
      minMarginPercent: text(rawConstraints, "minMarginPercent"),
      minRoiPercent: text(rawConstraints, "minRoiPercent"),
      minConfidencePercent: text(rawConstraints, "minConfidencePercent"),
      maxPriceVolatilityPercent: text(
        rawConstraints,
        "maxPriceVolatilityPercent",
      ),
      allowedComplianceRisks,
      maxSeasonalityRisk: riskBand(rawConstraints, "maxSeasonalityRisk"),
      maxCompetitionRisk: riskBand(rawConstraints, "maxCompetitionRisk"),
      ...(Number.isSafeInteger(rawConstraints.maxSearchNodes)
        ? { maxSearchNodes: rawConstraints.maxSearchNodes as number }
        : {}),
    };
    const stressAssumptions: PortfolioStressAssumptions = {
      demandDecreasePercent: text(rawStress, "demandDecreasePercent"),
      priceDecreasePercent: text(rawStress, "priceDecreasePercent"),
      feeIncreasePercent: text(rawStress, "feeIncreasePercent"),
      replenishmentDelayDays: integer(rawStress, "replenishmentDelayDays"),
      adCostIncreasePercent: text(rawStress, "adCostIncreasePercent"),
    };
    return NextResponse.json(
      await createPortfolioOptimization({
        organizationId: organization.id,
        projectId: text(body, "projectId"),
        name: text(body, "name"),
        candidates: candidates(body.candidates),
        constraints,
        stressAssumptions,
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PORTFOLIO_OPTIMIZATION_FAILED",
      },
      { status: 400 },
    );
  }
}
