-- migration: 0035_news_ai_selections (DOWN)
-- Reverses additive changes from 0035_news_ai_selections.sql

DROP TABLE IF EXISTS _quarantine_news_ai_selections_0035;
DROP TABLE IF EXISTS news_ai_selections;
