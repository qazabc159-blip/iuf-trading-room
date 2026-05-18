-- down migration: 0041_ai_recommendations_v2
-- Removes ai_recommendations_runs table and 5 tool seed rows.

DELETE FROM tools WHERE tool_key IN (
  'get_market_overview',
  'get_sector_rotation',
  'get_company_technical',
  'get_institutional_flow',
  'get_news_top10'
);

DROP TABLE IF EXISTS ai_recommendations_runs;
