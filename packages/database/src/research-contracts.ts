import type {
  AlertOperator,
  AlertRule,
  HistoricalMetricPoint,
  HistoricalMetricSeries,
  HistoricalSubjectType,
  Keyword,
  KeywordObservation,
  MarketDefinition,
  OpportunityAssessment,
  OpportunityReason,
  OpportunityAssessmentStatus,
  OpportunityReasonKind,
  ProductWatch,
  OpportunityRecommendation,
  Prisma,
  ProviderObservationStatus,
  ResearchObservation,
  ResearchProject,
  ResearchProjectItem,
  ResearchProjectTag,
  ResearchTag,
  ResearchItemKind,
  ResearchObservationCompleteness,
  ResearchObservationType,
  ResearchProjectMode,
} from "./generated/prisma/client.js";

/** Decimal text accepted by Prisma/PostgreSQL NUMERIC fields. Never a number. */
export type ResearchDecimal = string;

export interface ObservationReference {
  observationId: string;
  purpose: string;
}

export interface ResearchObservationEnvelopeInput {
  organizationId: string;
  marketplaceId: string;
  type: ResearchObservationType;
  providerKey: string;
  operation: string;
  observationKey: string;
  providerReference?: string;
  observedAt: Date;
  expiresAt?: Date;
  freshnessState: "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";
  completeness: ResearchObservationCompleteness;
  status: ProviderObservationStatus;
  requestHash?: string;
  requestInputs?: Prisma.InputJsonValue;
  rawEvidenceReference?: string;
}

export interface CreateResearchProjectInput {
  organizationId: string;
  name: string;
  description?: string;
  mode: ResearchProjectMode;
  marketplaceId: string;
}

export interface CreateKeywordInput {
  organizationId: string;
  marketplaceId: string;
  phrase: string;
  locale: string;
}

export interface CreateMarketDefinitionInput {
  organizationId: string;
  projectId?: string;
  name: string;
  marketplaceId: string;
  membershipMode: "FROZEN" | "DYNAMIC";
  definition: Prisma.InputJsonValue;
  version?: number;
}

export interface AddResearchProjectItemInput {
  organizationId: string;
  projectId: string;
  kind: ResearchItemKind;
  subjectKey: string;
  catalogProductId?: string;
  marketDefinitionId?: string;
  keywordId?: string;
  displayLabel?: string;
}

export interface CreateProductWatchInput {
  organizationId: string;
  projectId?: string;
  catalogProductId: string;
  marketplaceId: string;
  cadenceMinutes?: number;
}

export interface AppendKeywordObservationInput {
  envelope: ResearchObservationEnvelopeInput & { type: "KEYWORD" };
  keywordId: string;
  searchVolume?: ResearchDecimal;
  competingProductCount?: string;
  suggestedBid?: ResearchDecimal;
  currency?: string;
  metrics?: Prisma.InputJsonValue;
}

/** A history retrieval envelope has no lossy JSON projection; its useful facts
 * are persisted as typed HistoricalMetricSeries/Point rows. */
export interface RecordHistoryObservationInput {
  envelope: ResearchObservationEnvelopeInput & { type: "HISTORY" };
}

export interface CreateHistoricalMetricSeriesInput {
  organizationId: string;
  marketplaceId: string;
  subjectType: HistoricalSubjectType;
  subjectKey: string;
  catalogProductId?: string;
  keywordId?: string;
  marketDefinitionId?: string;
  metricKey: string;
  providerKey: string;
  unit: string;
  currency?: string;
  retentionDays?: number;
}

export type HistoricalMetricValue =
  | { decimalValue: ResearchDecimal }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { textValue: string };

export interface AppendHistoricalMetricPointInput {
  organizationId: string;
  seriesId: string;
  sourceObservationId: string;
  metricAt: Date;
  value: HistoricalMetricValue;
}

export interface OpportunityReasonInput {
  code: string;
  kind: OpportunityReasonKind;
  message: string;
  weight?: ResearchDecimal;
  evidenceRefs: ObservationReference[];
}

export interface RecordOpportunityAssessmentInput {
  organizationId: string;
  projectId: string;
  projectItemId?: string;
  catalogProductId?: string;
  marketDefinitionId?: string;
  marketplaceId: string;
  status: OpportunityAssessmentStatus;
  recommendation: OpportunityRecommendation;
  score?: ResearchDecimal;
  calculationVersion: string;
  inputObservationReferences: ObservationReference[];
  calculatedAt: Date;
  reasons: OpportunityReasonInput[];
}

export interface CreateAlertRuleInput {
  organizationId: string;
  projectId?: string;
  marketplaceId: string;
  subjectType: HistoricalSubjectType;
  subjectKey: string;
  metricKey: string;
  operator: AlertOperator;
  threshold?: ResearchDecimal;
  cooldownMinutes?: number;
}

export interface ResearchRepositoryContract {
  createProject(input: CreateResearchProjectInput): Promise<ResearchProject>;
  getProject(
    organizationId: string,
    projectId: string,
  ): Promise<
    | (ResearchProject & {
        items: ResearchProjectItem[];
        projectTags: Array<ResearchProjectTag & { tag: ResearchTag }>;
      })
    | null
  >;
  listProjects(
    organizationId: string,
    marketplaceId?: string,
  ): Promise<ResearchProject[]>;
  createKeyword(input: CreateKeywordInput): Promise<Keyword>;
  createMarketDefinition(
    input: CreateMarketDefinitionInput,
  ): Promise<MarketDefinition>;
  addProjectItem(
    input: AddResearchProjectItemInput,
  ): Promise<ResearchProjectItem>;
  createProductWatch(input: CreateProductWatchInput): Promise<ProductWatch>;
  appendKeywordObservation(
    input: AppendKeywordObservationInput,
  ): Promise<ResearchObservation & { keywordObservation: KeywordObservation }>;
  recordHistoryObservation(
    input: RecordHistoryObservationInput,
  ): Promise<ResearchObservation>;
  createHistoricalMetricSeries(
    input: CreateHistoricalMetricSeriesInput,
  ): Promise<HistoricalMetricSeries>;
  appendHistoricalMetricPoint(
    input: AppendHistoricalMetricPointInput,
  ): Promise<HistoricalMetricPoint>;
  recordOpportunityAssessment(
    input: RecordOpportunityAssessmentInput,
  ): Promise<OpportunityAssessment & { reasons: OpportunityReason[] }>;
  createAlertRule(input: CreateAlertRuleInput): Promise<AlertRule>;
}
