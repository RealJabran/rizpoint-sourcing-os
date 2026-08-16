import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { db } from "../client.js";
import type {
  AddResearchProjectItemInput,
  AppendHistoricalMetricPointInput,
  AppendKeywordObservationInput,
  RecordHistoryObservationInput,
  CreateAlertRuleInput,
  CreateHistoricalMetricSeriesInput,
  CreateKeywordInput,
  CreateMarketDefinitionInput,
  CreateResearchProjectInput,
  RecordOpportunityAssessmentInput,
  ResearchRepositoryContract,
} from "../research-contracts.js";

type ResearchDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "researchProject"
  | "catalogProduct"
  | "keyword"
  | "marketDefinition"
  | "researchProjectItem"
  | "researchObservation"
  | "historicalMetricSeries"
  | "historicalMetricPoint"
  | "opportunityAssessment"
  | "opportunityReason"
  | "alertRule"
>;

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function normalizeResearchPhrase(value: string): string {
  return requiredText(value, "KEYWORD_PHRASE_REQUIRED")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ");
}

function assertProjectItemShape(input: AddResearchProjectItemInput): void {
  const references = [
    input.catalogProductId,
    input.marketDefinitionId,
    input.keywordId,
  ].filter(Boolean).length;
  const expected =
    input.kind === "PRODUCT"
      ? input.catalogProductId
      : input.kind === "MARKET"
        ? input.marketDefinitionId
        : input.kind === "KEYWORD"
          ? input.keywordId
          : references === 0;
  if (
    !expected ||
    (references !== 1 && !["CATEGORY", "BRAND", "SELLER"].includes(input.kind))
  )
    throw new Error("RESEARCH_ITEM_SUBJECT_INVALID");
}

function pointValueData(
  value: AppendHistoricalMetricPointInput["value"],
): Pick<
  Prisma.HistoricalMetricPointUncheckedCreateInput,
  "decimalValue" | "integerValue" | "booleanValue" | "textValue"
> {
  if ("decimalValue" in value) return { decimalValue: value.decimalValue };
  if ("integerValue" in value)
    return { integerValue: BigInt(value.integerValue) };
  if ("booleanValue" in value) return { booleanValue: value.booleanValue };
  return { textValue: value.textValue };
}

function pointMatchesValue(
  point: {
    decimalValue: { toString(): string } | null;
    integerValue: bigint | null;
    booleanValue: boolean | null;
    textValue: string | null;
  },
  value: AppendHistoricalMetricPointInput["value"],
): boolean {
  if ("decimalValue" in value)
    return (
      point.decimalValue !== null &&
      canonicalDecimalText(point.decimalValue.toString()) ===
        canonicalDecimalText(value.decimalValue)
    );
  if ("integerValue" in value)
    return (
      point.integerValue?.toString() === BigInt(value.integerValue).toString()
    );
  if ("booleanValue" in value) return point.booleanValue === value.booleanValue;
  return point.textValue === value.textValue;
}

function canonicalDecimalText(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("RESEARCH_DECIMAL_INVALID");
  const integer = (match[2] ?? "0").replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const unsigned = fraction ? `${integer}.${fraction}` : integer;
  return match[1] === "-" && unsigned !== "0" ? `-${unsigned}` : unsigned;
}

