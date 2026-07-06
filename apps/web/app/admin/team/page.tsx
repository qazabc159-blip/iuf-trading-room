"use client";

/**
 * /admin/team — 團隊與邀請管理
 *
 * Owner-only.
 *
 * Invite section (Owner + Admin):
 *   POST /api/v1/admin/invites  — issue invite
 *   GET  /api/v1/admin/invites  — list invites
 *   POST /api/v1/admin/invites/:id/revoke
 *
 * Users section (Owner only):
 *   GET  /api/v1/admin/users
 *   POST /api/v1/admin/users/:id/role
 *   POST /api/v1/admin/users/:id/deactivate
 */

import { useEffect, useRef, useState } from "react";
import { PageFrame, Panel } from "@/components/PageFrame";
import { DataStateBadge } from "@/components/DataStateBadge";
import {
  apiGetMe,
  apiCreateInvite,
  apiListInvites,
  apiRevokeInvite,
  apiListUsers,
  apiChangeUserRole,
  apiDeactivateUser,
  type InviteRecord,
  type UserRecord,
  type CreatedInvite,
} from "@/lib/auth-client";

// ── Vocabulary helpers ────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  Owner:   "擁有者",
  Admin:   "管理員",
  Analyst: "分析師",
  Trader:  "交易員",
  Viewer:  "檢視者",
};

const INVITE_STATUS_LABEL: Record<string, string> = {
  pending: "生效中",
  used:    "已使用",
  expired: "已過期",
  revoked: "已撤銷",
};

const INVITE_STATUS_COLOR: Record<string, string> = {
  pending: "#ffb800",
  used:    "#4caf50",
  expired: "rgba(255,255,255,0.3)",
  revoked: "#e53935",
};

const ASSIGNABLE_ROLES = ["Admin", "Analyst", "Trader", "Viewer"] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

const EXPIRES_OPTIONS = [
  { label: "1 天",  days: 1 },
  { label: "3 天",  days: 3 },
  { label: "7 天",  days: 7 },
  { label: "14 天", days: 14 },
  { label: "30 天", days: 30 },
];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const TEAM_CSS = `
._tm-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 520px;
}
._tm-form-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
._tm-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 160px;
}
._tm-field label {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  font-family: monospace;
  text-transform: uppercase;
}
._tm-field input,
._tm-field select {
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.12);
  color: #e8dfc8;
  padding: 7px 10px;
  border-radius: 4px;
  font-size: 13px;
  outline: none;
}
._tm-field input:focus,
._tm-field select:focus {
  border-color: rgba(255,184,0,0.45);
}
._tm-field select option {
  background: #1a1a2e;
}
._tm-submit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  background: rgba(255,184,0,0.15);
  border: 1px solid rgba(255,184,0,0.4);
  color: #ffb800;
  border-radius: 4px;
  font-size: 13px;
  font-family: monospace;
  cursor: pointer;
  transition: background 0.15s;
}
._tm-submit:hover { background: rgba(255,184,0,0.25); }
._tm-submit:disabled { opacity: 0.4; cursor: default; }

/* One-time token modal */
._tm-token-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
  padding: 20px;
}
._tm-token-box {
  background: #0d1117;
  border: 1px solid rgba(255,184,0,0.4);
  border-radius: 8px;
  padding: 28px 28px 22px;
  max-width: 560px;
  width: 100%;
}
._tm-token-title {
  color: #ffb800;
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}
._tm-token-warn {
  background: rgba(229,57,53,0.12);
  border: 1px solid rgba(229,57,53,0.3);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  color: #ef9a9a;
  margin-bottom: 16px;
}
._tm-token-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
._tm-token-field label {
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  font-family: monospace;
  text-transform: uppercase;
}
._tm-token-val {
  background: rgba(0,0,0,0.5);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  padding: 8px 12px;
  font-family: monospace;
  font-size: 12px;
  color: #e8dfc8;
  word-break: break-all;
  line-height: 1.5;
}
._tm-token-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255,255,255,0.08);
}
._tm-copy-btn {
  padding: 6px 14px;
  background: rgba(255,184,0,0.12);
  border: 1px solid rgba(255,184,0,0.3);
  color: #ffb800;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
  cursor: pointer;
}
._tm-copy-btn:hover { background: rgba(255,184,0,0.22); }
._tm-close-btn {
  margin-left: auto;
  padding: 6px 14px;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.15);
  color: rgba(255,255,255,0.6);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}
._tm-close-btn:hover { background: rgba(255,255,255,0.1); }

/* Invite list table */
._tm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
._tm-table th {
  text-align: left;
  padding: 6px 10px;
  color: rgba(255,255,255,0.4);
  font-family: monospace;
  font-size: 10px;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
._tm-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  color: rgba(255,255,255,0.75);
  vertical-align: middle;
}
._tm-table tr:hover td {
  background: rgba(255,255,255,0.02);
}
._tm-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
}
._tm-revoke-btn {
  padding: 3px 10px;
  background: rgba(229,57,53,0.1);
  border: 1px solid rgba(229,57,53,0.3);
  color: #ef9a9a;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}
._tm-revoke-btn:hover { background: rgba(229,57,53,0.2); }
._tm-revoke-btn:disabled { opacity: 0.4; cursor: default; }

/* User table extras */
._tm-role-select {
  background: rgba(0,0,0,0.3);
  border: 1px solid rgba(255,255,255,0.1);
  color: #e8dfc8;
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 12px;
  cursor: pointer;
}
._tm-role-select:disabled {
  opacity: 0.4;
  cursor: default;
}
._tm-deactivate-btn {
  padding: 3px 10px;
  background: rgba(255,152,0,0.08);
  border: 1px solid rgba(255,152,0,0.25);
  color: #ffcc80;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
}
._tm-deactivate-btn:hover { background: rgba(255,152,0,0.18); }
._tm-deactivate-btn:disabled { opacity: 0.4; cursor: default; }
._tm-err {
  color: #ef9a9a;
  font-size: 12px;
  padding: 6px 10px;
  background: rgba(229,57,53,0.08);
  border-radius: 4px;
}
._tm-empty {
  color: rgba(255,255,255,0.3);
  font-size: 12px;
  font-style: italic;
  padding: 16px 0;
}
`;

