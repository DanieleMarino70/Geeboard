import Link from "next/link";
import { Check } from "lucide-react";
import clsx from "clsx";
import { firstSteps, type FirstSteps } from "@/domain/onboarding";
import { Card, Label, LinkButton } from "./ui";

/* The four steps of the first hour, on the Dashboard, until they are done. Nothing at all after: a panel that has a server running is not
   being introduced to itself. What it says is derived from the counts the Dashboard already has (domain/onboarding.ts). */
export function FirstStepsCard({ facts }: { facts: FirstSteps }) {
  const { steps, current } = firstSteps(facts);
  if (!current) return null;

  return (
    <section aria-labelledby="first-steps-title" className="relative">
      <Card className="p-5">
        <div className="mb-[14px] flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Label>
            <span id="first-steps-title">First steps</span>
          </Label>
          <span className="text-[12px] text-ink-3">
            {steps.filter((s) => s.done).length} of {steps.length} done. Each opens the page that does it.
          </span>
        </div>
        <ol className="grid gap-3 md:grid-cols-4">
          {steps.map((step, i) => {
            const isCurrent = step.id === current.id;
            return (
              <li
                key={step.id}
                aria-current={isCurrent ? "step" : undefined}
                className={clsx(
                  "flex flex-col gap-2 rounded-[11px] border px-3 py-3",
                  isCurrent ? "border-accent-line bg-accent-soft" : "border-line bg-card-2",
                  step.done && "opacity-75",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full border font-mono text-[11px]",
                      step.done ? "border-success-line bg-success-soft text-success-fg" : isCurrent ? "border-accent-line text-accent-fg" : "border-line text-ink-4",
                    )}
                  >
                    {step.done ? <Check size={12} strokeWidth={2.4} aria-hidden /> : i + 1}
                  </span>
                  <span className="text-[13px] font-semibold">
                    {step.title}
                    {step.done ? <span className="sr-only"> — done</span> : null}
                  </span>
                </div>
                <p className="text-[12px] leading-snug text-ink-3">{step.hint}</p>
                {isCurrent ? (
                  <div className="mt-auto pt-1">
                    <LinkButton href={step.href} size="sm">
                      {step.cta}
                    </LinkButton>
                  </div>
                ) : step.done ? null : (
                  <Link href={step.href} className="mt-auto pt-1 text-[11.5px] text-ink-3 hover:text-accent-fg">
                    {step.cta}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
