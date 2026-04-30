-- 0019.down.sql — rollback for 0019_deprioritize_placeholder_themes.sql
-- Restores original priority=5 for the placeholder themes.
-- Only updates rows that are currently at priority=0 to avoid overwriting
-- legitimate manual changes.

UPDATE themes
SET priority = 5
WHERE (
  name LIKE '[BROKEN-%'
  OR name LIKE '[DEPRECATED]%'
)
AND priority = 0;
