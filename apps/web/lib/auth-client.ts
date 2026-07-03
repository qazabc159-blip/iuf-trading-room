const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL
  ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001");

export function setAuthPresence(): void {
  document.cookie = "iuf_auth=1; path=/; max-age=2592000; SameSite=Lax";
}

export function clearAuthPresence(): void {
  document.cookie = "iuf_auth=; path=/; max-age=0; SameSite=Lax";
}

export function isAuthenticated(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((cookie) => cookie.trim().startsWith("iuf_auth=1"));
}

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

export type InviteIssueSuccess = {
  ok: true;
  code: string;
  expiresAt: string;
};

export type InviteIssueResult = InviteIssueSuccess | AuthFailure;

function missingApi(): AuthFailure {
  return { ok: false, error: "api_base_unconfigured" };
}

export async function apiLogin(email: string, password: string): Promise<AuthResult> {
  if (!API_BASE) return missingApi();

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? (res.status === 401 ? "invalid_credentials" : `server_error_${res.status}`) };
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
  inviteToken: string,
  name?: string,
): Promise<AuthResult> {
  if (!API_BASE) return missingApi();

  try {
    const res = await fetch(`${API_BASE}/auth/register-with-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ inviteToken, email, name: name?.trim() || email.split("@")[0], password }),
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

export async function apiIssueInvite(ttlMinutes: number): Promise<InviteIssueResult> {
  if (!API_BASE) return missingApi();

  try {
    const res = await fetch(`${API_BASE}/auth/issue-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ ttlMinutes }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: body.error ?? `server_error_${res.status}` };
    }

    const body = await res.json() as { data: { code: string; expiresAt: string } };
    return {
      ok: true,
      code: body.data.code,
      expiresAt: body.data.expiresAt,
    };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiLogout(): Promise<void> {
  try {
    if (API_BASE) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    }
  } catch {
    // Best-effort logout still clears the middleware-visible presence cookie.
  }
  clearAuthPresence();
}

export async function apiGetMe(): Promise<AuthSuccess | AuthFailure> {
  if (!API_BASE) return missingApi();

  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: "include",
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

// ── Change password ───────────────────────────────────────────────────────────

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; error: string };

export async function apiChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (!API_BASE) return missingApi();

  try {
    const res = await fetch(`${API_BASE}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    if (res.ok) return { ok: true };

    const body = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error ?? `server_error_${res.status}` };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export function authErrorMessage(error: string): string {
  switch (error) {
    case "invalid_credentials":
      return "帳號或密碼錯誤。";
    case "invalid_invite_code":
    case "invalid_or_expired":
      return "邀請連結無效或已過期，請聯繫邀請人。";
    case "invite_already_used":
      return "這組邀請碼已經使用過。";
    case "invite_expired":
      return "這組邀請碼已過期。";
    case "email_already_registered":
      return "這個信箱已經註冊。";
    case "no_workspace":
      return "這個帳號尚未連到交易工作台。";
    case "unauthenticated":
      return "登入狀態已失效，請重新登入。";
    case "forbidden_role":
      return "目前帳號沒有管理員權限。";
    case "user_not_found":
      return "找不到目前登入帳號，請重新登入。";
    case "api_base_unconfigured":
      return "登入資料服務尚未設定，登入功能暫時不可用。";
    case "network_error":
      return "連線失敗，請稍後再試。";
    default:
      if (error.startsWith("server_error_")) {
        return "伺服器暫時無法完成請求，請稍後再試。";
      }
      return "登入失敗，請稍後再試。";
  }
}

// ── Admin: Invite Management ──────────────────────────────────────────────────

export type InviteStatus = "pending" | "used" | "expired" | "revoked";

export type InviteRecord = {
  id: string;
  role: string;
  invitedEmail: string | null;
  label: string | null;
  createdBy: string;
  expiresAt: string;
  createdAt: string;
  usedAt: string | null;
  usedBy: string | null;
  revokedAt: string | null;
  status: InviteStatus;
};

export type CreatedInvite = {
  id: string;
  token: string;
  registrationUrl: string;
  expiresAt: string;
  role: string;
};

export type CreateInviteResult = ({ ok: true } & CreatedInvite) | AuthFailure;
export type InviteListResult = { ok: true; invites: InviteRecord[] } | AuthFailure;
export type RevokeResult = { ok: true } | AuthFailure;

export async function apiCreateInvite(params: {
  role: "Admin" | "Analyst" | "Trader" | "Viewer";
  invitedEmail?: string;
  label?: string;
  expiresInDays?: number;
}): Promise<CreateInviteResult> {
  if (!API_BASE) return missingApi();
  try {
    const body: Record<string, unknown> = { role: params.role };
    if (params.invitedEmail?.trim()) body.invitedEmail = params.invitedEmail.trim();
    if (params.label?.trim()) body.label = params.label.trim();
    if (params.expiresInDays) body.expiresInDays = params.expiresInDays;
    const res = await fetch(`${API_BASE}/api/v1/admin/invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: rb.error ?? `server_error_${res.status}` };
    }
    const rb = await res.json() as { data: CreatedInvite };
    return { ok: true, ...rb.data };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiListInvites(): Promise<InviteListResult> {
  if (!API_BASE) return missingApi();
  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/invites`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: rb.error ?? `server_error_${res.status}` };
    }
    const rb = await res.json() as { data: InviteRecord[] };
    return { ok: true, invites: rb.data };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiRevokeInvite(inviteId: string): Promise<RevokeResult> {
  if (!API_BASE) return missingApi();
  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/invites/${inviteId}/revoke`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: rb.error ?? `server_error_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

// ── Admin: User Management ────────────────────────────────────────────────────

export type UserRecord = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

export type UserListResult = { ok: true; users: UserRecord[] } | AuthFailure;
export type ChangeRoleResult = { ok: true } | AuthFailure;
export type DeactivateUserResult = { ok: true } | AuthFailure;

export async function apiListUsers(): Promise<UserListResult> {
  if (!API_BASE) return missingApi();
  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/users`, {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: rb.error ?? `server_error_${res.status}` };
    }
    const rb = await res.json() as { data: UserRecord[] };
    return { ok: true, users: rb.data };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiChangeUserRole(
  userId: string,
  role: "Admin" | "Analyst" | "Trader" | "Viewer",
): Promise<ChangeRoleResult> {
  if (!API_BASE) return missingApi();
  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/users/${userId}/role`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: rb.error ?? `server_error_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function apiDeactivateUser(userId: string): Promise<DeactivateUserResult> {
  if (!API_BASE) return missingApi();
  try {
    const res = await fetch(`${API_BASE}/api/v1/admin/users/${userId}/deactivate`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      const rb = await res.json().catch(() => ({})) as { error?: string };
      return { ok: false, error: rb.error ?? `server_error_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
