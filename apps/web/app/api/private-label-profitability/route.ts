import { NextRequest, NextResponse } from "next/server";
import {
  createPrivateLabelQuoteScenario,
  ensurePhaseZeroOrganization,
  listPrivateLabelQuoteScenarios,
} from "@rizpoint/database";
import {
  PRIVATE_LABEL_COST_CATEGORIES,
  type PrivateLabelCostInput,
} from "@rizpoint/profit-engine";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";
const allocations = new Set(["PER_UNIT", "BATCH_TOTAL", "PERCENT_OF_PRICE"]);
const confidences = new Set(["CONFIRMED", "ESTIMATED", "UNKNOWN"]);
function text(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? body[key] : "";
}
function date(value: string, code: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed;
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
      await listPrivateLabelQuoteScenarios({
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
            : "PRIVATE_LABEL_SCENARIOS_UNAVAILABLE",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const body = (await request.json()) as Record<string, unknown>;
  const organization = await ensurePhaseZeroOrganization();
  try {
    const rawCosts = Array.isArray(body.costs) ? body.costs : [];
    const costs: PrivateLabelCostInput[] = rawCosts.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("COST_ASSUMPTION_INVALID");
      const cost = raw as Record<string, unknown>;
      if (
        typeof cost.category !== "string" ||
        !PRIVATE_LABEL_COST_CATEGORIES.includes(
          cost.category as (typeof PRIVATE_LABEL_COST_CATEGORIES)[number],
        ) ||
        typeof cost.allocation !== "string" ||
        !allocations.has(cost.allocation) ||
        typeof cost.confidence !== "string" ||
        !confidences.has(cost.confidence) ||
        typeof cost.currency !== "string" ||
        typeof cost.source !== "string" ||
        typeof cost.assumedAt !== "string"
      )
        throw new Error("COST_ASSUMPTION_INVALID");
      return {
        category:
          cost.category as (typeof PRIVATE_LABEL_COST_CATEGORIES)[number],
        allocation: cost.allocation as PrivateLabelCostInput["allocation"],
        ...(typeof cost.amount === "string" && cost.amount.trim()
          ? { amount: cost.amount }
          : {}),
        currency: cost.currency,
        source: cost.source,
        assumedAt: cost.assumedAt,
        confidence: cost.confidence as PrivateLabelCostInput["confidence"],
      };
    });
    const supplierCurrency = text(body, "supplierCurrency").toUpperCase();
    const analysisCurrency = text(body, "analysisCurrency").toUpperCase();
    const fxRate = text(body, "fxRate");
    const scenario = await createPrivateLabelQuoteScenario({
      organizationId: organization.id,
      projectId: text(body, "projectId"),
      name: text(body, "name"),
      targetPriceSource: text(body, "targetPriceSource"),
      targetPriceAssumedAt: date(
        text(body, "targetPriceAssumedAt"),
        "TARGET_PRICE_DATE_INVALID",
      ),
      scenario: {
        incoterm:
          body.incoterm === "EXW" ||
          body.incoterm === "FOB" ||
          body.incoterm === "DDP"
            ? body.incoterm
            : "FOB",
        supplierCurrency,
        analysisCurrency,
        unitCost: text(body, "unitCost"),
        moq: typeof body.moq === "number" ? body.moq : Number.NaN,
        targetSellingPrice: text(body, "targetSellingPrice"),
        unitCostSource: text(body, "unitCostSource"),
        unitCostAssumedAt: text(body, "unitCostAssumedAt"),
        costs,
        ...(supplierCurrency !== analysisCurrency
          ? {
              fxObservation: {
                fromCurrency: supplierCurrency,
                toCurrency: analysisCurrency,
                rate: fxRate,
                source: text(body, "fxSource"),
                observedAt: text(body, "fxObservedAt"),
              },
            }
          : {}),
      },
      stresses: [
        {
          name: "Selling price -10%",
          priceChangePercent: "-10",
          costChangePercent: "0",
        },
        {
          name: "Costs +10%",
          priceChangePercent: "0",
          costChangePercent: "10",
        },
        {
          name: "Price -10% / costs +10%",
          priceChangePercent: "-10",
          costChangePercent: "10",
        },
      ],
    });
    return NextResponse.json(scenario);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "PRIVATE_LABEL_SCENARIO_FAILED",
      },
      { status: 400 },
    );
  }
}
