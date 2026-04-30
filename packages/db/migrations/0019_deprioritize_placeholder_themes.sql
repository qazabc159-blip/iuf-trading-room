-- 0019_deprioritize_placeholder_themes.sql
-- De-prioritizes placeholder themes so they stop ranking top in daily summaries.
-- Idempotent: running twice is a no-op (WHERE priority > 0 guards repeat runs).
-- Does NOT delete rows — preserves history.

UPDATE themes
SET priority = 0
WHERE (
  name LIKE '[BROKEN-%'
  OR name LIKE '[DEPRECATED]%'
)
AND priority > 0;
