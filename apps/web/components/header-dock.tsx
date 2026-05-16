"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, FileText, GripHorizontal, KeyRound, LogOut, RotateCcw, Settings, User, X } from "lucide-react";

import { apiLogout } from "@/lib/auth-client";
import { getHeaderDockNotifications, markHeaderDockNotificationRead, type NotificationEntry } from "@/lib/api";

type Drawer = "notifications" | "system" | null;
type NotificationDrawerState =
  | { status: "idle" | "loading"; notifications: NotificationEntry[]; unreadCount: number; error: null }
  | { status: "ready"; notifications: NotificationEntry[]; unreadCount: number; error: null }
  | { status: "error"; notifications: NotificationEntry[]; unreadCount: number; error: string };

interface DockPosition {
  top: number;
  left: number;
}

const STORAGE_KEY = "iuf-header-dock-position";
const DEFAULT_POSITION: DockPosition = { top: 16, left: -1 }; // -1 = use right:16 CSS default
const MOBILE_BREAKPOINT = 768;
const SCREEN_READER_ONLY_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

function loadPosition(): DockPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DockPosition;
    if (typeof parsed.top === "number" && typeof parsed.left === "number") return parsed;
  } catch {
    // ignore
  }
  return null;
}

function savePosition(pos: DockPosition) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function clearPosition() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function clampToViewport(top: number, left: number, el: HTMLElement): DockPosition {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const rect = el.getBoundingClientRect();
  const elW = rect.width || 200;
  const elH = rect.height || 48;
  return {
    top: Math.max(0, Math.min(top, h - elH)),
    left: Math.max(0, Math.min(left, w - elW)),
  };
}

function notificationTime(notification: NotificationEntry) {
  return notification.createdAt ?? notification.occurredAt ?? "";
}

function formatNotificationTime(value: string) {
  if (!value) return "時間待同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function notificationTitle(notification: NotificationEntry) {
  return notification.title ?? notification.message ?? notification.category ?? notification.type ?? "系統通知";
}

function notificationSeverity(notification: NotificationEntry) {
  return notification.severity === "critical" || notification.severity === "warning" ? notification.severity : "info";
}

function notificationHref(notification: NotificationEntry) {
  return notification.href?.startsWith("/") ? notification.href : "/alerts";
}

function notificationSummary(notification: NotificationEntry) {
  if (notification.message && notification.message !== notification.title) return notification.message;
  const payload = notification.metadata ?? {};
  const parts: string[] = [];
  for (const key of ["message", "title", "symbol", "ticker", "threshold"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
    if (typeof value === "number" && Number.isFinite(value)) parts.push(value.toLocaleString("zh-TW"));
    if (parts.length >= 2) break;
  }
  return parts.length > 0 ? parts.join(" / ") : "通知資料已同步，請至警示頁確認細節。";
}

function notificationReadState(notification: NotificationEntry) {
  return notification.readAt ? "已讀" : "未讀";
}

function notificationLinkLabel(notification: NotificationEntry) {
  const category = notification.category ?? notification.type ?? "SYSTEM";
  const time = formatNotificationTime(notificationTime(notification));
  return [
    notificationReadState(notification),
    notificationSeverity(notification),
    notificationTitle(notification),
    category,
    time,
    notificationSummary(notification),
  ].join(" ");
}

function notificationBellLabel(unreadCount: number, status: NotificationDrawerState["status"]) {
  if (status === "loading") return "警示通知，資料同步中";
  if (status === "error") return "警示通知，資料同步失敗";
  if (unreadCount > 0) return `警示通知，${unreadCount.toLocaleString("zh-TW")} 則未讀`;
  return "警示通知，無未讀";
}

function recentNotifications(notifications: NotificationEntry[]) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return notifications
    .filter((notification) => {
      const value = notificationTime(notification);
      if (!value) return true;
      const time = new Date(value).getTime();
      return Number.isFinite(time) ? time >= cutoff : true;
    })
    .sort((a, b) => new Date(notificationTime(b)).getTime() - new Date(notificationTime(a)).getTime());
}

