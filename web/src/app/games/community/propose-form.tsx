"use client";

import { useRef, useState } from "react";
import { useAction } from "@/components/use-action";
import { useRouter } from "next/navigation";
import { FileUp, Send } from "lucide-react";
import { proposeManifest } from "@/app/actions/community";
import { Field, Notice, inputClass } from "@/components/form";
import { useToast } from "@/components/toast";
import { Button, Card } from "@/components/ui";
import type { ManifestProblem } from "@/domain/games/manifest";

/* Where a manifest is pasted, or read from a file. It is checked on the server and refused with the field
   that is wrong; nothing here decides anything, and a file is only text put in the box. */

const LIMIT = 64 * 1024;

export function ProposeForm() {
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<ManifestProblem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useAction();
  const file = useRef<HTMLInputElement>(null);
  const { push } = useToast();
  const router = useRouter();

  const load = async (picked: File | undefined) => {
    if (!picked) return;
    if (picked.size > LIMIT) {
      setMessage(`That file is ${Math.ceil(picked.size / 1024)} KB; a manifest is at most ${LIMIT / 1024} KB.`);
      return;
    }
    setText(await picked.text());
    setProblems([]);
    setMessage(null);
  };

  const submit = () =>
    start(async () => {
      const result = await proposeManifest(text);
      setProblems(result.problems ?? []);
      setMessage(result.ok ? null : result.body);
      push({ tone: result.ok ? result.tone : "danger", title: result.title, body: result.body });
      if (result.ok) {
        setText("");
        router.refresh();
        if (result.revisionId) router.push(`/games/community/${result.revisionId}`);
      }
    });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-[14px] font-semibold">Propose a game</h2>
        <p className="mt-[5px] max-w-[72ch] text-[12px] leading-relaxed text-ink-3">
          Paste a manifest, or choose a file. It is checked here against the rules below — an image named by its digest, from a
          registry on the list, and nothing the panel does not know — and kept as a revision to be read. Proposing runs nothing.
        </p>
      </div>
      <Field label="Manifest" htmlFor="manifest-text" hint={`JSON, at most ${LIMIT / 1024} KB. "manifest": 1 first.`} aside={`${text.length.toLocaleString("en-GB")} characters`}>
        <textarea
          id="manifest-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setProblems([]);
            setMessage(null);
          }}
          rows={14}
          spellCheck={false}
          placeholder={'{\n  "manifest": 1,\n  "id": "community-example",\n  …\n}'}
          className={`${inputClass(problems.length > 0, true)} resize-y leading-relaxed`}
        />
      </Field>

      {message && problems.length === 0 && <Notice tone="danger">{message}</Notice>}
      {problems.length > 0 && (
        <div className="rounded-[9px] border border-danger-line bg-danger-soft px-3 py-[10px] text-[11.5px] leading-relaxed text-danger-fg" role="alert">
          <div className="font-semibold">
            {problems.length} problem{problems.length === 1 ? "" : "s"}
          </div>
          <ul className="mt-[6px] flex flex-col gap-[5px]">
            {problems.slice(0, 30).map((p, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <code className="font-mono text-[11px]">{p.path || "manifest"}</code>
                <span>{p.message}</span>
              </li>
            ))}
          </ul>
          {problems.length > 30 && <div className="mt-[6px]">…and {problems.length - 30} more. Fix these first.</div>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button icon={Send} disabled={pending || text.trim().length === 0} onClick={submit}>
          {pending ? "Checking…" : "Check and propose"}
        </Button>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => void load(e.target.files?.[0]).then(() => (e.target.value = ""))} />
        <Button intent="secondary" icon={FileUp} disabled={pending} onClick={() => file.current?.click()}>
          Choose a file
        </Button>
      </div>
    </Card>
  );
}
