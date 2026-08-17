import { NextRequest, NextResponse } from "next/server";
import {
  assessComplianceRisk,
  COMPLIANCE_RISK_DOMAINS,
  createComplianceRuleSetVersion,
  ensurePhaseZeroOrganization,
  listComplianceRiskWorkspace,
  type ComplianceRuleInput,
} from "@rizpoint/database";
import { requirePrivateAccess } from "@/src/private-access";

export const runtime = "nodejs";

function text(body: Record<string, unknown>, key: string) {
  return typeof body[key] === "string" ? body[key] : "";
}
function strings(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, 50)
    : [];
}
function date(value: unknown, code: string) {
  if (typeof value !== "string") throw new Error(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed;
}
function ruleInputs(value: unknown): ComplianceRuleInput[] {
  if (!Array.isArray(value)) throw new Error("COMPLIANCE_RULES_REQUIRED");
  const domains = new Set<string>(COMPLIANCE_RISK_DOMAINS);
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("COMPLIANCE_RULE_INVALID");
    const rule = raw as Record<string, unknown>;
    const domain = text(rule, "domain");
    const riskLevel = text(rule, "riskLevel");
    if (
      !domains.has(domain) ||
      !["LOW", "REVIEW", "HIGH", "UNKNOWN"].includes(riskLevel) ||
      typeof rule.authoritativeClearance !== "boolean"
    )
      throw new Error("COMPLIANCE_RULE_INVALID");
    return {
      domain: domain as ComplianceRuleInput["domain"],
      riskLevel: riskLevel as ComplianceRuleInput["riskLevel"],
      matchTerms: strings(rule.matchTerms),
      rationale: text(rule, "rationale"),
      supplierQuestions: strings(rule.supplierQuestions),
      likelyDocumentation: strings(rule.likelyDocumentation),
      authoritativeClearance: rule.authoritativeClearance,
      sourceTitle: text(rule, "sourceTitle"),
      sourceUrl: text(rule, "sourceUrl"),
      sourcePublishedAt: date(
        rule.sourcePublishedAt,
        "COMPLIANCE_RULE_SOURCE_DATE_INVALID",
      ),
    };
  });
}

export async function GET(request: NextRequest) {
  const denied = requirePrivateAccess(request);
  if (denied) return denied;
  const organization = await ensurePhaseZeroOrganization();
  try {
    return NextResponse.json(
      await listComplianceRiskWorkspace({
        organizationId: organization.id,
        ...(request.nextUrl.searchParams.get("projectId")
          ? { projectId: request.nextUrl.searchParams.get("projectId")! }
          : {}),
        ...(request.nextUrl.searchParams.get("marketplaceId")
          ? {
              marketplaceId: request.nextUrl.searchParams.get("marketplaceId")!,
            }
          : {}),
        ...(request.nextUrl.searchParams.get("jurisdiction")
          ? { jurisdiction: request.nextUrl.searchParams.get("jurisdiction")! }
          : {}),
      }),
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "COMPLIANCE_RISK_UNAVAILABLE",
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
    if (body.action === "CREATE_RULESET_VERSION") {
      return NextResponse.json(
        await createComplianceRuleSetVersion({
          organizationId: organization.id,
          marketplaceId: text(body, "marketplaceId"),
          jurisdiction: text(body, "jurisdiction"),
          name: text(body, "name"),
          version: text(body, "version"),
          sourceTitle: text(body, "sourceTitle"),
          sourceUrl: text(body, "sourceUrl"),
          sourcePublishedAt: date(
            body.sourcePublishedAt,
            "COMPLIANCE_RULESET_SOURCE_DATE_INVALID",
          ),
          sourceAccessedAt: date(
            body.sourceAccessedAt,
            "COMPLIANCE_RULESET_ACCESS_DATE_INVALID",
          ),
          rules: ruleInputs(body.rules),
        }),
      );
    }
    if (body.action === "ASSESS") {
      const projectId = text(body, "projectId");
      const ruleSetId = text(body, "ruleSetId");
      const jurisdiction = text(body, "jurisdiction");
      if (!projectId || !ruleSetId || !jurisdiction)
        throw new Error("COMPLIANCE_ASSESSMENT_FIELDS_REQUIRED");
      return NextResponse.json(
        await assessComplianceRisk({
          organizationId: organization.id,
          projectId,
          ruleSetId,
          jurisdiction,
          ...(text(body, "catalogProductId")
            ? { catalogProductId: text(body, "catalogProductId") }
            : {}),
          ...(text(body, "additionalProductText")
            ? { additionalProductText: text(body, "additionalProductText") }
            : {}),
        }),
      );
    }
    throw new Error("COMPLIANCE_RISK_ACTION_INVALID");
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "COMPLIANCE_RISK_FAILED",
      },
      { status: 400 },
    );
  }
}