export function createResearchRepository(
  client: ResearchDatabase = db,
): ResearchRepositoryContract {
  return {
    createProject(input: CreateResearchProjectInput) {
      return client.researchProject.create({
        data: {
          organizationId: input.organizationId,
          name: requiredText(input.name, "RESEARCH_PROJECT_NAME_REQUIRED"),
          description: input.description?.trim() || null,
          mode: input.mode,
          marketplaceId: requiredText(
            input.marketplaceId,
            "MARKETPLACE_REQUIRED",
          ),
        },
      });
    },

    getProject(organizationId: string, projectId: string) {
      return client.researchProject.findFirst({
        where: { id: projectId, organizationId },
        include: { items: true, projectTags: { include: { tag: true } } },
      });
    },

    createKeyword(input: CreateKeywordInput) {
      const normalizedPhrase = normalizeResearchPhrase(input.phrase);
      return client.keyword.upsert({
        where: {
          organizationId_marketplaceId_locale_normalizedPhrase: {
            organizationId: input.organizationId,
            marketplaceId: input.marketplaceId,
            locale: requiredText(input.locale, "KEYWORD_LOCALE_REQUIRED"),
            normalizedPhrase,
          },
        },
        create: {
          organizationId: input.organizationId,
          marketplaceId: requiredText(
            input.marketplaceId,
            "MARKETPLACE_REQUIRED",
          ),
          locale: input.locale.trim(),
          phrase: input.phrase.trim(),
          normalizedPhrase,
        },
        update: {},
      });
    },

    async createMarketDefinition(input: CreateMarketDefinitionInput) {
      if (input.projectId) {
        const project = await client.researchProject.findFirst({
          where: { id: input.projectId, organizationId: input.organizationId },
          select: { marketplaceId: true },
        });
        if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
        if (project.marketplaceId !== input.marketplaceId)
          throw new Error("MARKETPLACE_MISMATCH");
      }
      return client.marketDefinition.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId ?? null,
          name: requiredText(input.name, "MARKET_NAME_REQUIRED"),
          marketplaceId: requiredText(
            input.marketplaceId,
            "MARKETPLACE_REQUIRED",
          ),
          membershipMode: input.membershipMode,
          definition: input.definition,
          version: input.version ?? 1,
        },
      });
    },

    async addProjectItem(input: AddResearchProjectItemInput) {
      assertProjectItemShape(input);
      const project = await client.researchProject.findFirst({
        where: { id: input.projectId, organizationId: input.organizationId },
        select: { id: true, marketplaceId: true },
      });
      if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
      if (input.kind === "PRODUCT") {
        const catalogProductId = requiredText(
          input.catalogProductId ?? "",
          "CATALOG_PRODUCT_REQUIRED",
        );
        const product = await client.catalogProduct.findUnique({
          where: { id: catalogProductId },
          select: { marketplaceId: true },
        });
        if (!product) throw new Error("CATALOG_PRODUCT_NOT_FOUND");
        if (
          product.marketplaceId !== null &&
          product.marketplaceId !== project.marketplaceId
        )
          throw new Error("MARKETPLACE_MISMATCH");
      }
      if (input.kind === "MARKET") {
        const marketDefinitionId = requiredText(
          input.marketDefinitionId ?? "",
          "MARKET_DEFINITION_REQUIRED",
        );
        const market = await client.marketDefinition.findFirst({
          where: {
            id: marketDefinitionId,
            organizationId: input.organizationId,
            marketplaceId: project.marketplaceId,
          },
          select: { id: true },
        });
        if (!market) throw new Error("MARKET_DEFINITION_NOT_FOUND");
      }
      if (input.kind === "KEYWORD") {
        const keywordId = requiredText(
          input.keywordId ?? "",
          "KEYWORD_REQUIRED",
        );
        const keyword = await client.keyword.findFirst({
          where: {
            id: keywordId,
            organizationId: input.organizationId,
            marketplaceId: project.marketplaceId,
          },
          select: { id: true },
        });
        if (!keyword) throw new Error("KEYWORD_NOT_FOUND");
      }
      return client.researchProjectItem.upsert({
        where: {
          projectId_kind_subjectKey: {
            projectId: input.projectId,
            kind: input.kind,
            subjectKey: requiredText(
              input.subjectKey,
              "RESEARCH_SUBJECT_KEY_REQUIRED",
            ),
          },
        },
        create: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          kind: input.kind,
          subjectKey: input.subjectKey.trim(),
          catalogProductId: input.catalogProductId ?? null,
          marketDefinitionId: input.marketDefinitionId ?? null,
          keywordId: input.keywordId ?? null,
          displayLabel: input.displayLabel?.trim() || null,
        },
        update: {},
      });
    },

    appendKeywordObservation(input: AppendKeywordObservationInput) {
      const { envelope } = input;
      if (envelope.expiresAt && envelope.expiresAt < envelope.observedAt)
        throw new Error("OBSERVATION_FRESHNESS_WINDOW_INVALID");
      return client.$transaction(async (transaction) => {
        const keyword = await transaction.keyword.findFirst({
          where: {
            id: input.keywordId,
            organizationId: envelope.organizationId,
            marketplaceId: envelope.marketplaceId,
          },
          select: { id: true },
        });
        if (!keyword) throw new Error("KEYWORD_NOT_FOUND");
        const observation = await transaction.researchObservation.upsert({
          where: {
            organizationId_providerKey_marketplaceId_type_observationKey_observedAt:
              {
                organizationId: envelope.organizationId,
                providerKey: envelope.providerKey,
                marketplaceId: envelope.marketplaceId,
                type: "KEYWORD",
                observationKey: envelope.observationKey,
                observedAt: envelope.observedAt,
              },
          },
          create: {
            organizationId: envelope.organizationId,
            marketplaceId: envelope.marketplaceId,
            type: "KEYWORD",
            providerKey: requiredText(
              envelope.providerKey,
              "PROVIDER_KEY_REQUIRED",
            ),
            operation: requiredText(
              envelope.operation,
              "PROVIDER_OPERATION_REQUIRED",
            ),
            observationKey: requiredText(
              envelope.observationKey,
              "OBSERVATION_KEY_REQUIRED",
            ),
            providerReference: envelope.providerReference ?? null,
            observedAt: envelope.observedAt,
            expiresAt: envelope.expiresAt ?? null,
            freshnessState: envelope.freshnessState,
            completeness: envelope.completeness,
            status: envelope.status,
            requestHash: envelope.requestHash ?? null,
            ...(envelope.requestInputs === undefined
              ? {}
              : { requestInputs: envelope.requestInputs }),
            rawEvidenceReference: envelope.rawEvidenceReference ?? null,
          },
          update: {},
        });
        const projection = await transaction.keywordObservation.upsert({
          where: {
            observationId_organizationId: {
              observationId: observation.id,
              organizationId: envelope.organizationId,
            },
          },
          create: {
            organizationId: envelope.organizationId,
            observationId: observation.id,
            keywordId: input.keywordId,
            searchVolume: input.searchVolume ?? null,
            competingProductCount:
              input.competingProductCount === undefined
                ? null
                : BigInt(input.competingProductCount),
            suggestedBid: input.suggestedBid ?? null,
            currency: input.currency ?? null,
            ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
          },
          update: {},
        });
        if (
          projection.keywordId !== input.keywordId ||
          observation.operation !== envelope.operation ||
          observation.requestHash !== (envelope.requestHash ?? null) ||
          observation.providerReference !== (envelope.providerReference ?? null)
        )
          throw new Error("OBSERVATION_IDEMPOTENCY_CONFLICT");
        return { ...observation, keywordObservation: projection };
      });
    },

    async recordHistoryObservation(input: RecordHistoryObservationInput) {
      const { envelope } = input;
      if (envelope.expiresAt && envelope.expiresAt < envelope.observedAt)
        throw new Error("OBSERVATION_FRESHNESS_WINDOW_INVALID");
      const observation = await client.researchObservation.upsert({
        where: {
          organizationId_providerKey_marketplaceId_type_observationKey_observedAt:
            {
              organizationId: envelope.organizationId,
              providerKey: envelope.providerKey,
              marketplaceId: envelope.marketplaceId,
              type: "HISTORY",
              observationKey: envelope.observationKey,
              observedAt: envelope.observedAt,
            },
        },
        create: {
          organizationId: envelope.organizationId,
          marketplaceId: envelope.marketplaceId,
          type: "HISTORY",
          providerKey: requiredText(
            envelope.providerKey,
            "PROVIDER_KEY_REQUIRED",
          ),
          operation: requiredText(
            envelope.operation,
            "PROVIDER_OPERATION_REQUIRED",
          ),
          observationKey: requiredText(
            envelope.observationKey,
            "OBSERVATION_KEY_REQUIRED",
          ),
          providerReference: envelope.providerReference ?? null,
          observedAt: envelope.observedAt,
          expiresAt: envelope.expiresAt ?? null,
          freshnessState: envelope.freshnessState,
          completeness: envelope.completeness,
          status: envelope.status,
          requestHash: envelope.requestHash ?? null,
          ...(envelope.requestInputs === undefined
            ? {}
            : { requestInputs: envelope.requestInputs }),
          rawEvidenceReference: envelope.rawEvidenceReference ?? null,
        },
        update: {},
      });
      if (
        observation.operation !== envelope.operation ||
        observation.requestHash !== (envelope.requestHash ?? null) ||
        observation.providerReference !== (envelope.providerReference ?? null)
      )
        throw new Error("OBSERVATION_IDEMPOTENCY_CONFLICT");
      return observation;
    },

    async createHistoricalMetricSeries(
      input: CreateHistoricalMetricSeriesInput,
    ) {
      if (input.subjectType === "PRODUCT") {
        const catalogProductId = requiredText(
          input.catalogProductId ?? "",
          "CATALOG_PRODUCT_REQUIRED",
        );
        const product = await client.catalogProduct.findUnique({
          where: { id: catalogProductId },
          select: { marketplaceId: true },
        });
        if (!product) throw new Error("CATALOG_PRODUCT_NOT_FOUND");
        if (
          product.marketplaceId !== null &&
          product.marketplaceId !== input.marketplaceId
        )
          throw new Error("MARKETPLACE_MISMATCH");
      }
      if (input.subjectType === "KEYWORD") {
        const keywordId = requiredText(
          input.keywordId ?? "",
          "KEYWORD_REQUIRED",
        );
        const keyword = await client.keyword.findFirst({
          where: {
            id: keywordId,
            organizationId: input.organizationId,
            marketplaceId: input.marketplaceId,
          },
          select: { id: true },
        });
        if (!keyword) throw new Error("KEYWORD_NOT_FOUND");
      }
      if (input.subjectType === "MARKET") {
        const marketDefinitionId = requiredText(
          input.marketDefinitionId ?? "",
          "MARKET_DEFINITION_REQUIRED",
        );
        const market = await client.marketDefinition.findFirst({
          where: {
            id: marketDefinitionId,
            organizationId: input.organizationId,
            marketplaceId: input.marketplaceId,
          },
          select: { id: true },
        });
        if (!market) throw new Error("MARKET_DEFINITION_NOT_FOUND");
      }
      const series = await client.historicalMetricSeries.upsert({
        where: {
          organizationId_marketplaceId_subjectType_subjectKey_metricKey_providerKey:
            {
              organizationId: input.organizationId,
              marketplaceId: input.marketplaceId,
              subjectType: input.subjectType,
              subjectKey: input.subjectKey,
              metricKey: input.metricKey,
              providerKey: input.providerKey,
            },
        },
        create: {
          organizationId: input.organizationId,
          marketplaceId: input.marketplaceId,
          subjectType: input.subjectType,
          subjectKey: input.subjectKey,
          catalogProductId: input.catalogProductId ?? null,
          keywordId: input.keywordId ?? null,
          marketDefinitionId: input.marketDefinitionId ?? null,
          metricKey: input.metricKey,
          providerKey: input.providerKey,
          unit: input.unit,
          currency: input.currency ?? null,
          retentionDays: input.retentionDays ?? 730,
        },
        update: {},
      });
      if (
        series.catalogProductId !== (input.catalogProductId ?? null) ||
        series.keywordId !== (input.keywordId ?? null) ||
        series.marketDefinitionId !== (input.marketDefinitionId ?? null) ||
        series.unit !== input.unit ||
        series.currency !== (input.currency ?? null) ||
        series.retentionDays !== (input.retentionDays ?? 730)
      )
        throw new Error("HISTORICAL_SERIES_IDEMPOTENCY_CONFLICT");
      return series;
    },

    async appendHistoricalMetricPoint(input: AppendHistoricalMetricPointInput) {
      const [series, observation] = await Promise.all([
        client.historicalMetricSeries.findFirst({
          where: { id: input.seriesId, organizationId: input.organizationId },
          select: { id: true },
        }),
        client.researchObservation.findFirst({
          where: {
            id: input.sourceObservationId,
            organizationId: input.organizationId,
          },
          select: { id: true },
        }),
      ]);
      if (!series) throw new Error("HISTORICAL_SERIES_NOT_FOUND");
      if (!observation) throw new Error("SOURCE_OBSERVATION_NOT_FOUND");
      const point = await client.historicalMetricPoint.upsert({
        where: {
          seriesId_sourceObservationId_metricAt: {
            seriesId: input.seriesId,
            sourceObservationId: input.sourceObservationId,
            metricAt: input.metricAt,
          },
        },
        create: {
          organizationId: input.organizationId,
          seriesId: input.seriesId,
          sourceObservationId: input.sourceObservationId,
          metricAt: input.metricAt,
          ...pointValueData(input.value),
        },
        update: {},
      });
      if (!pointMatchesValue(point, input.value))
        throw new Error("HISTORICAL_POINT_IDEMPOTENCY_CONFLICT");
      return point;
    },

    async recordOpportunityAssessment(input: RecordOpportunityAssessmentInput) {
      const project = await client.researchProject.findFirst({
        where: {
          id: input.projectId,
          organizationId: input.organizationId,
          marketplaceId: input.marketplaceId,
        },
        select: { id: true },
      });
      if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
      if (!input.calculationVersion.trim())
        throw new Error("CALCULATION_VERSION_REQUIRED");
      const observationIds = [
        ...new Set(
          input.inputObservationReferences.map((reference) =>
            requiredText(
              reference.observationId,
              "OBSERVATION_REFERENCE_REQUIRED",
            ),
          ),
        ),
      ];
      if (input.status !== "INSUFFICIENT_DATA" && observationIds.length === 0)
        throw new Error("ASSESSMENT_INPUTS_REQUIRED");
      if (observationIds.length > 0) {
        const count = await client.researchObservation.count({
          where: {
            id: { in: observationIds },
            organizationId: input.organizationId,
            marketplaceId: input.marketplaceId,
          },
        });
        if (count !== observationIds.length)
          throw new Error("ASSESSMENT_INPUT_NOT_FOUND");
      }
      const inputObservationIds = new Set(observationIds);
      for (const reason of input.reasons)
        for (const reference of reason.evidenceRefs)
          if (!inputObservationIds.has(reference.observationId))
            throw new Error("ASSESSMENT_REASON_INPUT_NOT_FOUND");
      if (input.projectItemId) {
        const item = await client.researchProjectItem.findFirst({
          where: {
            id: input.projectItemId,
            projectId: input.projectId,
            organizationId: input.organizationId,
          },
          select: { id: true },
        });
        if (!item) throw new Error("RESEARCH_PROJECT_ITEM_NOT_FOUND");
      }
      return client.$transaction(async (transaction) => {
        const assessment = await transaction.opportunityAssessment.create({
          data: {
            organizationId: input.organizationId,
            projectId: input.projectId,
            projectItemId: input.projectItemId ?? null,
            catalogProductId: input.catalogProductId ?? null,
            marketDefinitionId: input.marketDefinitionId ?? null,
            marketplaceId: input.marketplaceId,
            status: input.status,
            recommendation: input.recommendation,
            score: input.score ?? null,
            calculationVersion: input.calculationVersion.trim(),
            inputObservationReferences: input.inputObservationReferences.map(
              ({ observationId, purpose }) => ({ observationId, purpose }),
            ),
            calculatedAt: input.calculatedAt,
          },
        });
        if (input.reasons.length > 0)
          await transaction.opportunityReason.createMany({
            data: input.reasons.map((reason, ordinal) => ({
              organizationId: input.organizationId,
              assessmentId: assessment.id,
              ordinal,
              code: requiredText(
                reason.code,
                "ASSESSMENT_REASON_CODE_REQUIRED",
              ),
              kind: reason.kind,
              message: requiredText(
                reason.message,
                "ASSESSMENT_REASON_MESSAGE_REQUIRED",
              ),
              weight: reason.weight ?? null,
              evidenceRefs: reason.evidenceRefs.map(
                ({ observationId, purpose }) => ({ observationId, purpose }),
              ),
            })),
          });
        return transaction.opportunityAssessment.findUniqueOrThrow({
          where: { id: assessment.id },
          include: { reasons: { orderBy: { ordinal: "asc" } } },
        });
      });
    },

    async createAlertRule(input: CreateAlertRuleInput) {
      if (input.projectId) {
        const project = await client.researchProject.findFirst({
          where: { id: input.projectId, organizationId: input.organizationId },
          select: { id: true },
        });
        if (!project) throw new Error("RESEARCH_PROJECT_NOT_FOUND");
      }
      return client.alertRule.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId ?? null,
          marketplaceId: input.marketplaceId,
          subjectType: input.subjectType,
          subjectKey: input.subjectKey,
          metricKey: input.metricKey,
          operator: input.operator,
          threshold: input.threshold ?? null,
          cooldownMinutes: input.cooldownMinutes ?? 60,
        },
      });
    },
  };
}

export const researchRepository = createResearchRepository();
