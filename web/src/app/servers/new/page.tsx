import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { nodeCapacities, workspaceDomain } from "@/lib/create-ops";
import { CreateWizard } from "./wizard";

export const dynamic = "force-dynamic";

/* The wizard is the one screen that does not wear the app shell: it is
   a task with a beginning and an end, and the sidebar would offer a way
   out of it on every row. The design says the same — a bare header with
   one way to cancel. */
export default async function NewServerPage() {
  const user = await requireUser();

  /* Placement commits a node's resources, so it sits with the roles
     that can drain a node. Saying so here beats letting someone fill in
     five steps and be refused at the end. */
  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-[420px] text-center">
          <span className="mx-auto mb-4 grid h-10 w-10 place-items-center rounded-[11px] bg-warning-soft text-warning">
            <ShieldAlert size={18} strokeWidth={1.8} />
          </span>
          <h1 className="text-[19px] font-semibold tracking-[-0.02em]">
            Creating servers needs admin
          </h1>
          <p className="mt-[10px] text-[13px] leading-relaxed text-ink-3">
            A new server commits a node&rsquo;s memory, CPU and a port for as long as it exists, so
            only owners and admins can place one. Ask one of them, and it will be yours to run.
          </p>
          <Link
            href="/servers"
            className="mt-5 inline-block text-[12.5px] text-accent hover:underline"
          >
            Back to servers
          </Link>
        </div>
      </div>
    );
  }

  const [nodes, domain] = await Promise.all([nodeCapacities(), workspaceDomain()]);

  return <CreateWizard nodes={nodes} domain={domain} />;
}
