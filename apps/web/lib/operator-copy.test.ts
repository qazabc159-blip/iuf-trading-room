import { describe, expect, it } from "vitest";

import { formatBriefSourceTrail } from "./operator-copy";

describe("formatBriefSourceTrail", () => {
  it("turns raw brief source trails into readable Chinese source status", () => {
    const result = formatBriefSourceTrail(
      "source_pack=fcb3e0eb-58c4-43d9-8de3-3200018b611a; trading_date=2026-05-29; 台股日線資料=STALE,rows=47169,latest=2026-05-29 | 月營收資料=DEGRADED,rows=n/a,latest=n/a,note=table_not_found_or_draft_not_promoted | 法人籌碼資料=LIVE,rows=216966,latest=2026-05-29"
    );

    expect(result).toContain("資料包 fcb3e0eb");
    expect(result).toContain("交易日 2026-05-29");
    expect(result).toContain("台股日線資料：資料日期較舊（47,169 筆，最新 2026-05-29）");
    expect(result).toContain("月營收資料：資料源降級（資料表尚未發布或尚未建置）");
    expect(result).toContain("法人籌碼資料：已接入（216,966 筆，最新 2026-05-29）");
    expect(result).not.toContain("段落尚未完成中文整理");
  });

  it("keeps an honest degraded message when source trail is absent", () => {
    expect(formatBriefSourceTrail(null)).toBe("來源紀錄尚未完整，這段不作投資依據。");
  });
});
