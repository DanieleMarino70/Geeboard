import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { SCOPE_PERMISSIONS } from "../src/domain/access/permissions.ts";
import { DNS_KINDS } from "../src/domain/dns/rules.ts";
import { PARKED, allGames } from "../src/domain/games/registry.ts";
import { CAPABILITIES } from "../src/domain/games/types.ts";
import { STORAGE_PRESETS } from "../src/domain/storage/presets.ts";

/* docs/extending.md says where a thing is added and what stops you if you forget. A page like that is wrong the day a file moves, a name is
   changed or a game is added, and nobody reads it again until a contributor follows it. So it is held to the code from two sides:
   every path and every `path#Name` it writes exists, and every list it prints is the list in the code. */

const REPO = path.join(import.meta.dirname, "..", "..");
const PAGE = readFileSync(path.join(REPO, "docs", "extending.md"), "utf8").split("\r\n").join("\n");

/* The code a reference points at: the file or directory, and where there is a name the file has to mention it as a word. A name that
   is only a substring of another (`PITCH` in `PITCHER`) is not a mention. */
function badReferences(text: string): string[] {
  const bad: string[] = [];
  for (const [, file, name] of text.matchAll(/`((?:web|daemon|deploy|docs|examples)\/[A-Za-z0-9_.\/\[\]-]+)(?:#([A-Za-z_$][\w$]*))?`/g)) {
    const full = path.join(REPO, file!);
    if (!existsSync(full)) {
      bad.push(`${file} does not exist`);
      continue;
    }
    if (name && !statSync(full).isDirectory() && !new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`).test(readFileSync(full, "utf8"))) bad.push(`${file} has no ${name}`);
  }
  return bad;
}

test("every path and every name that docs/extending.md writes is in the code", () => {
  assert.deepEqual(badReferences(PAGE), [], "the page names something that is not there: fix the page, or the thing it moved to");
  assert.ok([...PAGE.matchAll(/`web\//g)].length > 60, "the page names few enough files that the check is not looking at it");
});

test("the check for a reference can fail", () => {
  assert.deepEqual(badReferences("`web/src/domain/dns/rules.ts#DNS_PROVIDERS` and `docs/api.md`"), []);
  assert.deepEqual(badReferences("`web/src/domain/dns/gone.ts`"), ["web/src/domain/dns/gone.ts does not exist"]);
  assert.deepEqual(badReferences("`web/src/domain/dns/rules.ts#NoSuchName`"), ["web/src/domain/dns/rules.ts has no NoSuchName"]);
  assert.deepEqual(badReferences("`web/src/domain/dns/rules.ts#DNS_PROV`"), ["web/src/domain/dns/rules.ts has no DNS_PROV"]);
});

/* The literals of a type written in a source file: the type's own text, with its comments taken out, up to the semicolon that ends it. */
function literalsOf(file: string, type: string, key?: string): string[] {
  const source = readFileSync(path.join(REPO, "web", "src", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const start = source.search(new RegExp(`\\b(?:type|interface) ${type}\\b`));
  assert.ok(start >= 0, `${file} has no type or interface ${type}`);
  let depth = 0;
  // A type ends at the semicolon after its `=`; an interface at the brace that closes the one it opens.
  const isInterface = /^interface/.test(source.slice(start));
  let end = isInterface ? source.indexOf("{", start) : source.indexOf("=", start);
  for (let i = end; i < source.length; i++) {
    const ch = source[i]!;
    if ("{[(<".includes(ch)) depth++;
    else if ("}])>".includes(ch) && !(ch === ">" && source[i - 1] === "=")) {
      depth--;
      if (isInterface && depth === 0) {
        end = i;
        break;
      }
    } else if (!isInterface && ch === ";" && depth === 0) {
      end = i;
      break;
    }
  }
  const block = source.slice(start, end);
  if (!key) return [...new Set([...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!))];
  // A field of a variant: `kind: "port"`, or a union of literals as in `type: "string" | "text"`.
  const found = new Set<string>();
  for (const field of block.matchAll(new RegExp(`\\b${key}:\\s*((?:"[^"]+"\\s*\\|?\\s*)+)`, "g"))) {
    for (const literal of field[1]!.matchAll(/"([^"]+)"/g)) found.add(literal[1]!);
  }
  return [...found];
}

/** What the page prints for a label, as `- **Label:** \`a\`, \`b\``. */
function printed(label: string): string[] {
  const line = PAGE.split("\n").find((l) => l.startsWith(`- **${label}`));
  assert.ok(line, `docs/extending.md has no line for ${label}`);
  return [...line!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

const LISTS: Array<[label: string, code: () => string[]]> = [
  ["Built-in games", () => allGames().map((g) => g.id)],
  ["Parked games", () => [...PARKED]],
  ["DNS providers", () => DNS_KINDS.map((k) => k.id)],
  ["Notification destinations", () => literalsOf("domain/notify/destination.ts", "DestinationKind")],
  ["Off-site storage presets", () => STORAGE_PRESETS.map((p) => p.id)],
  ["Capabilities", () => [...CAPABILITIES]],
  ["Config targets", () => literalsOf("domain/games/types.ts", "ConfigTarget", "kind")],
  ["Field types", () => literalsOf("domain/games/types.ts", "ConfigField", "type")],
  ["Health probes", () => literalsOf("domain/games/types.ts", "HealthProbe", "kind")],
  ["Query protocols", () => literalsOf("domain/games/types.ts", "QueryProtocol")],
  ["Version sources", () => literalsOf("domain/games/types.ts", "VersionSourceRef", "provider")],
  ["API scopes", () => Object.keys(SCOPE_PERMISSIONS)],
];

for (const [label, code] of LISTS) {
  test(`the list of ${label.toLowerCase()} on docs/extending.md is the one in the code`, () => {
    const inCode = code().sort();
    assert.ok(inCode.length > 0, `found nothing in the code for ${label}`);
    assert.deepEqual(printed(label).sort(), inCode, `${label}: the page and the code disagree — update the line in docs/extending.md`);
  });
}

test("the 1.0 sentence is the same, word for word, on docs/extending.md and in the roadmap", () => {
  const sentenceIn = (file: string) => {
    const text = readFileSync(path.join(REPO, "docs", file), "utf8").split("\r\n").join("\n").replace(/^>\s?/gm, "");
    const from = text.indexOf("**Adding a game that runs from an image");
    const to = text.indexOf("None of them changes the architecture.**");
    assert.ok(from >= 0 && to > from, `docs/${file} does not have the sentence`);
    return text.slice(from, to + "None of them changes the architecture.**".length).replace(/\s+/g, " ");
  };
  assert.equal(sentenceIn("roadmap.md"), sentenceIn("extending.md"));
});
