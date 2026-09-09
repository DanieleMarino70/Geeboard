"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/* Debounced so typing does not fire a query per keystroke. */
export function AuditSearch({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const router = useRouter();
  const params = useSearchParams();
  const latest = useRef(defaultValue);

  useEffect(() => {
    if (value === latest.current) return;
    const t = setTimeout(() => {
      latest.current = value;
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      next.delete("page");
      next.delete("event");
      router.replace(next.toString() ? `/audit?${next}` : "/audit");
    }, 250);
    return () => clearTimeout(t);
  }, [value, params, router]);

  return (
    <div className="flex w-[300px] items-center gap-2 rounded-[9px] border border-line bg-bg-2 px-3 py-2 focus-within:border-accent-line">
      <Search size={14} strokeWidth={1.9} className="shrink-0 text-ink-4" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Filter by actor, action or target…"
        aria-label="Filter audit events"
        className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-ink-4"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="shrink-0 text-ink-4 transition-colors duration-150 hover:text-ink"
        >
          <X size={13} strokeWidth={1.9} />
        </button>
      )}
    </div>
  );
}
