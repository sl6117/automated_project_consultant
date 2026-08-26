ALTER TABLE model_calls ADD COLUMN execution_provenance TEXT CHECK (
  execution_provenance IN ('synthetic', 'recorded', 'live')
);
