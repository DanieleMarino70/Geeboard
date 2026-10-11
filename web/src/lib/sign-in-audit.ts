import "server-only";
import {
  SIGN_IN_ACTOR,
  SIGN_IN_REFUSALS,
  SIGN_IN_REFUSED,
  createRefusalLedger,
  triedAddress,
  type SignInRefusal,
} from "@/domain/access/sign-in-refusals";
import { db } from "./db";
import { logger } from "./log";

/* Writes a refused sign-in to the audit log, within the ceiling domain/access/sign-in-refusals.ts describes. A refusal is answered whatever
   happens here: a line that could not be written is a line in the server's log instead, never an error on the form. */

const ledger = createRefusalLedger();

export async function recordSignInRefusal(input: {
  email: string;
  reason: SignInRefusal;
  /** The client as the proxy in front of the panel saw it (domain/access/source.ts). */
  ip?: string;
  /** Written once a window under this key: see createRefusalLedger. */
  once?: string;
}): Promise<void> {
  const decision = ledger.decide(input.once);
  if (decision === "skip") return;
  const stopped = decision === "stopped";
  const reason: SignInRefusal = stopped ? "too-many-refusals" : input.reason;
  try {
    await db.activityEvent.create({
      data: {
        actor: SIGN_IN_ACTOR,
        action: SIGN_IN_REFUSED,
        target: stopped ? `none recorded until ${ledger.resumesAt().toISOString()}` : triedAddress(input.email),
        tone: "WARNING",
        ip: stopped ? null : (input.ip ?? null),
        changes: { Reason: { from: "—", to: SIGN_IN_REFUSALS[reason] } },
      },
    });
    if (stopped) logger.warn("refused sign-ins are past their ceiling, and are not recorded until the window ends", { until: ledger.resumesAt().toISOString() });
  } catch (error) {
    logger.warn("a refused sign-in was not recorded", { reason, detail: error instanceof Error ? error.message : String(error) });
  }
}
