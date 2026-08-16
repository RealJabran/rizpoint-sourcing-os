-- Manual rollback: delete dependent private evidence objects before running.
DROP TABLE IF EXISTS "history_refresh_items";
DROP TABLE IF EXISTS "history_refresh_runs";
DROP TYPE IF EXISTS "HistoryRefreshItemStatus";
DROP TYPE IF EXISTS "HistoryRefreshRunStatus";
-- PostgreSQL enum values are intentionally not removed: removing HISTORY from
-- ResearchObservationType would be unsafe if any historical evidence exists.
