"use client";

import { useMemo, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import type { DuplicatePair, DuplicatePairStatus } from "@/lib/radar-uncovered";
import { mockDuplicatePairs } from "@/lib/radar-uncovered";

const STATUS_LABEL: Record<DuplicatePairStatus | "ALL", string> = {
  ALL: "全部",
  PENDING: "待處理",
  RESOLVED: "已處理",
  IGNORED: "已忽略",
};

export default function CompanyDuplicatesPage() {
  const [pairs, setPairs] = useState<DuplicatePair[]>(mockDuplicatePairs);
  const [status, setStatus] = useState<DuplicatePairStatus | "ALL">("PENDING");
  const [threshold, setThreshold] = useState(0.7);
  const [selectedId, setSelectedId] = useState(pairs[0]?.id ?? "");

  const filtered = useMemo(
    () => pairs.filter((pair) => (status === "ALL" || pair.status === status) && pair.score >= threshold),
    [pairs, status, threshold],
  );
  const selected = pairs.find((pair) => pair.id === selectedId) ?? filtered[0] ?? null;

  function apply(id: string, next: "MERGE" | "NOT_DUP" | "IGNORE") {
    if (next === "MERGE" && !window.confirm("確認要合併這組疑似重複公司？")) return;
    setPairs((items) => items.map((pair) => (
      pair.id === id
        ? { ...pair, status: next === "IGNORE" ? "IGNORED" : "RESOLVED" }
        : pair
    )));
  }

  return (
    <PageFrame
      code="CMP-DUP"
      title="公司重複辨識"
      sub="疑似重複條目輔助"
      note="[CMP-DUP] OpenAlice 比對產出 · 操作員決定合併 / 非重複 / 忽略"
    >
      <Panel code="DUP-FLT" title="篩選條件" right={`分數 >= ${threshold.toFixed(2)}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
          <select value={status} onChange={(event) => setStatus(event.target.value as DuplicatePairStatus | "ALL")} style={selectStyle}>
            {(["ALL", "PENDING", "RESOLVED", "IGNORED"] as const).map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
          </select>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            style={{ accentColor: "var(--gold)", width: 240 }}
          />
          <span className="tg soft">{filtered.length} 組</span>
        </div>
      </Panel>

      <div className="company-grid">
        <Panel code="DUP-Q" title="疑似重複公司" right={`${filtered.filter((pair) => pair.status === "PENDING").length} 組待處理`}>
          <div className="row table-head" style={{ gridTemplateColumns: "72px 92px 1fr 24px 92px 1fr 86px", gap: 10 }}>
            <span>分數</span>
            <span>A</span>
            <span>公司名稱</span>
            <span />
            <span>B</span>
            <span>公司名稱</span>
            <span>狀態</span>
          </div>
          {filtered.map((pair) => (
            <button
              className="row"
              key={pair.id}
              onClick={() => setSelectedId(pair.id)}
              style={{
                gridTemplateColumns: "72px 92px 1fr 24px 92px 1fr 86px",
                gap: 10,
                minHeight: 56,
                borderTop: 0,
                borderRight: 0,
                borderLeft: pair.id === selected?.id ? "2px solid var(--gold)" : "2px solid transparent",
                background: pair.id === selected?.id ? "var(--night-1)" : "transparent",
                color: "var(--night-ink)",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span className="tg gold">{pair.score.toFixed(2)}</span>
              <span className="tg">{pair.a.ticker}</span>
              <span className="tc">{pair.a.name}</span>
              <span className="tg soft">≈</span>
              <span className="tg">{pair.b.ticker}</span>
              <span className="tc">{pair.b.name}</span>
              <span className="tg soft">{STATUS_LABEL[pair.status]}</span>
            </button>
          ))}
        </Panel>

        <div>
          {!selected ? (
            <Panel code="DUP-D" title="比對詳情">
              <div className="terminal-note">選擇左側 pair 以查看比對</div>
            </Panel>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <CompanyPanel code="DUP-A" company={selected.a} />
                <CompanyPanel code="DUP-B" company={selected.b} />
              </div>
              <Panel code="DUP-ACT" title="處理動作" right={selected.id}>
                <div style={{ display: "flex", gap: 10, padding: "14px 0" }}>
                  <button className="mini-button" type="button" onClick={() => apply(selected.id, "MERGE")}>合併 A←B</button>
                  <button className="outline-button" type="button" onClick={() => apply(selected.id, "NOT_DUP")}>標記非重複</button>
                  <button className="outline-button" type="button" onClick={() => apply(selected.id, "IGNORE")}>忽略</button>
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </PageFrame>
  );
}

function CompanyPanel({ code, company }: { code: string; company: DuplicatePair["a"] }) {
  return (
    <Panel code={code} title={company.ticker}>
      {[
        ["資料編號", company.id],
        ["股票代號", company.ticker],
        ["公司名稱", company.name],
        ["產業", company.sector],
      ].map(([key, value]) => (
        <div className="row" key={key} style={{ gridTemplateColumns: "82px 1fr", gap: 10, padding: "8px 0" }}>
          <span className="tg gold">{key}</span>
          <span className="tg">{value}</span>
        </div>
      ))}
    </Panel>
  );
}

const selectStyle = {
  minHeight: 32,
  border: "1px solid var(--night-rule-strong)",
  background: "var(--night)",
  color: "var(--night-ink)",
  fontFamily: "var(--mono)",
  fontSize: 12,
  padding: "0 10px",
} satisfies React.CSSProperties;
