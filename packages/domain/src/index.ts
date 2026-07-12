import { Decimal } from "decimal.js";

export const JOB_STATES = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;

export type JobState = (typeof JOB_STATES)[number];

export const JOB_STATE_TRANSITIONS: Readonly<
  Record<JobState, readonly JobState[]>
> = {
  QUEUED: ["RUNNING", "FAILED_RETRYABLE", "FAILED_FINAL"],
  RUNNING: ["COMPLETED", "FAILED_RETRYABLE", "FAILED_FINAL"],
  COMPLETED: [],
  FAILED_RETRYABLE: ["QUEUED", "RUNNING", "FAILED_FINAL"],
  FAILED_FINAL: [],
};

export function canTransitionJob(from: JobState, to: JobState): boolean {
  return JOB_STATE_TRANSITIONS[from].includes(to);
}

/** Monetary values are represented as Decimal and never JavaScript numbers. */
export type Money = Decimal;

export function money(value: string): Money {
  return new Decimal(value);
}

export type FreshnessState = "FRESH" | "STALE" | "EXPIRED" | "UNKNOWN";

export interface ObservedValue<T> {
  readonly value: T;
  readonly provider: string;
  readonly observedAt: Date;
  readonly freshnessState: FreshnessState;
}

export type PackGuardStatus =
  "VERIFIED" | "BLOCKED_PACK_UNCERTAIN" | "BLOCKED_PACK_CONTRADICTION";

export type MatchDecisionStatus =
  | "AUTO_ACCEPTED"
  | "REVIEW_REQUIRED"
  | "UNMATCHED"
  | "USER_ACCEPTED"
  | "USER_REJECTED";

export type MatchEvidenceOutcome =
  "AGREEMENT" | "CONTRADICTION" | "UNKNOWN" | "NOT_APPLICABLE";
