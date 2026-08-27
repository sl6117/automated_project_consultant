-- Slice 6: live model calls. Strictly additive — model_calls keeps every
-- existing row id and foreign-key link. Attempt rows become the canonical
-- record of model spend: the session stores only the cap, and used/reserved
-- spend is derived from settled actuals plus pending estimates. The legacy
-- estimated_cost_cents columns on discovery_sessions and model_calls are
-- deprecated and no longer written.

-- initialization_status covers session START only: a later coach or
-- next-question failure never marks an active consultation failed.
ALTER TABLE discovery_sessions ADD COLUMN initialization_status TEXT NOT NULL
  DEFAULT 'active'
  CHECK (initialization_status IN ('starting', 'active', 'failed'));

-- Costs move to integer microcents (1 cent = 1,000,000 microcents).
ALTER TABLE discovery_sessions ADD COLUMN cap_microcents INTEGER NOT NULL
  DEFAULT 500000000;
UPDATE discovery_sessions SET cap_microcents = cap_cents * 1000000;

-- A call attempt is created 'pending' before network I/O and settled
-- afterward, so a paid call can never lose its telemetry.
ALTER TABLE model_calls ADD COLUMN status TEXT NOT NULL DEFAULT 'succeeded'
  CHECK (
    status IN ('pending', 'succeeded', 'transport_failed', 'validation_failed')
  );
ALTER TABLE model_calls ADD COLUMN latency_ms INTEGER;
ALTER TABLE model_calls ADD COLUMN cache_read_tokens INTEGER;
-- 5-minute and 1-hour cache writes are priced differently and tracked apart.
ALTER TABLE model_calls ADD COLUMN cache_write_5m_tokens INTEGER;
ALTER TABLE model_calls ADD COLUMN cache_write_1h_tokens INTEGER;
ALTER TABLE model_calls ADD COLUMN estimated_cost_microcents INTEGER NOT NULL
  DEFAULT 0;
ALTER TABLE model_calls ADD COLUMN actual_cost_microcents INTEGER;
ALTER TABLE model_calls ADD COLUMN confirmed_over_cap INTEGER NOT NULL DEFAULT 0;
-- Audit trail: the literal model id sent to the API and the pricing table
-- date used for the estimate, immune to later catalog changes.
ALTER TABLE model_calls ADD COLUMN api_model_id TEXT;
ALTER TABLE model_calls ADD COLUMN price_effective_date TEXT;

-- Legacy rows were all completed recorded/synthetic calls: settle them as
-- succeeded with their old estimates carried into microcents.
UPDATE model_calls SET estimated_cost_microcents = estimated_cost_cents * 1000000;
UPDATE model_calls SET actual_cost_microcents = estimated_cost_cents * 1000000;
