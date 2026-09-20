/* What a look at a stored archive adds up to. Pure, so the arithmetic is
   tested without a node or a bucket.

   A backup is checked when it is written and again when it is restored.
   In between it sits on a disk for weeks, and the restore is the worst
   moment to learn that it did not sit there well. A scheduled VERIFY task
   reads the archives back where they lie, and this decides what each
   reading means.

   Three answers, and the third matters as much as the other two: an
   archive that could not be looked at — the node was down, the bucket is
   no longer configured — is not a damaged archive, and marking it as one
   would teach people to ignore the mark. */

export type ArchiveFinding =
  /** What the node read back from its own disk. */
  | { kind: "read"; checksum: string; sizeBytes: number }
  /** What the bucket says about the object, without fetching it. */
  | { kind: "listed"; sizeBytes: number }
  /** Nothing is there under that name. */
  | { kind: "missing"; where: "node" | "bucket" }
  /** The look itself failed; says nothing about the archive. */
  | { kind: "unreachable"; reason: string };

export type ArchiveVerdict =
  | { status: "intact"; note?: string }
  | { status: "damaged"; error: string }
  | { status: "unchecked"; reason: string };

export function judgeArchive(
  recorded: { checksum: string | null; sizeBytes: bigint | number },
  finding: ArchiveFinding,
): ArchiveVerdict {
  const size = Number(recorded.sizeBytes);

  switch (finding.kind) {
    case "unreachable":
      return { status: "unchecked", reason: finding.reason };

    case "missing":
      return {
        status: "damaged",
        error:
          finding.where === "node"
            ? "The archive is no longer on the node."
            : "The archive is no longer in the bucket.",
      };

    case "listed":
      /* A size is not a digest. It catches an upload that was cut short
         or an object somebody replaced, and it costs one small request
         rather than the whole archive over the wire; what it cannot see
         is said, so "intact" is not read as more than it is. */
      if (finding.sizeBytes !== size) {
        return { status: "damaged", error: `The bucket holds ${finding.sizeBytes} bytes; ${size} were uploaded.` };
      }
      return { status: "intact", note: "present in the bucket at the recorded size; not re-hashed" };

    case "read":
      if (finding.sizeBytes !== size) {
        return { status: "damaged", error: `The archive is ${finding.sizeBytes} bytes; ${size} were written.` };
      }
      // A row from before checksums were recorded has nothing to compare.
      if (!recorded.checksum) return { status: "unchecked", reason: "no checksum was recorded for it" };
      if (finding.checksum !== recorded.checksum) {
        return { status: "damaged", error: "The archive no longer matches the checksum taken when it was written." };
      }
      return { status: "intact" };
  }
}

/* Whether a VERIFY task pulls off-site archives down to re-hash them.

   Off by default, and a word in the payload turns it on. Reading a local
   archive costs disk time on a machine that is there anyway; reading one
   from a bucket costs its whole size in egress, every run, for every
   archive — a nightly habit nobody should acquire by accepting a
   default. */
export function verifyDownloads(payload: string | null | undefined): boolean {
  return /\bdownload\b/i.test(payload ?? "");
}

/** One line for the task's result and the activity log. */
export function summariseVerification(counts: { intact: number; damaged: number; unchecked: number }): string {
  const parts = [`${counts.intact} intact`];
  if (counts.damaged > 0) parts.push(`${counts.damaged} damaged`);
  if (counts.unchecked > 0) parts.push(`${counts.unchecked} could not be checked`);
  return parts.join(", ");
}
