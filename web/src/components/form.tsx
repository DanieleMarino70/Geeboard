import clsx from "clsx";
import { Children, cloneElement, Fragment, isValidElement, useId } from "react";
import { TriangleAlert } from "lucide-react";

/* Form pieces, shared so every form in the panel reads the same: a label
   that says whether the field is optional, a hint that becomes the error
   when there is one, and inputs styled one way. */

const CONTROLS = new Set(["input", "select", "textarea"]);

/* The first input, select or textarea among a field's children, given the id its label points at and the hint or error that
   describes it. Before this nothing pointed at the message: a screen reader that arrived on a field with an error heard its label and
   nothing else, and the one that was on it when the error appeared heard it only if it was the alert's turn. Only plain elements are
   walked; a component is left as it is, and a field whose control is inside one says so by giving it the id itself. */
function wire(
  node: React.ReactNode,
  found: { id?: string },
  fallbackId: string,
  describedBy: string | undefined,
  invalid: boolean,
): React.ReactNode {
  if (!isValidElement(node)) return node;
  const props = node.props as { id?: string; children?: React.ReactNode; "aria-describedby"?: string };
  if (typeof node.type === "string" && CONTROLS.has(node.type) && found.id === undefined) {
    found.id = props.id ?? fallbackId;
    return cloneElement(node as React.ReactElement<Record<string, unknown>>, {
      id: found.id,
      "aria-describedby": [props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
      "aria-invalid": invalid || undefined,
    });
  }
  if ((typeof node.type === "string" || node.type === Fragment) && props.children !== undefined) {
    return cloneElement(node as React.ReactElement<{ children?: React.ReactNode }>, {
      children: Children.map(props.children, (child) => wire(child, found, fallbackId, describedBy, invalid)),
    });
  }
  return node;
}

export function inputClass(invalid = false, mono = false) {
  return clsx(
    "w-full rounded-[9px] border bg-bg-2 px-3 py-[9px] text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-colors duration-150 placeholder:text-ink-4 disabled:opacity-50",
    mono && "font-mono text-[12.5px]",
    invalid ? "border-danger-line" : "border-line hover:border-line-2 focus:border-accent-line",
  );
}

export function Field({
  label,
  hint,
  error,
  optional = false,
  htmlFor,
  aside,
  quiet = false,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  optional?: boolean;
  htmlFor?: string;
  aside?: React.ReactNode;
  /** The error is tied to the field but not announced as it appears: for a form that checks as you type, where an alert for each
      keystroke is a screen reader reading the same sentence over and over. */
  quiet?: boolean;
  children: React.ReactNode;
}) {
  const generated = useId();
  const messageId = `${htmlFor ?? generated}-hint`;
  const has = Boolean(error || hint);
  const found: { id?: string } = {};
  const wired = wire(children, found, htmlFor ?? generated, has ? messageId : undefined, Boolean(error));
  // The message is named for the control that was found, which is the one with an id of its own, the label's, or the generated one.
  const controlId = found.id ?? htmlFor;
  return (
    <div className="flex flex-col gap-[6px]">
      <div className="flex items-baseline gap-2">
        <label htmlFor={controlId} className="text-[12px] font-medium text-ink-2">
          {label}
          {optional && <span className="ml-[6px] font-normal text-ink-4">optional</span>}
        </label>
        {aside && <span className="ml-auto font-mono text-[10px] text-ink-4">{aside}</span>}
      </div>
      {wired}
      {has && (
        <span
          id={messageId}
          role={error && !quiet ? "alert" : undefined}
          className={clsx("flex items-start gap-[5px] text-[11px] leading-snug", error ? "text-danger" : "text-ink-4")}
        >
          {/* An error is said by more than its colour. */}
          {error ? <TriangleAlert size={11} strokeWidth={2.2} aria-hidden className="mt-[2px] shrink-0" /> : null}
          <span className="min-w-0">{error ?? hint}</span>
        </span>
      )}
    </div>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "warning" | "danger" | "info";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={clsx(
        "flex gap-[9px] rounded-[9px] border px-3 py-[10px] text-[11.5px] leading-relaxed",
        tone === "warning" && "border-warning-line bg-warning-soft text-warning",
        tone === "danger" && "border-danger-line bg-danger-soft text-danger",
        tone === "info" && "border-info-line bg-info-soft text-info",
      )}
    >
      <TriangleAlert size={14} strokeWidth={1.9} className="mt-[2px] shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
