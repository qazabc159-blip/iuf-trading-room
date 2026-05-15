"use client";

import { useState } from "react";
import Link from "next/link";
import type { Company } from "@iuf-trading-room/contracts";
import { industryLabel } from "@/lib/industry-i18n";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  companies: Company[];
  loading: boolean;
};

// ---------------------------------------------------------------------------
// Sector grouping
// ---------------------------------------------------------------------------

function groupBySector(companies: Company[]): Map<string, Company[]> {
  const map = new Map<string, Company[]>();
  for (const company of companies) {
    const sector = company.chainPosition || "其他";
    if (!map.has(sector)) map.set(sector, []);
    map.get(sector)!.push(company);
  }
  // Sort by size descending
  return new Map([...map.entries()].sort((a, b) => b[1].length - a[1].length));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SectorTab({ companies, loading }: Props) {
  const [activeSector, setActiveSector] = useState<string | null>(null);

  if (loading) {
    return (
      <div style={{ padding: "24px 16px", color: "var(--night-mid)", fontSize: 13 }}>
        讀取中…
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div style={{ padding: "24px 16px", color: "var(--night-mid)", fontSize: 13 }}>
        公司資料尚未載入。
      </div>
    );
  }

  const grouped = groupBySector(companies);
  const sectorList = [...grouped.entries()];
  const activeCompanies = activeSector ? (grouped.get(activeSector) ?? []) : [];

  return (
    <div style={{ padding: "0 16px 24px", display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
      {/* Sector sidebar */}
      <div>
        <div
          style={{
            fontSize: 10,
            fontFamily: "var(--mono)",
            color: "var(--night-soft)",
            marginBottom: 8,
            fontWeight: 700,
          }}
        >
          產業鏈分類 ({sectorList.length})
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {sectorList.map(([sector, members]) => {
            const isActive = activeSector === sector;
            return (
              <button
                key={sector}
                type="button"
                onClick={() => setActiveSector(isActive ? null : sector)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: isActive
                    ? "1px solid rgba(200,148,63,0.55)"
                    : "1px solid rgba(220,228,240,0.08)",
                  borderRadius: 7,
                  background: isActive ? "rgba(200,148,63,0.11)" : "rgba(255,255,255,0.025)",
                  padding: "8px 10px",
                  cursor: "pointer",
                  textAlign: "left",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: isActive ? "#e2b85c" : "var(--night-ink)",
                    fontWeight: isActive ? 800 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {industryLabel(sector)}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--mono)",
                    color: isActive ? "#e2b85c" : "var(--night-soft)",
                    flexShrink: 0,
                  }}
                >
                  {members.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Company list for active sector */}
      <div>
        {activeSector === null ? (
          <div
            style={{
              padding: "32px 0",
              textAlign: "center",
              color: "var(--night-soft)",
              fontSize: 13,
            }}
          >
            選擇左側產業鏈以篩選公司
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 10,
                fontFamily: "var(--mono)",
                color: "var(--night-soft)",
                marginBottom: 10,
                fontWeight: 700,
              }}
            >
              {industryLabel(activeSector)} — {activeCompanies.length} 檔
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 8,
              }}
            >
              {activeCompanies.map((company) => (
                <Link
                  key={company.id}
                  href={`/companies/${company.ticker}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    border: "1px solid rgba(220,228,240,0.08)",
                    borderRadius: 7,
                    background: "rgba(255,255,255,0.025)",
                    padding: "9px 11px",
                    textDecoration: "none",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontWeight: 800,
                      fontSize: 13,
                      color: "#e2b85c",
                    }}
                  >
                    {company.ticker}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--night-mid)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {company.name}
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

