import { ExternalLink, KeyRound } from "lucide-react";
import { AppShell } from "@/components/shell";
import { Avatar, Badge, Card, Label, Pill } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getApiKeys, relativeTime } from "@/lib/queries";
import { API_SCOPES } from "@/lib/server-ops";
import { CreateKey } from "./create-key";
import { KeyRowActions } from "./key-actions";

export const dynamic = "force-dynamic";

const COLS = "minmax(0,1fr) 176px 220px 116px 116px 34px";

export default async function ApiKeysPage() {
  const user = await requireUser();
  const keys = await getApiKeys(user);

  const privileged = user.role === "OWNER" || user.role === "ADMIN";
  const active = keys.filter((k) => !k.revokedAt).length;

  return (
    <AppShell crumbs={["Ashfold", "API keys"]} user={user}>
      <div className="flex flex-col gap-4 px-5 pt-[22px] pb-[26px] sm:px-8">
        <div className="flex flex-col items-start gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <h1 className="text-[24px] font-semibold tracking-[-0.025em]">API keys</h1>
            <p className="mt-[7px] max-w-[70ch] text-[12.5px] leading-snug text-ink-3">
              Scoped tokens for CI, bots and dashboards. Secrets are hashed on creation and shown
              once — the panel cannot recover one for you.
              {privileged ? " You can see every key in the workspace." : " You see your own keys."}
            </p>
          </div>
          <div className="flex shrink-0 gap-2 lg:ml-auto">
            <span
              title="Not wired up yet"
              className="inline-flex cursor-default items-center gap-[7px] rounded-[9px] border border-line bg-card px-4 py-[9px] text-[13px] font-medium text-ink-2 opacity-45"
            >
              <ExternalLink size={14} strokeWidth={1.9} />
              API docs
            </span>
          </div>
        </div>

        <CreateKey scopes={API_SCOPES} />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[18px] py-[13px]">
              <h2 className="text-[13.5px] font-semibold">Keys</h2>
              <span className="font-mono text-[10.5px] text-ink-4">
                {active} active · {keys.length - active} revoked
              </span>
            </div>

            {keys.length === 0 ? (
              <div className="px-6 py-[52px] text-center">
                <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-[13px] border border-dashed border-line-2 text-ink-4">
                  <KeyRound size={20} strokeWidth={1.6} />
                </div>
                <div className="text-[13.5px] font-semibold">No keys yet</div>
                <p className="mx-auto mt-2 max-w-[36ch] text-xs leading-relaxed text-ink-4">
                  Create one when something outside the panel needs to reach it.
                </p>
              </div>
            ) : (
              <>
                <div
                  className="hidden gap-[14px] border-b border-line bg-bg-2 px-[18px] py-[10px] lg:grid"
                  style={{ gridTemplateColumns: COLS }}
                >
                  {["Name", "Key ID", "Scopes", "Last used", "State", ""].map((h, i) => (
                    <Label key={h || i}>{h}</Label>
                  ))}
                </div>

                {keys.map((k, i) => {
                  const revoked = k.revokedAt !== null;
                  return (
                    <div
                      key={k.id}
                      className={`px-[18px] py-[14px] transition-colors duration-150 hover:bg-card-2 lg:py-[12px] ${
                        i < keys.length - 1 ? "border-b border-line" : ""
                      } ${revoked ? "opacity-60" : ""}`}
                    >
                      <div
                        className="grid items-center gap-x-[14px] gap-y-2"
                        style={{ gridTemplateColumns: COLS }}
                      >
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <span
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${
                              revoked ? "bg-card-2 text-ink-4" : "bg-accent-soft text-accent"
                            }`}
                          >
                            <KeyRound size={14} strokeWidth={1.7} />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate text-[12.5px] font-medium">{k.name}</div>
                            <div className="mt-[2px] flex items-center gap-[6px]">
                              <Avatar initials={k.user.initials} size={14} />
                              <span className="truncate font-mono text-[9.5px] text-ink-4">
                                {k.user.name}
                              </span>
                            </div>
                          </div>
                        </div>

                        <span className="truncate font-mono text-[10.5px] text-ink-3">
                          {k.prefix}
                        </span>

                        <span className="flex flex-wrap gap-1">
                          {k.scopes.slice(0, 2).map((s) => (
                            <Badge key={s} tone="muted">
                              {s}
                            </Badge>
                          ))}
                          {k.scopes.length > 2 && (
                            <span className="font-mono text-[10px] text-ink-4">
                              +{k.scopes.length - 2}
                            </span>
                          )}
                        </span>

                        <span className="text-[11.5px] text-ink-4">
                          {k.lastUsedAt ? relativeTime(k.lastUsedAt) : "never"}
                        </span>

                        <div>
                          {revoked ? (
                            <Pill tone="danger">Revoked</Pill>
                          ) : k.lastUsedAt ? (
                            <Pill tone="success">Active</Pill>
                          ) : (
                            <Pill tone="muted">Unused</Pill>
                          )}
                        </div>

                        <KeyRowActions id={k.id} name={k.name} revoked={revoked} />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </Card>

          <Card className="px-5 py-[18px]">
            <h2 className="mb-1 text-[13px] font-semibold">Scopes</h2>
            <p className="mb-3 text-[11px] leading-snug text-ink-4">
              A key can only do what its scopes allow. Widening one means issuing a new key.
            </p>
            {API_SCOPES.map((s) => (
              <div key={s.id} className="border-b border-line py-[9px] last:border-b-0">
                <div className="font-mono text-[11.5px] text-ink-2">{s.id}</div>
                <div className="mt-[2px] text-[11px] leading-snug text-ink-4">{s.label}</div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
