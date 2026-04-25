-- 0014 — content_drafts.target_entity_id: uuid -> text
-- Reason: daily_briefs uses date string (YYYY-MM-DD) as natural targetEntityId.
-- uuid type rejects non-UUID strings; text accepts both UUIDs and date strings.
-- Idempotent: only alters if column type is still uuid.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'content_drafts'
      AND column_name = 'target_entity_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE content_drafts
      ALTER COLUMN target_entity_id TYPE TEXT USING target_entity_id::text;
  END IF;
END $$;
