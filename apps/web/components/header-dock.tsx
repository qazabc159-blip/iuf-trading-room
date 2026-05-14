"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, FileText, GripHorizontal, KeyRound, LogOut, RotateCcw, Settings, User, X } from "lucide-react";

import { apiLogout } from "@/lib/auth-client";

type Drawer = "alerts" | "system" | null;

interface DockPosition {
  top: number;
  left: number;
}

const STORAGE_KEY = "iuf-header-dock-position";
const DEFAULT_POSITION: DockPosition = { top: 16, left: -1 }; // -1 = use right:16 CSS default
const MOBILE_BREAKPOINT = 768;

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

export function HeaderDock() {
  const router = useRouter();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  // Position state: null = use CSS default (right:16px)
  const [position, setPosition] = useState<DockPosition | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const dockRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    dragging: boolean;
    startPointerX: number;
    startPointerY: number;
    startDockTop: number;
    startDockLeft: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
      if (event.key === "Escape") {
        setDrawer(null);
        setAccountOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    setPosition(clamped);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!dragState.current?.dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragState.current.dragging = false;
    setIsDragging(false);

    const el = dockRef.current;
    if (!el || !position) return;
    // re-clamp and save
    const clamped = clampToViewport(position.top, position.left, el);
    setPosition(clamped);
    savePosition(clamped);
  }, [position]);

  function handleResetPosition() {
    clearPosition();
    setPosition(null);
    setAccountOpen(false);
  }

  async function handleLogout() {
    await apiLogout();
    router.push("/login");
  }

  const drawerTitle = drawer === "alerts" ? "警示" : "系統狀態";

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
          type="button"
          className="header-dock-button"
          aria-label="警示"
          aria-expanded={drawer === "alerts"}
          aria-controls={drawer === "alerts" ? "header-dock-drawer" : undefined}
          title="警示"
          onClick={() => {
            setAccountOpen(false);
            setDrawer((current) => (current === "alerts" ? null : "alerts"));
          }}
        >
          <Bell size={18} strokeWidth={1.8} />
          <span className="header-dock-dot" aria-hidden="true" />
        </button>

        <Link className="header-dock-button" aria-label="今日簡報" title="今日簡報" href="/briefs">
          <FileText size={18} strokeWidth={1.8} />
        </Link>

        <button
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

      {drawer && <button type="button" className="header-dock-scrim" aria-label="關閉面板" onClick={() => setDrawer(null)} />}

      {drawer && (
        <aside id="header-dock-drawer" className="header-dock-drawer" role="dialog" aria-modal="false" aria-label={drawerTitle}>
          <div className="header-dock-drawer-head">
            <div>
              <span className="tg gold">DOCK</span>
              <h2>{drawerTitle}</h2>
            </div>
            <button type="button" aria-label="關閉" onClick={() => setDrawer(null)}>
              <X size={18} strokeWidth={1.9} />
            </button>
          </div>

          {drawer === "alerts" ? (
            <div className="header-dock-drawer-body">
              <div className="header-dock-state">
                <span>DAY 6</span>
                <b>Notification Center</b>
                <p>最近 7 天事件準備接入：風控、委託、推薦變更與系統事件。</p>
              </div>
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