export function HeaderDock() {
  const router = useRouter();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notificationDrawer, setNotificationDrawer] = useState<NotificationDrawerState>({
    status: "idle",
    notifications: [],
    unreadCount: 0,
    error: null,
  });

  // Position state: null = use CSS default (right:16px)
  const [position, setPosition] = useState<DockPosition | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const dockRef = useRef<HTMLDivElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const systemButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseButtonRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef<{
    dragging: boolean;
    startPointerX: number;
    startPointerY: number;
    startDockTop: number;
    startDockLeft: number;
    lastPosition: DockPosition;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const visibleNotifications = recentNotifications(notificationDrawer.notifications);
  const unreadCount = notificationDrawer.unreadCount;
  const notificationButtonLabel = notificationBellLabel(unreadCount, notificationDrawer.status);

  const loadNotificationDrawer = useCallback(async () => {
    setNotificationDrawer((current) => ({
      status: "loading",
      notifications: current.notifications,
      unreadCount: current.unreadCount,
      error: null,
    }));
    try {
      const response = await getHeaderDockNotifications({ limit: 50 });
      setNotificationDrawer({
        status: "ready",
        notifications: response.notifications,
        unreadCount: response.unread_count,
        error: null,
      });
    } catch {
      setNotificationDrawer({ status: "error", notifications: [], unreadCount: 0, error: "通知資料同步中。" });
    }
  }, []);

  const markNotificationRead = useCallback((notification: NotificationEntry) => {
    const markedAt = new Date().toISOString();
    const wasUnread = !notification.readAt;

    setNotificationDrawer((current) => ({
      ...current,
      notifications: current.notifications.map((item) => (
        item.id === notification.id ? { ...item, readAt: item.readAt ?? markedAt } : item
      )),
      unreadCount: wasUnread ? Math.max(0, current.unreadCount - 1) : current.unreadCount,
    }));

    void markHeaderDockNotificationRead(notification.id).catch(() => {
      void loadNotificationDrawer();
    });
  }, [loadNotificationDrawer]);

  const focusDrawerTrigger = useCallback((target: Exclude<Drawer, null>) => {
    window.requestAnimationFrame(() => {
      const trigger = target === "notifications" ? notificationButtonRef.current : systemButtonRef.current;
      trigger?.focus();
    });
  }, []);

  const closeDrawer = useCallback(() => {
    const target = drawer;
    setDrawer(null);
    if (target) focusDrawerTrigger(target);
  }, [drawer, focusDrawerTrigger]);

  // Detect mobile and load saved position on mount
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    checkMobile();
    window.addEventListener("resize", checkMobile);

    const saved = loadPosition();
    if (saved) setPosition(saved);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (drawer) {
        event.preventDefault();
        closeDrawer();
        return;
      }
      if (accountOpen) {
        setAccountOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [accountOpen, closeDrawer, drawer]);

  useEffect(() => {
    if (drawer === "notifications") void loadNotificationDrawer();
  }, [drawer, loadNotificationDrawer]);

  useEffect(() => {
    if (!drawer) return;
    const frame = window.requestAnimationFrame(() => {
      drawerCloseButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawer]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (isMobile) return;
    // Only drag on the grip handle or middle-mouse-button-like intent
    const target = e.target as HTMLElement;
    const isGrip = target.closest("[data-drag-handle]") !== null;
    if (!isGrip) return;

    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);

    const el = dockRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    dragState.current = {
      dragging: true,
      startPointerX: e.clientX,
      startPointerY: e.clientY,
      startDockTop: rect.top,
      startDockLeft: rect.left,
      lastPosition: clampToViewport(rect.top, rect.left, el),
    };
    setIsDragging(true);
  }, [isMobile]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragState.current?.dragging) return;
    e.preventDefault();

    const el = dockRef.current;
    if (!el) return;

    const dx = e.clientX - dragState.current.startPointerX;
    const dy = e.clientY - dragState.current.startPointerY;

    const newTop = dragState.current.startDockTop + dy;
    const newLeft = dragState.current.startDockLeft + dx;

    const clamped = clampToViewport(newTop, newLeft, el);
    dragState.current.lastPosition = clamped;
    setPosition(clamped);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragState.current?.dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const finalPosition = dragState.current.lastPosition;
    dragState.current.dragging = false;
    setIsDragging(false);

    const el = dockRef.current;
    if (!el) return;
    // re-clamp and save
    const clamped = clampToViewport(finalPosition.top, finalPosition.left, el);
    setPosition(clamped);
    savePosition(clamped);
  }, []);

  function handleResetPosition() {
    clearPosition();
    setPosition(null);
    setAccountOpen(false);
  }

  async function handleLogout() {
    await apiLogout();
    router.push("/login");
  }

  const drawerTitle = drawer === "notifications" ? "警示" : "系統狀態";

  // Build inline style for position
  const dockStyle: React.CSSProperties = {};
  if (!isMobile && position !== null) {
    dockStyle.top = position.top;
    dockStyle.left = position.left;
    dockStyle.right = "auto";
  }
  if (isDragging) {
    dockStyle.transition = "none";
    dockStyle.userSelect = "none";
  }

  return (
    <>
      <div
        ref={dockRef}
        className="header-dock"
        aria-label="右上快捷列"
        style={dockStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Drag grip handle */}
        {!isMobile && (
          <span
            data-drag-handle="true"
            className="header-dock-grip"
            aria-label="拖拉移動"
            title="拖拉移動"
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
          >
            <GripHorizontal size={14} strokeWidth={1.8} />
          </span>
        )}

        <button
          ref={notificationButtonRef}
          type="button"
          className="header-dock-button"
          aria-label="警示"
          aria-expanded={drawer === "notifications"}
          aria-controls={drawer === "notifications" ? "header-dock-drawer" : undefined}
          aria-describedby="header-dock-bell-status"
          aria-busy={notificationDrawer.status === "loading" ? "true" : undefined}
          title="警示"
          onClick={() => {
            setAccountOpen(false);
            setDrawer((current) => (current === "notifications" ? null : "notifications"));
          }}
        >
          <Bell size={18} strokeWidth={1.8} />
          <span id="header-dock-bell-status" style={SCREEN_READER_ONLY_STYLE}>
            {notificationButtonLabel}
          </span>
          {unreadCount > 0 && (
            <span className="header-dock-count" aria-hidden="true">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        <Link className="header-dock-button" aria-label="今日簡報" title="今日簡報" href="/briefs">
          <FileText size={18} strokeWidth={1.8} />
        </Link>

        <button
          ref={systemButtonRef}
          type="button"
          className="header-dock-button"
          aria-label="系統狀態"
          aria-expanded={drawer === "system"}
          aria-controls={drawer === "system" ? "header-dock-drawer" : undefined}
          title="系統狀態"
          onClick={() => {
            setAccountOpen(false);
            setDrawer((current) => (current === "system" ? null : "system"));
          }}
        >
          <Settings size={18} strokeWidth={1.8} />
        </button>

        <button
          type="button"
          className="header-dock-button"
          aria-label="帳戶"
          aria-expanded={accountOpen}
          title="帳戶"
          onClick={() => {
            setDrawer(null);
            setAccountOpen((current) => !current);
          }}
        >
          <User size={18} strokeWidth={1.8} />
        </button>

        {accountOpen && (
          <div className="header-account-menu" role="menu" aria-label="帳戶選單">
            <div className="header-account-card">
              <span>個資</span>
              <b>Owner Workspace</b>
            </div>
            <Link
              className="header-account-menu-link"
              role="menuitem"
              href="/settings/account"
              onClick={() => setAccountOpen(false)}
            >
              <KeyRound size={15} strokeWidth={1.9} />
              <span>帳號設定</span>
            </Link>
            {position !== null && (
              <button type="button" role="menuitem" onClick={handleResetPosition}>
                <RotateCcw size={15} strokeWidth={1.9} />
                <span>重置位置</span>
              </button>
            )}
            <button type="button" role="menuitem" onClick={handleLogout}>
              <LogOut size={15} strokeWidth={1.9} />
              <span>登出</span>
            </button>
          </div>
        )}
      </div>

      {drawer && <button type="button" className="header-dock-scrim" aria-label="關閉面板" onClick={closeDrawer} />}

      {drawer && (
        <aside id="header-dock-drawer" className="header-dock-drawer" role="dialog" aria-modal="false" aria-label={drawerTitle}>
          <div className="header-dock-drawer-head">
            <div>
              <span className="tg gold">DOCK</span>
              <h2>{drawerTitle}</h2>
            </div>
            <button ref={drawerCloseButtonRef} type="button" aria-label="關閉" onClick={closeDrawer}>
              <X size={18} strokeWidth={1.9} />
            </button>
          </div>

          {drawer === "notifications" ? (
            <div className="header-dock-drawer-body">
              <div className="header-dock-state">
                <span>今日警示</span>
                <b>警示中心</b>
                <p>最近 7 天風控、委託、推薦與系統事件；來源為 notifications lane。</p>
              </div>
              {notificationDrawer.status === "loading" && <p className="header-dock-empty">資料同步中</p>}
              {notificationDrawer.status === "error" && <p className="header-dock-empty">{notificationDrawer.error}</p>}
              {notificationDrawer.status === "ready" && visibleNotifications.length === 0 && (
                <p className="header-dock-empty">
                  {unreadCount > 0
                    ? `尚有 ${unreadCount.toLocaleString("zh-TW")} 則未讀警示，請開啟警示頁確認完整紀錄。`
                    : "最近 7 天沒有未處理警示。"}
                </p>
              )}
              {visibleNotifications.length > 0 && (
                <div className="header-alert-list">
                  {visibleNotifications.slice(0, 8).map((notification) => (
                    <Link
                      key={notification.id}
                      className="header-alert-item"
                      data-severity={notificationSeverity(notification)}
                      aria-label={notificationLinkLabel(notification)}
                      href={notificationHref(notification)}
                      onClick={() => {
                        markNotificationRead(notification);
                        setDrawer(null);
                      }}
                    >
                      <span>{notification.readAt ? "已讀" : "待處理"}</span>
                      <b>{notificationTitle(notification)}</b>
                      <small>{notification.category ?? notification.type ?? "SYSTEM"} / {formatNotificationTime(notificationTime(notification))}</small>
                      <p>{notificationSummary(notification)}</p>
                    </Link>
                  ))}
                </div>
              )}
              <Link href="/alerts" onClick={() => setDrawer(null)}>
                開啟警示頁
              </Link>
            </div>
          ) : (
            <div className="header-dock-drawer-body">
              <div className="header-dock-state">
                <span>STATUS</span>
                <b>SIM-only v1</b>
                <p>模擬交易與券商 SIM 會清楚分線；正式交易維持關閉。</p>
              </div>
              <Link href="/ops" onClick={() => setDrawer(null)}>
                開啟營運監控
              </Link>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
