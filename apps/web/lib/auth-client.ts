const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

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

export async function apiLogin(email: string, password: string): Promise<AuthResult> {
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
  inviteCode: string,
): Promise<AuthResult> {
  try {
    const res = await fetch(`${API_BASE}/auth/register-with-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password, inviteCode }),
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
      credentials: "include",
    });
  } catch {
    // Best-effort logout still clears the middleware-visible presence cookie.
  }
  clearAuthPresence();
}

export async function apiGetMe(): Promise<AuthSuccess | AuthFailure> {
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

export function authErrorMessage(error: string): string {
  switch (error) {
    case "invalid_credentials":
      return "電子信箱或密碼錯誤。";
    case "invalid_invite_code":
      return "邀請碼無效。";
    case "invite_already_used":
      return "此邀請碼已被使用。";
    case "invite_expired":
      return "此邀請碼已過期。";
    case "email_already_registered":
      return "此電子信箱已註冊。";
    case "no_workspace":
      return "帳號尚未綁定工作區，請聯絡管理員。";
    case "unauthenticated":
      return "登入已失效，請重新登入。";
    case "network_error":
      return "無法連線到驗證服務，請稍後再試。";
    default:
      return `登入失敗：${error}`;
  }
}
