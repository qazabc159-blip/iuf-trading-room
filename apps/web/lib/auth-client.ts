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
  inviteCode: string,
): Promise<AuthResult> {
  if (!API_BASE) return missingApi();

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

export function authErrorMessage(error: string): string {
  switch (error) {
    case "invalid_credentials":
      return "帳號或密碼錯誤。";
    case "invalid_invite_code":
      return "邀請碼無效。";
    case "invite_already_used":
      return "這組邀請碼已經使用過。";
    case "invite_expired":
      return "這組邀請碼已過期。";
    case "email_already_registered":
      return "這個信箱已經註冊。";
    case "no_workspace":
      return "這個帳號尚未連到 workspace。";
    case "unauthenticated":
      return "登入狀態已失效，請重新登入。";
    case "api_base_unconfigured":
      return "前端尚未設定後端 API，登入功能暫時不可用。";
    case "network_error":
      return "連線失敗，請稍後再試。";
    default:
      if (error.startsWith("server_error_")) {
        return "伺服器暫時無法完成請求，請稍後再試。";
      }
      return "登入失敗，請稍後再試。";
  }
}