// ── One-time token display ────────────────────────────────────────────────────

function CopiedLabel({ copied }: { copied: boolean }) {
  return <span style={{ color: copied ? "#4caf50" : undefined }}>{copied ? "已複製" : "複製"}</span>;
}

function TokenModal({ invite, onClose }: { invite: CreatedInvite; onClose: () => void }) {
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  function copyText(text: string, setCopied: (v: boolean) => void) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="_tm-token-overlay" role="dialog" aria-modal="true" aria-label="邀請已建立">
      <div className="_tm-token-box">
        <div className="_tm-token-title">邀請已建立 — {ROLE_LABEL[invite.role] ?? invite.role}</div>
        <div className="_tm-token-warn">
          關閉後無法再查看此 Token，請立即複製後交給受邀者。
        </div>

        <div className="_tm-token-field">
          <label>邀請 Token（一次性）</label>
          <div className="_tm-token-val">{invite.token}</div>
        </div>

        <div className="_tm-token-field">
          <label>完整註冊連結</label>
          <div className="_tm-token-val">{invite.registrationUrl}</div>
        </div>

        <div className="_tm-token-field">
          <label>效期至</label>
          <div style={{ fontSize: 12, color: "#ffb800", fontFamily: "monospace", padding: "4px 0" }}>
            {fmtDate(invite.expiresAt)}
          </div>
        </div>

        <div className="_tm-token-actions">
          <button type="button" className="_tm-copy-btn" onClick={() => copyText(invite.token, setCopiedToken)}>
            <CopiedLabel copied={copiedToken} /> Token
          </button>
          <button type="button" className="_tm-copy-btn" onClick={() => copyText(invite.registrationUrl, setCopiedUrl)}>
            <CopiedLabel copied={copiedUrl} /> 完整連結
          </button>
          <button type="button" className="_tm-close-btn" onClick={onClose}>
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invite form ───────────────────────────────────────────────────────────────

function InviteForm({ onCreated }: { onCreated: (invite: CreatedInvite) => void }) {
  const [role, setRole] = useState<AssignableRole>("Viewer");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function handleSubmit() {
    setErr("");
    setSubmitting(true);
    try {
      const result = await apiCreateInvite({
        role,
        invitedEmail: invitedEmail.trim() || undefined,
        label: label.trim() || undefined,
        expiresInDays,
      });
      if (!result.ok) {
        setErr(`建立邀請失敗：${result.error}`);
        return;
      }
      // Reset form
      setRole("Viewer");
      setInvitedEmail("");
      setLabel("");
      setExpiresInDays(7);
      onCreated(result);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="_tm-form">
      <div className="_tm-form-row">
        <div className="_tm-field">
          <label>角色</label>
          <select value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div className="_tm-field">
          <label>效期</label>
          <select value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}>
            {EXPIRES_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="_tm-form-row">
        <div className="_tm-field" style={{ flex: 2 }}>
          <label>指定信箱（選填）</label>
          <input
            type="email"
            value={invitedEmail}
            onChange={(e) => setInvitedEmail(e.target.value)}
            placeholder="留空則任何信箱皆可使用"
          />
        </div>
      </div>
      <div className="_tm-form-row">
        <div className="_tm-field" style={{ flex: 2 }}>
          <label>備註（選填）</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例：楊董朋友 / 第一批 beta 用戶"
            maxLength={200}
          />
        </div>
      </div>
      {err && <div className="_tm-err">{err}</div>}
      <div>
        <button type="button" className="_tm-submit" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "建立中..." : "產生邀請連結"}
        </button>
      </div>
    </div>
  );
}

// ── Invite list ───────────────────────────────────────────────────────────────

function InviteList({
  invites,
  onRefresh,
}: {
  invites: InviteRecord[];
  onRefresh: () => void;
}) {
  const [revoking, setRevoking] = useState<string | null>(null);

  async function handleRevoke(id: string) {
    if (!window.confirm("確定要撤銷此邀請？撤銷後連結立即失效，無法恢復。")) return;
    setRevoking(id);
    try {
      const result = await apiRevokeInvite(id);
      if (!result.ok) {
        window.alert(`撤銷失敗：${result.error}`);
        return;
      }
      onRefresh();
    } finally {
      setRevoking(null);
    }
  }

  if (invites.length === 0) {
    return <div className="_tm-empty">尚無邀請紀錄</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="_tm-table">
        <thead>
          <tr>
            <th>狀態</th>
            <th>角色</th>
            <th>指定信箱</th>
            <th>備註</th>
            <th>建立時間</th>
            <th>效期至</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {invites.map((inv) => (
            <tr key={inv.id}>
              <td>
                <span
                  className="_tm-badge"
                  style={{
                    color: INVITE_STATUS_COLOR[inv.status] ?? "rgba(255,255,255,0.5)",
                    border: `1px solid ${INVITE_STATUS_COLOR[inv.status] ?? "rgba(255,255,255,0.2)"}`,
                    background: "transparent",
                  }}
                >
                  {INVITE_STATUS_LABEL[inv.status] ?? inv.status}
                </span>
              </td>
              <td style={{ fontFamily: "monospace" }}>{ROLE_LABEL[inv.role] ?? inv.role}</td>
              <td style={{ color: inv.invitedEmail ? undefined : "rgba(255,255,255,0.25)" }}>
                {inv.invitedEmail ?? "—"}
              </td>
              <td style={{ color: inv.label ? undefined : "rgba(255,255,255,0.25)", maxWidth: 160 }}>
                {inv.label ?? "—"}
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                {fmtDate(inv.createdAt)}
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                {fmtDate(inv.expiresAt)}
              </td>
              <td>
                {inv.status === "pending" && (
                  <button
                    type="button"
                    className="_tm-revoke-btn"
                    disabled={revoking === inv.id}
                    onClick={() => void handleRevoke(inv.id)}
                  >
                    {revoking === inv.id ? "撤銷中..." : "撤銷"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── User list ─────────────────────────────────────────────────────────────────

function UserList({
  users,
  currentUserId,
  onRefresh,
}: {
  users: UserRecord[];
  currentUserId: string;
  onRefresh: () => void;
}) {
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  async function handleRoleChange(userId: string, newRole: AssignableRole) {
    setChangingRole(userId);
    setRowErr((prev) => ({ ...prev, [userId]: "" }));
    try {
      const result = await apiChangeUserRole(userId, newRole);
      if (!result.ok) {
        setRowErr((prev) => ({ ...prev, [userId]: `改角色失敗：${result.error}` }));
        return;
      }
      onRefresh();
    } finally {
      setChangingRole(null);
    }
  }

  async function handleDeactivate(userId: string, email: string) {
    if (!window.confirm(`確定要停用帳號 ${email}？停用後該用戶將立即失去存取權，無法自行復原。`)) return;
    setDeactivating(userId);
    setRowErr((prev) => ({ ...prev, [userId]: "" }));
    try {
      const result = await apiDeactivateUser(userId);
      if (!result.ok) {
        setRowErr((prev) => ({ ...prev, [userId]: `停用失敗：${result.error}` }));
        return;
      }
      onRefresh();
    } finally {
      setDeactivating(null);
    }
  }

  if (users.length === 0) {
    return <div className="_tm-empty">尚無用戶紀錄</div>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="_tm-table">
        <thead>
          <tr>
            <th>狀態</th>
            <th>姓名</th>
            <th>信箱</th>
            <th>角色</th>
            <th>加入時間</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            const isOwner = u.role === "Owner";
            const canEdit = !isSelf && !isOwner && u.isActive;
            return (
              <tr key={u.id}>
                <td>
                  <span
                    className="_tm-badge"
                    style={{
                      color: u.isActive ? "#4caf50" : "rgba(255,255,255,0.3)",
                      border: `1px solid ${u.isActive ? "rgba(76,175,80,0.4)" : "rgba(255,255,255,0.15)"}`,
                      background: "transparent",
                    }}
                  >
                    {u.isActive ? "啟用" : "停用"}
                  </span>
                </td>
                <td>
                  {u.name}
                  {isSelf && (
                    <span style={{ color: "#ffb800", fontSize: 10, marginLeft: 6, fontFamily: "monospace" }}>
                      (你)
                    </span>
                  )}
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 11 }}>{u.email}</td>
                <td>
                  {isOwner || isSelf ? (
                    <span style={{ fontFamily: "monospace", fontSize: 12, color: isOwner ? "#ffb800" : "rgba(255,255,255,0.6)" }}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  ) : (
                    <select
                      className="_tm-role-select"
                      value={u.role}
                      disabled={!canEdit || changingRole === u.id}
                      onChange={(e) => void handleRoleChange(u.id, e.target.value as AssignableRole)}
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                      ))}
                    </select>
                  )}
                  {rowErr[u.id] && <div className="_tm-err" style={{ marginTop: 4 }}>{rowErr[u.id]}</div>}
                </td>
                <td style={{ fontFamily: "monospace", fontSize: 11, whiteSpace: "nowrap" }}>
                  {fmtDate(u.createdAt)}
                </td>
                <td>
                  {canEdit && (
                    <button
                      type="button"
                      className="_tm-deactivate-btn"
                      disabled={deactivating === u.id}
                      onClick={() => void handleDeactivate(u.id, u.email)}
                    >
                      {deactivating === u.id ? "停用中..." : "停用"}
                    </button>
                  )}
                  {!u.isActive && (
                    <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>已停用</span>
                  )}
                  {isSelf && <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page state machine ────────────────────────────────────────────────────────

type Phase =
  | "gate-loading"
  | "not-owner"
  | "loading"
  | "ready"
  | "error";

type PageData = {
  invites: InviteRecord[];
  users: UserRecord[];
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const [phase, setPhase] = useState<Phase>("gate-loading");
  const [currentUserId, setCurrentUserId] = useState("");
  const [data, setData] = useState<PageData>({ invites: [], users: [] });
  const [errMsg, setErrMsg] = useState("");
  const [newInvite, setNewInvite] = useState<CreatedInvite | null>(null);

  // Phase 1: gate check
  useEffect(() => {
    let cancelled = false;
    void apiGetMe().then((result) => {
      if (cancelled) return;
      if (!result.ok || result.user.role !== "Owner") {
        setPhase("not-owner");
        return;
      }
      setCurrentUserId(result.user.id);
      setPhase("loading");
    });
    return () => { cancelled = true; };
  }, []);

  // Phase 2: data fetch (triggered by phase === "loading")
  const fetchRef = useRef(0);
  useEffect(() => {
    if (phase !== "loading") return;
    const fetchSeq = ++fetchRef.current;
    let cancelled = false;

    async function load() {
      try {
        const [invRes, usrRes] = await Promise.all([apiListInvites(), apiListUsers()]);
        if (cancelled || fetchRef.current !== fetchSeq) return;
        if (!invRes.ok) throw new Error(invRes.error);
        if (!usrRes.ok) throw new Error(usrRes.error);
        setData({ invites: invRes.invites, users: usrRes.users });
        setPhase("ready");
      } catch (err) {
        if (cancelled || fetchRef.current !== fetchSeq) return;
        setErrMsg(err instanceof Error ? err.message : "資料載入失敗");
        setPhase("error");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [phase]);

  function handleRefresh() {
    setPhase("loading");
  }

  if (phase === "gate-loading") {
    return (
      <PageFrame code="TEAM" title="團隊與邀請" sub="Owner-only" note="驗證身份中…">
        <style>{TEAM_CSS}</style>
        <div className="state-panel">
          <span className="badge badge-amber">驗證中</span>
          <span className="state-reason">驗證身份中，請稍候。</span>
        </div>
      </PageFrame>
    );
  }

  if (phase === "not-owner") {
    return (
      <PageFrame code="TEAM" title="團隊與邀請" sub="Owner-only" note="此功能僅限 Owner 使用">
        <style>{TEAM_CSS}</style>
        <div className="state-panel">
          <span className="badge badge-red">無權限</span>
          <span className="state-reason">此功能僅限 Owner 帳號使用。</span>
        </div>
      </PageFrame>
    );
  }

  if (phase === "error") {
    return (
      <PageFrame code="TEAM" title="團隊與邀請" sub="Owner-only" note="載入失敗">
        <style>{TEAM_CSS}</style>
        <div className="state-panel">
          <span className="badge badge-red">載入失敗</span>
          <span className="state-reason">{errMsg || "無法取得資料，請重試。"}</span>
          <button type="button" className="mini-button" onClick={handleRefresh}>重試</button>
        </div>
      </PageFrame>
    );
  }

  if (phase === "loading") {
    return (
      <PageFrame code="TEAM" title="團隊與邀請" sub="Owner-only" note={<DataStateBadge state="empty" label="載入中…" testId="team-page-loading-badge" />}>
        <style>{TEAM_CSS}</style>
        <div className="state-panel">
          <span className="badge badge-amber">讀取中</span>
          <span className="state-reason">正在載入邀請與用戶清單…</span>
        </div>
      </PageFrame>
    );
  }

  return (
    <PageFrame
      code="TEAM"
      title="團隊與邀請"
      sub="Owner-only"
      note={`${data.invites.length} 筆邀請 / ${data.users.length} 位用戶`}
    >
      <style>{TEAM_CSS}</style>

      {/* One-time token modal */}
      {newInvite && (
        <TokenModal invite={newInvite} onClose={() => { setNewInvite(null); handleRefresh(); }} />
      )}

      {/* Invite section */}
      <Panel code="TEAM-INV" title="發出邀請" right="Owner / Admin">
        <InviteForm onCreated={(inv) => setNewInvite(inv)} />
      </Panel>

      <Panel
        code="TEAM-INV-LIST"
        title="邀請紀錄"
        right={
          <button type="button" className="mini-button" onClick={handleRefresh} style={{ marginLeft: "auto" }}>
            重整
          </button>
        }
      >
        <InviteList invites={data.invites} onRefresh={handleRefresh} />
      </Panel>

      {/* Users section */}
      <Panel code="TEAM-USERS" title="用戶管理" right="Owner-only">
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 12 }}>
          停用操作立即生效。停用後該用戶下次請求即失去存取權。無法更改自己的角色，亦無法操作 Owner 帳號。
        </p>
        <UserList users={data.users} currentUserId={currentUserId} onRefresh={handleRefresh} />
      </Panel>
    </PageFrame>
  );
}
