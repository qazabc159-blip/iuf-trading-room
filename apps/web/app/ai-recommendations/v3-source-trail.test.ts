import { describe, expect, it } from "vitest";

import { mapV3ItemToStockRecCard } from "./v3-view";

describe("AI recommendations v3 source trail", () => {
  it("derives a truthful source trail when backend omits item-level sourceTrail", () => {
    const card = mapV3ItemToStockRecCard({
      ticker: "2886",
      source: "brain_react_v2",
      bucket: "B",
      totalScore: 68,
    }, {
      status: "complete",
      sourceState: {
        state: "live",
        source: "ai_recommendations_runs",
        count: 5,
        lastUpdated: "2026-05-29T02:51:40.161Z",
      },
      officialAnnouncementSourceState: {
        state: "empty",
        source: "get_news_top10",
        count: 0,
      },
      reactTrace: [
        {
          observation: {
            ticker: "2886",
            source: "finmind_ohlcv",
            asOf: "2026-05-28",
            lastPrice: 39.8,
          },
        },
      ],
    });

    expect(card?.sourceTrail).toContain("recommendation_source=brain_react_v2");
    expect(card?.sourceTrail).toContain("run(source=ai_recommendations_runs state=live count=5");
    expect(card?.sourceTrail).toContain("official_announcements(source=get_news_top10 state=empty count=0)");
    expect(card?.sourceTrail).toContain("technical(source=finmind_ohlcv asOf=2026-05-28 lastPrice=39.8)");
  });
});
