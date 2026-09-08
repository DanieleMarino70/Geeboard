"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  ChevronRight,
  Clock,
  Cpu,
  FolderClosed,
  KeyRound,
  LayoutGrid,
  Moon,
  Package,
  PanelLeft,
  Search,
  Server,
  Settings2,
  Shield,
  Store,
  Sun,
  Terminal,
  LogOut,
  Users,
  Zap,
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { ToastProvider } from "./toast";
import { Avatar } from "./ui";

export interface ShellUser {
  name: string;
  initials: string;
  role: string;
}

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MODERATOR: "Moderator",
  MEMBER: "Member",
};

const NAV = [
  {
    label: "Workspace",
    items: [
      { name: "Dashboard", icon: LayoutGrid, href: "/" },
      { name: "Activity", icon: Activity, href: "/activity" },
      { name: "Analytics", icon: BarChart3, href: "/analytics" },
    ],
  },
  {
    label: "Servers",
    items: [
      { name: "Servers", icon: Server, href: "/servers", count: "4" },
      { name: "Console", icon: Terminal, href: "/console" },
      { name: "Files", icon: FolderClosed, href: "/files" },
      { name: "Backups", icon: Archive, href: "/backups" },
      { name: "Scheduler", icon: Clock, href: "/scheduler" },
      { name: "Plugins", icon: Package, href: "/plugins" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { name: "Nodes", icon: Cpu, href: "/nodes", dot: "warning" },
      { name: "Marketplace", icon: Store, href: "/marketplace" },
    ],
  },
  {
    label: "Organisation",
    items: [
      { name: "Members", icon: Users, href: "/members" },
      { name: "API keys", icon: KeyRound, href: "/api-keys" },
      { name: "Audit log", icon: Shield, href: "/audit" },
      { name: "Settings", icon: Settings2, href: "/settings" },
    ],
  },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function ThemeToggle({ className }: { className?: string }) {
  const [light, setLight] = useState(false);

  useEffect(() => {
    setLight(document.documentElement.getAttribute("data-theme") === "light");
  }, []);

  const toggle = () => {
    const next = !light;
    setLight(next);
    const root = document.documentElement;
    if (next) root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    try {
      localStorage.setItem("gb-theme", next ? "light" : "dark");
    } catch {}
  };

  const Icon = light ? Moon : Sun;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark theme" : "Switch to light theme"}
      className={clsx(
        "grid shrink-0 place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink",
        className,
      )}
    >
      <Icon size={14} strokeWidth={1.8} />
    </button>
  );
}

function Sidebar({ user }: { user: ShellUser }) {
  const isActive = useActive();

  return (
    <nav
      aria-label="Primary"
      className="hidden w-[252px] shrink-0 flex-col border-r border-line bg-bg-2 lg:flex"
    >
      <div className="flex items-center gap-[10px] px-[18px] pt-[18px] pb-[14px]">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-accent-ink shadow-[0_0_0_1px_var(--accent-line),0_6px_18px_-8px_var(--accent)]">
          <Zap size={16} strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.01em]">Geeboard</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
            v3.2 · community
          </div>
        </div>
        <button
          type="button"
          aria-label="Collapse sidebar"
          className="ml-auto grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink-2"
        >
          <PanelLeft size={15} strokeWidth={1.8} />
        </button>
      </div>

      <button
        type="button"
        className="mx-[10px] mb-3 flex items-center gap-[9px] rounded-[9px] border border-line bg-bg px-[10px] py-2 text-[12.5px] text-ink-4 transition-colors duration-150 hover:border-line-2 hover:bg-card-2"
      >
        <Search size={14} strokeWidth={1.9} />
        <span className="flex-1 text-left">Search or jump…</span>
        <kbd className="rounded-[5px] border border-line bg-card-2 px-[5px] py-[2px] font-mono text-[10px] text-ink-4">
          ⌘K
        </kbd>
      </button>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[10px] pb-[10px] [scrollbar-width:none]">
        {NAV.map((group) => (
          <div key={group.label}>
            <div className="px-[10px] pb-[7px] font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-4">
              {group.label}
            </div>
            <div className="flex flex-col gap-px">
              {group.items.map((item) => {
                const on = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={on ? "page" : undefined}
                    className={clsx(
                      "flex w-full items-center gap-[10px] rounded-lg px-[10px] py-[7px] text-[12.5px] transition-colors duration-150",
                      on
                        ? "bg-accent-soft font-medium text-ink"
                        : "text-ink-3 hover:bg-card hover:text-ink-2",
                    )}
                  >
                    <span className={clsx("grid shrink-0 place-items-center", on ? "text-accent" : "text-ink-4")}>
                      <Icon size={16} strokeWidth={1.7} />
                    </span>
                    <span className="flex-1 truncate text-left">{item.name}</span>
                    {"dot" in item && item.dot ? (
                      <span className="h-[6px] w-[6px] shrink-0 animate-(--animate-pulse-dot) rounded-full bg-warning text-warning" />
                    ) : null}
                    {"count" in item && item.count ? (
                      <span className="font-mono text-[10px] text-ink-4">{item.count}</span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-[10px]">
        <div className="flex items-center gap-[10px] rounded-[9px] px-2 py-[7px] transition-colors duration-150 hover:bg-card">
          <Avatar initials={user.initials} size={26} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium">{user.name}</div>
            <div className="text-[10.5px] text-ink-4">{ROLE_LABEL[user.role] ?? user.role}</div>
          </div>
          <ThemeToggle className="h-[26px] w-[26px]" />
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-danger"
            >
              <LogOut size={14} strokeWidth={1.8} />
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}

function Topbar({ crumbs, actions, user }: { crumbs: string[]; actions?: React.ReactNode; user: ShellUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-glass px-5 backdrop-blur-[16px] backdrop-saturate-150 sm:px-8">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[7px] overflow-hidden">
        {crumbs.map((c, i) => (
          <span key={c} className="flex items-center gap-[7px]">
            {i > 0 && <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-ink-4" />}
            <span
              className={clsx(
                "whitespace-nowrap text-[12.5px]",
                i === crumbs.length - 1 ? "font-medium text-ink" : "text-ink-3",
              )}
            >
              {c}
            </span>
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-[6px]">
        {actions}
        <button
          type="button"
          aria-label="Search"
          className="grid h-8 w-8 place-items-center rounded-[9px] text-ink-3 transition-colors duration-150 hover:bg-card hover:text-ink"
        >
          <Search size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          aria-label="Notifications"
          className="relative grid h-8 w-8 place-items-center rounded-[9px] text-ink-3 transition-colors duration-150 hover:bg-card hover:text-ink"
        >
          <Bell size={16} strokeWidth={1.7} />
          <span className="absolute top-[6px] right-[7px] h-[6px] w-[6px] rounded-full bg-accent shadow-[0_0_0_2px_var(--bg-2)]" />
        </button>
        <ThemeToggle className="h-8 w-8 lg:hidden" />
        <div className="mx-1 h-5 w-px bg-(--border)" />
        <form action={signOut} className="lg:hidden">
          <button
            type="submit"
            aria-label="Sign out"
            className="grid h-8 w-8 place-items-center rounded-[9px] text-ink-3 transition-colors duration-150 hover:bg-card hover:text-danger"
          >
            <LogOut size={16} strokeWidth={1.7} />
          </button>
        </form>
        <Avatar initials={user.initials} size={28} />
      </div>
    </header>
  );
}

/* Mobile: the sidebar becomes a five-item bottom bar, never a
   squeezed desktop nav. */
function BottomBar() {
  const isActive = useActive();
  const items = [
    { name: "Home", icon: LayoutGrid, href: "/" },
    { name: "Servers", icon: Server, href: "/servers" },
    { name: "Console", icon: Terminal, href: "/console" },
    { name: "Stats", icon: BarChart3, href: "/analytics" },
    { name: "Settings", icon: Settings2, href: "/settings" },
  ];
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-line bg-glass px-2 pt-2 pb-4 backdrop-blur-[18px] backdrop-saturate-150 lg:hidden"
    >
      {items.map((item) => {
        const on = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.name}
            href={item.href}
            aria-current={on ? "page" : undefined}
            className={clsx(
              "flex min-h-12 flex-1 flex-col items-center justify-center gap-[5px] rounded-xl px-1 py-2",
              on ? "bg-accent-soft text-accent" : "text-ink-4",
            )}
          >
            <Icon size={20} strokeWidth={1.7} />
            <span className={clsx("text-[10px]", on && "font-medium")}>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  crumbs,
  actions,
  user,
  children,
}: {
  crumbs: string[];
  actions?: React.ReactNode;
  user: ShellUser;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-bg">
        <Sidebar user={user} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar crumbs={crumbs} actions={actions} user={user} />
          <main className="min-h-0 flex-1 pb-24 lg:pb-0">{children}</main>
        </div>
        <BottomBar />
      </div>
    </ToastProvider>
  );
}
