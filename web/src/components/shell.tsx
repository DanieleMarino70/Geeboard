"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import clsx from "clsx";
import {
  Activity,
  Archive,
  BarChart3,
  ChevronRight,
  Clock,
  Cpu,
  FolderClosed,
  Gamepad2,
  KeyRound,
  LayoutGrid,
  Moon,
  Server,
  Settings2,
  Shield,
  Sun,
  Terminal,
  LogOut,
  Users,
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { BrandMark } from "./brand-mark";
import { ToastProvider } from "./toast";
import { Avatar } from "./ui";

/* What the shell shows of the signed-in person — narrowed by shellUser()
   in lib/ui-types.ts, and re-exported here because this is where pages
   import the shell from. Handing it a whole `User` row put that row's
   password hash in the HTML of every page; see the comment there. */
/* Narrowed by shellUser() in lib/ui-types.ts, which pages import from
   there rather than from here: this file is a client component, and a
   function re-exported from one cannot be called on the server. Handing
   the shell a whole `User` row put that row's password hash in the HTML
   of every page; see the comment there. */
import type { ShellUser } from "@/lib/ui-types";
import { PANEL_VERSION } from "@/lib/version";
export type { ShellUser };

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MODERATOR: "Moderator",
  MEMBER: "Member",
};

/* No counts or alert dots here. The design's sidebar carried "4" beside
   Servers and a warning dot beside Nodes, and as constants they said the
   same thing on an empty workspace as on a burning one. A badge in the
   navigation is a claim about the fleet; it comes back when something
   reads the fleet to make it.

   Only pages that do something are listed. Plugins and Marketplace were
   here as placeholders for features with nothing behind them — mods are
   not implemented — and a navigation entry is a promise. Their routes
   still answer, saying so. */
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
      { name: "Servers", icon: Server, href: "/servers" },
      { name: "Console", icon: Terminal, href: "/console" },
      { name: "Files", icon: FolderClosed, href: "/files" },
      { name: "Backups", icon: Archive, href: "/backups" },
      { name: "Scheduler", icon: Clock, href: "/scheduler" },
      { name: "Players", icon: Users, href: "/players" },
    ],
  },
  {
    label: "Catalog",
    items: [{ name: "Games", icon: Gamepad2, href: "/games" }],
  },
  {
    label: "Infrastructure",
    items: [{ name: "Nodes", icon: Cpu, href: "/nodes" }],
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

/* The theme lives on <html>, rendered there by the root layout from the
   gb-theme cookie. Reading it through an external store keeps React in
   step with the DOM without seeding state from an effect. */
const themeListeners = new Set<() => void>();
const subscribeTheme = (fn: () => void) => {
  themeListeners.add(fn);
  return () => themeListeners.delete(fn);
};
const isLight = () => document.documentElement.getAttribute("data-theme") === "light";

function ThemeToggle({ className }: { className?: string }) {
  const light = useSyncExternalStore(subscribeTheme, isLight, () => false);

  const toggle = useCallback(() => {
    const root = document.documentElement;
    const next = !isLight();
    if (next) root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    // A year; the server reads it to render the next page in this theme.
    document.cookie = `gb-theme=${next ? "light" : "dark"}; path=/; max-age=31536000; samesite=lax`;
    themeListeners.forEach((fn) => fn());
  }, []);

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
        <BrandMark size={26} className="shrink-0 text-accent" />
        {/* The design carried a version ("v3.2 · community"), a collapse
            button and a search box here. None of them was real. The
            version is now: it comes from package.json through
            next.config.ts, so it is the number this build was made from.
            The other two are still not. */}
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-[-0.01em]">Geeboard</div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.09em] text-ink-4">
            v{PANEL_VERSION} · game server panel
          </div>
        </div>
      </div>

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
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-line p-[10px]">
        <div className="flex items-center gap-[10px] rounded-[9px] px-2 py-[7px] transition-colors duration-150 hover:bg-card">
          {/* The name opens the account page: password, two-factor, sessions. */}
          <Link href="/account" className="flex min-w-0 flex-1 items-center gap-[10px]" title="Your account">
            <Avatar initials={user.initials} size={26} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-medium">{user.name}</div>
              <div className="text-[10.5px] text-ink-4">{ROLE_LABEL[user.role] ?? user.role}</div>
            </div>
          </Link>
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

/* A crumb with an address is a link back up the hierarchy; the last one
   is where you are. The first crumb used to be "Ashfold", the sample
   workspace's name, on every panel whatever it was called. */
export type Crumb = string | { label: string; href: string };

function Topbar({ crumbs, actions, user }: { crumbs: Crumb[]; actions?: React.ReactNode; user: ShellUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-glass px-5 backdrop-blur-[16px] backdrop-saturate-150 sm:px-8">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[7px] overflow-hidden">
        {crumbs.map((c, i) => {
          const label = typeof c === "string" ? c : c.label;
          const last = i === crumbs.length - 1;
          return (
            <span key={`${label}-${i}`} className="flex min-w-0 items-center gap-[7px]">
              {i > 0 && <ChevronRight size={13} strokeWidth={2} className="shrink-0 text-ink-4" />}
              {typeof c !== "string" && !last ? (
                <Link href={c.href} className="truncate whitespace-nowrap text-[12.5px] text-ink-3 hover:text-ink">
                  {label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={clsx(
                    "truncate whitespace-nowrap text-[12.5px]",
                    last ? "font-medium text-ink" : "text-ink-3",
                  )}
                >
                  {label}
                </span>
              )}
            </span>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center gap-[6px]">
        {actions}
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
    { name: "Nodes", icon: Cpu, href: "/nodes" },
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
  crumbs: Crumb[];
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
