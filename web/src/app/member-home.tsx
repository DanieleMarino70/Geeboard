import Link from "next/link";
import { AppShell } from "@/components/shell";
import { ServerCardActions } from "@/components/server-actions";
import { Card, Cover, Pill } from "@/components/ui";
import { allowanceFor } from "@/domain/access/permissions";
import { isUp } from "@/domain/servers/state";
import { STATE_META, getServers } from "@/lib/queries";
import { shellUser } from "@/lib/ui-types";
import type { User } from "@prisma/client";

/* The dashboard of somebody who holds servers and nothing of the
   workspace: a member. The dashboard proper counts nodes, storage and
   the whole fleet's activity, none of which a member may read; this
   shows the servers that are theirs, with what they may do to each,
   and says so when there are none. */
export async function MemberHome({ viewer: user }: { viewer: User }) {
  const servers = await getServers(user);
  const hour = new Date().getHours();
  const partOfDay = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const up = servers.filter((s) => isUp(s.state)).length;

  return (
    <AppShell crumbs={["Dashboard"]} user={shellUser(user)}>
      <div className="flex flex-col gap-5 px-5 py-[26px] sm:px-8">
        <div className="min-w-0">
          <h1 className="text-[clamp(24px,3.4vw,30px)] leading-[1.1] font-semibold tracking-[-0.025em]">
            Good {partOfDay}, {user.name.split(" ")[0]}
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
            {servers.length === 0
              ? "No server is yours yet. An owner or an admin gives you one from its Settings page."
              : `${up} of your ${servers.length} server${servers.length === 1 ? " is" : "s are"} up.`}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {servers.map((s) => {
            const meta = STATE_META[s.state];
            return (
              <Card key={s.id} hover className="overflow-hidden">
                <div className="flex items-start gap-[13px] p-[18px]">
                  <Cover tag={s.art} game={s.gameId} />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/servers/${s.slug}`}
                      className="block truncate text-[14.5px] font-semibold tracking-[-0.015em] hover:text-accent"
                    >
                      {s.name}
                    </Link>
                    <div className="mt-1 font-mono text-[10px] text-ink-4">{s.version}</div>
                    <div className="mt-[9px] flex items-center gap-[7px]">
                      <Pill tone={meta.tone} pulse={meta.pulse}>
                        {meta.label}
                      </Pill>
                      <span className="font-mono text-[10.5px] text-ink-3 tnum">
                        {s.playersOn} / {s.playersMax}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 border-t border-line bg-bg-2 px-[18px] py-[10px]">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-4">
                    {s.host}:{s.port}
                  </span>
                  <ServerCardActions slug={s.slug} name={s.name} running={isUp(s.state)} allow={allowanceFor(user, s.ownerId)} />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
