"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  Download,
  PanelLeft,
  Pause,
  Play,
  RotateCw,
  Search,
  Send,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import { Button, Card, Pill } from "@/components/ui";
import {
  COMMAND_SUGGESTIONS,
  CONSOLE_LOG,
  LOG_COLOUR,
  type LogLevel,
  type LogLine,
} from "@/lib/mock";

const FILTERS = ["All", "Info", "Warn", "Error", "Chat", "Commands"] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LEVELS: Record<Filter, LogLevel[] | null> = {
  All: null,
  Info: ["INFO", "JOIN", "LEFT"],
  Warn: ["WARN"],
  Error: ["ERROR"],
  Chat: ["CHAT"],
  Commands: ["CMD"],
};

function clock() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

export function ConsoleView({ serverName }: { serverName: string }) {
  const [lines, setLines] = useState<LogLine[]>(CONSOLE_LOG);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const tailRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const levels = FILTER_LEVELS[filter];
    return lines.filter((l) => {
      if (levels && !levels.includes(l.level)) return false;
      if (query && !l.message.toLowerCase().includes(query.toLowerCase())) return false;
      return true;
    });
  }, [lines, filter, query]);

  const matchCount = useMemo(
    () => (query ? lines.filter((l) => l.message.toLowerCase().includes(query.toLowerCase())).length : 0),
    [lines, query],
  );

  useEffect(() => {
    if (!paused) tailRef.current?.scrollIntoView({ block: "end" });
  }, [visible, paused]);

  /* Stands in for the daemon's WebSocket stream. */
  useEffect(() => {
    if (paused) return;
    const chatter: Array<[LogLevel, string]> = [
      ["INFO", "Autosave complete · 1.2 GB written in 812ms"],
      ["JOIN", "saltmarch joined the game (23 online)"],
      ["INFO", "Watchdog: tick time within budget (47.6ms)"],
      ["WARN", "Can't keep up! Running 1104ms behind"],
      ["LEFT", "kestrelbay left the game (22 online)"],
    ];
    const t = setInterval(() => {
      const [level, message] = chatter[Math.floor(Math.random() * chatter.length)];
      setLines((prev) => [...prev.slice(-200), { time: clock(), level, message }]);
    }, 4000);
    return () => clearInterval(t);
  }, [paused]);

  const send = () => {
    const value = command.trim();
    if (!value) return;
    setLines((prev) => [
      ...prev,
      { time: clock(), level: "CMD", message: value },
      { time: clock(), level: "INFO", message: `Issued server command: ${value}` },
    ]);
    setHistory((h) => [value, ...h].slice(0, 50));
    setHistoryIndex(-1);
    setCommand("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(historyIndex + 1, history.length - 1);
      if (next >= 0 && history[next] !== undefined) {
        setHistoryIndex(next);
        setCommand(history[next]);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setCommand(next >= 0 ? (history[next] ?? "") : "");
    }
  };

  return (
    <div className="flex flex-col gap-[14px] px-5 pt-[22px] pb-[26px] sm:px-8">
      <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-center">
        <div className="min-w-0">
          <h1 className="text-[clamp(21px,2.6vw,24px)] font-semibold tracking-[-0.025em]">Console</h1>
          <div className="mt-[6px] flex items-center gap-[10px]">
            <span className="font-mono text-[11px] text-ink-4">{serverName} · fra-node-02</span>
            <Pill tone={paused ? "muted" : "success"} pulse={!paused}>
              {paused ? "Paused" : "Attached"}
            </Pill>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 lg:ml-auto">
          <Button intent="secondary" size="sm" icon={PanelLeft}>
            Split view
          </Button>
          <Button intent="secondary" size="sm" icon={Download}>
            Download log
          </Button>
          <Button intent="secondary" size="sm" icon={RotateCw}>
            Restart
          </Button>
          <Button intent="destructive" size="sm" icon={Square}>
            Stop
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="flex w-[280px] items-center gap-2 rounded-[9px] border border-line bg-bg-2 px-[11px] py-[7px] focus-within:border-accent-line">
          <Search size={14} strokeWidth={1.9} className="shrink-0 text-ink-4" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search output…"
            aria-label="Search console output"
            className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink-2 outline-none placeholder:text-ink-4"
          />
          {query ? (
            <span className="shrink-0 font-mono text-[9.5px] text-ink-4 tnum">{matchCount}</span>
          ) : null}
        </div>

        <div className="inline-flex gap-px rounded-[9px] bg-(--border) p-px">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-lg px-3 py-[6px] text-[11.5px] transition-colors duration-150 ${
                filter === f ? "bg-card-2 text-ink" : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
            title={paused ? "Resume auto-scroll" : "Pause auto-scroll"}
            className={`grid h-[29px] w-[29px] place-items-center rounded-lg transition-colors duration-150 hover:bg-card-2 hover:text-ink ${
              paused ? "text-accent" : "text-ink-4"
            }`}
          >
            {paused ? <Play size={15} strokeWidth={1.7} /> : <Pause size={15} strokeWidth={1.7} />}
          </button>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(visible.map((l) => `[${l.time} ${l.level}] ${l.message}`).join("\n"))}
            aria-label="Copy visible output"
            title="Copy visible output"
            className="grid h-[29px] w-[29px] place-items-center rounded-lg text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink"
          >
            <Copy size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            onClick={() => setLines([])}
            aria-label="Clear console"
            title="Clear console"
            className="grid h-[29px] w-[29px] place-items-center rounded-lg text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink"
          >
            <Trash2 size={15} strokeWidth={1.7} />
          </button>
          <button
            type="button"
            aria-label="Console settings"
            title="Console settings"
            className="grid h-[29px] w-[29px] place-items-center rounded-lg text-ink-4 transition-colors duration-150 hover:bg-card-2 hover:text-ink"
          >
            <SlidersHorizontal size={15} strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-260px)] min-h-[420px] flex-col overflow-hidden rounded-[14px] border border-line bg-con-bg">
        <div className="flex shrink-0 items-center gap-[10px] border-b border-line bg-bg-2 px-4 py-[9px]">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">
            stdout · latest {lines.length} lines
          </span>
          <span
            className={`ml-auto flex items-center gap-[6px] font-mono text-[9.5px] ${paused ? "text-ink-4" : "text-success"}`}
          >
            <span
              className={`h-[5px] w-[5px] rounded-full bg-current ${paused ? "" : "animate-(--animate-pulse-dot)"}`}
            />
            {paused ? "paused" : "streaming"}
          </span>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-4 py-[14px] font-mono text-[11.5px] leading-[1.9]"
          role="log"
          aria-live="polite"
          aria-label="Server output"
        >
          {visible.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="text-[13px] font-semibold text-con-ink">Nothing matches</div>
                <p className="mx-auto mt-2 max-w-[34ch] text-[11.5px] leading-relaxed text-con-dim">
                  {lines.length === 0
                    ? "The console was cleared. New output will appear as the server produces it."
                    : "No lines match that filter and search. Try widening one of them."}
                </p>
              </div>
            </div>
          ) : (
            visible.map((l, i) => {
              const c = LOG_COLOUR[l.level];
              return (
                <div
                  key={`${l.time}-${i}`}
                  className="flex gap-[14px] rounded-[4px] py-px transition-colors duration-100 hover:bg-[hsl(230_20%_12%/0.6)]"
                >
                  <span className="w-[56px] shrink-0 pt-[2px] text-[10.5px] text-con-dim">{l.time}</span>
                  <span className={`w-[46px] shrink-0 pt-px text-[10.5px] tracking-[0.04em] ${c.level}`}>
                    {l.level}
                  </span>
                  <span className={`min-w-0 flex-1 break-words ${c.message}`}>{l.message}</span>
                </div>
              );
            })
          )}
          <div ref={tailRef} />
        </div>

        <div className="shrink-0 border-t border-line bg-bg-2 px-[14px] py-[10px]">
          <div className="flex items-center gap-[10px] rounded-[10px] border border-accent-line bg-bg px-3 py-[9px] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <span className="shrink-0 font-mono text-[12.5px] text-accent">&gt;</span>
            <input
              ref={inputRef}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a command — try /say or /whitelist"
              aria-label="Server command"
              className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-ink-4"
            />
            <kbd className="hidden shrink-0 rounded-[5px] border border-line bg-card-2 px-[6px] py-[2px] font-mono text-[9.5px] text-ink-4 sm:block">
              ↑ history
            </kbd>
            <button
              type="button"
              onClick={send}
              aria-label="Send command"
              className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-accent text-accent-ink transition-[filter] duration-150 hover:brightness-110"
            >
              <Send size={14} strokeWidth={2} />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-[6px] pl-[2px]">
            <span className="font-mono text-[9.5px] text-ink-4">suggestions</span>
            {COMMAND_SUGGESTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCommand(c + " ");
                  inputRef.current?.focus();
                }}
                className={`rounded-md border px-2 py-[3px] font-mono text-[10px] transition-colors duration-150 ${
                  command.startsWith(c)
                    ? "border-accent-line bg-accent-soft text-accent"
                    : "border-line bg-card-2 text-ink-3 hover:text-ink"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
