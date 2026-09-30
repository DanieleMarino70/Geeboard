"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Settings2 } from "lucide-react";
import { updateNodeDetails } from "@/app/actions/nodes";
import { Dialog } from "@/components/dialog";
import { Field, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button } from "@/components/ui";
import { validateNodeDetails, type NodeDetailsErrors, type NodeDetailsInput } from "@/lib/node-rules";

/* Where a node is, and where players reach it: the parts of it a person
   describes rather than the agent measures. */
export function ConfigureNode({ name, initial, observed }: { name: string; initial: NodeDetailsInput; observed: string | null }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [serverErrors, setServerErrors] = useState<NodeDetailsErrors>({});
  const [saving, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();

  const local = validateNodeDetails(values);
  const errors = { ...local, ...serverErrors };
  const dirty =
    values.city.trim() !== initial.city ||
    values.region.trim() !== initial.region ||
    values.publicAddress.trim() !== initial.publicAddress;

  const set = (key: keyof NodeDetailsInput, value: string) => {
    setServerErrors({});
    setValues((v) => ({ ...v, [key]: value }));
  };

  const close = () => {
    setOpen(false);
    setValues(initial);
    setServerErrors({});
  };

  const save = () =>
    start(async () => {
      const result = await updateNodeDetails(name, values);
      if (!result.ok) {
        if ("errors" in result && result.errors) setServerErrors(result.errors);
        push({ tone: "danger", title: result.title, body: result.body });
        return;
      }
      push({ tone: result.tone, title: result.title, body: result.body });
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button intent="secondary" icon={Settings2} onClick={() => setOpen(true)}>
        Configure
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={`Configure ${name}`}
        description="Where this machine is, and where players reach it. Its size, platform and capabilities are reported by its agent and are not edited here."
        width={480}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && Object.keys(local).length === 0) save();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Location" htmlFor="node-city" error={errors.city} hint="Shown next to the node's name.">
            <input
              id="node-city"
              value={values.city}
              maxLength={40}
              onChange={(e) => set("city", e.target.value)}
              className={inputClass(Boolean(errors.city))}
            />
          </Field>
          <Field
            label="Region"
            htmlFor="node-region"
            error={errors.region}
            hint="Placement prefers nodes in the region a server asks for."
          >
            <input
              id="node-region"
              value={values.region}
              maxLength={32}
              spellCheck={false}
              onChange={(e) => set("region", e.target.value.toLowerCase())}
              className={inputClass(Boolean(errors.region), true)}
            />
          </Field>
          <Field
            label="Public address"
            htmlFor="node-address"
            optional
            error={errors.publicAddress}
            hint={
              observed
                ? `Where players reach this machine. Empty, the panel uses the address it sees the node from — ${observed} now.`
                : "Where players reach this machine, for DNS records. Empty, the panel uses the address it sees the node from, once it has seen one."
            }
          >
            <input
              id="node-address"
              value={values.publicAddress}
              maxLength={45}
              spellCheck={false}
              placeholder="203.0.113.9"
              onChange={(e) => set("publicAddress", e.target.value.trim())}
              className={inputClass(Boolean(errors.publicAddress), true)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button intent="ghost" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !dirty || Object.keys(local).length > 0}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
