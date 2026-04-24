/**
 * auth-client.ts
 * Client-side auth helpers — login / register / logout / session check.
 *
 * Backend API contract (Jason's auth-store, already in server.ts):
 *
 *   POST /auth/login
 *     body: { email: string; password: string }
 *     200 → { user: { id, email, name, role, workspaceId }, workspace: { id, name, slug } }
 *     Set-Cookie: iuf_session=<signed_value>; HttpOnly; SameSite=Lax
 *     401 → { error: "invalid_credentials" }
 *
 *   POST /auth/register-with-invite
 *     body: { email: string; password: string; inviteCode: string }
 *     200 → { user, workspace }
 *     Set-Cookie: iuf_session=...
 *     400 → { error: "invalid_invite_code" | "invite_already_used" | "invite_expired" | "email_already_registered" }
 *
 *   POST /auth/logout
 *     200 → { ok: true }
 *     Set-Cookie: iuf_session=; Max-Age=0  (clear)
 *
 *   GET /auth/me
 *     200 → { user, workspace }
 *     401 → { error: "unauthenticated" }
 *
 * Session strategy:
 *   - Real session: HttpOnly `iuf_session` cookie sent by API server (browser handles automatically)
 *   - Presence indicator: client-writable `iuf_auth=1` cookie read by Next.js middleware
 *     (can't read HttpOnly cookies in middleware since they're set by a different origin)
 *   - Cross-origin dev: use `credentials: "include"` on all API calls
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

// ── Presence cookie (middleware-readable) ─────────────────────────────────────

export function setAuthPresence(): void {
  document.cookie = "iuf_auth=1; path=/; max-age=2592000; SameSite=Lax";
}

export function clearAuthPresence(): void {
  document.cookie = "iuf_auth=; path=/; max-age=0; SameSite=Lax";
}

export function isAuthenticated(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith("iuf_auth=1"));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  workspaceId: string | null;
};

export type AuthWorkspace = {
  id: string;
  name: string;
  slug: string;
};

export type AuthSuccess = {
  ok: true;
  user: AuthUser;
  workspace: AuthWorkspace;
};

export type AuthFailure = {
  ok: false;
  error: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

// ── Auth API calls ────────────────────────────────────────────────────────────

export async function apiLogin(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",          // send/receive cookies cross-origin
      body: JSON.stringify({ email, password })
    });

    if (res.status === 401) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? "invalid_credentials" };
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `server_error_${res.status}` };
    }

    const body = await res.json() as { user: AuthUser; workspace: AuthWorkspace };
    return { ok: true, user: body.user, workspace: body.workspace };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiRegister(
  email: string,
  password: string,
  inviteCode: string
): Promise<AuthResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/register-with-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, inviteCode })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `server_error_${res.status}` };
    }

    const body = await res.json() as { user: AuthUser; workspace: AuthWorkspace };
    return { ok: true, user: body.user, workspace: body.workspace };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiLogout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include"
    });
  } catch {
    // Best-effort — always clear client side regardless
  }
  clearAuthPresence();
}

export async function apiGetMe(): Promise<(AuthSuccess) | AuthFailure> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: "include"
    });

    if (!res.ok) {
      return { ok: false, error: "unauthenticated" };
    }

    const body = await res.json() as { user: AuthUser; workspace: AuthWorkspace };
    return { ok: true, user: body.user, workspace: body.workspace };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

// ── Error message mapper ──────────────────────────────────────────────────────

export function authErrorMessage(error: string): string {
  switch (error) {
    case "invalid_credentials":
      return "帳號或密碼錯誤";
    case "invalid_invite_code":
      return "邀請碼無效";
    case "invite_already_used":
      return "邀請碼已被使用";
    case "invite_expired":
      return "邀請碼已過期";
    case "email_already_registered":
      return "此 Email 已被註冊";
    case "no_workspace":
      return "找不到工作區，請聯繫管理員";
    case "network_error":
      return "網路連線失敗，請稍後再試";
    default:
      return `伺服器錯誤（${error}）`;
  }
}
