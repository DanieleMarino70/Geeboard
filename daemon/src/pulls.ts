/* Pulling an image, as something the panel can watch.

   A pull used to happen inside a create, bounded at two minutes, while
   the panel waited three for the create to answer. Project Zomboid's
   Build 42 image is 10.4 GB: on a node that had not pulled it before, a
   first create failed by construction, Docker went on downloading behind
   the failure, and a second attempt found the image and worked. So the
   pull is its own job now, started by the panel and watched by it, and
   the create that follows finds the image already there.

   What a pull reports is only what Docker's stream says, and what that
   says was measured on this project's Docker Desktop (28.5.1, containerd
   image store) rather than taken from its documentation:

     - every layer is announced at the start, "Pulling fs layer", so how
       many layers there are is known at once;
     - "Downloading" carries { current, total } in bytes for one layer, and
       a layer's size is known only once its download begins — up to six
       downloaded at a time — so the total of the whole image becomes known
       part way through, and is said to be known only then;
     - a small or already-present layer can go straight from "Pulling fs
       layer" to "Download complete" with no bytes reported at all;
     - "Extracting" counts seconds, { current, units: "s" }, not bytes, and
       repeats every tenth of a second whether or not the count moved;
     - "Pull complete" ends a layer; "Already exists" is the older image
       store's way of saying the same about one it had.

   So a pull has advanced when its bytes grew, a layer changed state or an
   extraction's count went up — never merely because Docker said
   something. And it fails when it has not advanced for a while, not when
   it has taken long: a slow line is not a broken one. */

export type LayerState = "waiting" | "downloading" | "downloaded" | "extracting" | "done";

interface Layer {
  state: LayerState;
  /** Bytes, as the last "Downloading" said. */
  current: number;
  /** Bytes, once its download has begun; 0 until then. */
  total: number;
  /** What the last "Extracting" counted — seconds, or bytes on the older image store. */
  extracted: number;
}

export interface PullProgress {
  layers: Map<string, Layer>;
  /** Docker's own error, when the stream carried one. */
  error: string | null;
}

export function emptyProgress(): PullProgress {
  return { layers: new Map(), error: null };
}

/** One line of the stream, as Docker writes it. */
export interface PullEvent {
  status?: string;
  id?: string;
  progressDetail?: { current?: number; total?: number; units?: string };
  error?: string;
  errorDetail?: { message?: string };
}

function bytesOf(progress: PullProgress): number {
  let sum = 0;
  for (const layer of progress.layers.values()) {
    sum += layer.state === "waiting" || layer.state === "downloading" ? layer.current : Math.max(layer.current, layer.total);
  }
  return sum;
}

/* Folds one event into the progress, and says whether the pull moved.

   Kept apart from any stream or timer so that what counts as moving can
   be tested with the events this engine was seen to send. */
export function applyEvent(progress: PullProgress, event: PullEvent): boolean {
  if (event.error || event.errorDetail?.message) {
    progress.error = event.errorDetail?.message ?? event.error ?? "Docker reported an error";
    return true;
  }

  const status = event.status ?? "";
  const id = event.id;
  // "Pulling from <repository>" carries the tag as its id, and is not a layer.
  if (!id || status.startsWith("Pulling from")) return false;

  const before = bytesOf(progress);
  let layer = progress.layers.get(id);
  const fresh = !layer;
  if (!layer) {
    layer = { state: "waiting", current: 0, total: 0, extracted: 0 };
    progress.layers.set(id, layer);
  }
  const was = layer.state;
  const detail = event.progressDetail ?? {};

  switch (status) {
    case "Pulling fs layer":
    case "Waiting":
      break;
    case "Downloading":
    case "Verifying Checksum":
      layer.state = "downloading";
      if (typeof detail.total === "number" && detail.total > 0) layer.total = detail.total;
      if (typeof detail.current === "number") layer.current = Math.max(layer.current, detail.current);
      break;
    case "Download complete":
      layer.state = "downloaded";
      if (layer.total > 0) layer.current = layer.total;
      break;
    case "Extracting": {
      layer.state = "extracting";
      const counted = typeof detail.current === "number" ? detail.current : 0;
      if (counted > layer.extracted) {
        layer.extracted = counted;
        return true;
      }
      break;
    }
    case "Pull complete":
    case "Already exists":
      layer.state = "done";
      if (layer.total > 0) layer.current = layer.total;
      break;
    default:
      // A status this engine was not seen to send moves nothing.
      return fresh;
  }

  return fresh || layer.state !== was || bytesOf(progress) > before;
}

export type PullState = "pulling" | "done" | "failed";

export interface PullSummary {
  image: string;
  state: PullState;
  /** starting: no layer announced yet; downloading; unpacking: every layer is in, some still being unpacked. */
  phase: "starting" | "downloading" | "unpacking" | "done";
  layers: { total: number; downloaded: number; done: number };
  /* Bytes downloaded, and the sum of the sizes known so far. The sum is
     the image's size only once every layer has either said its size or
     finished without one — `totalKnown` — which on a big image is a while
     after the pull starts. */
  bytes: { current: number; total: number; totalKnown: boolean };
  startedAt: string;
  /** When it last moved — what a stall is measured from. */
  advancedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export function summarise(
  image: string,
  progress: PullProgress,
  state: PullState,
  times: { startedAt: number; advancedAt: number; finishedAt: number | null },
  error: string | null,
): PullSummary {
  const layers = [...progress.layers.values()];
  const downloaded = layers.filter((l) => l.state === "downloaded" || l.state === "extracting" || l.state === "done").length;
  const done = layers.filter((l) => l.state === "done").length;
  const total = layers.reduce((sum, l) => sum + l.total, 0);
  const totalKnown =
    layers.length > 0 && layers.every((l) => l.total > 0 || l.state === "downloaded" || l.state === "extracting" || l.state === "done");

  let phase: PullSummary["phase"] = "starting";
  if (state === "done") phase = "done";
  else if (layers.length > 0) phase = downloaded < layers.length ? "downloading" : "unpacking";

  return {
    image,
    state,
    phase,
    layers: { total: layers.length, downloaded, done },
    bytes: { current: bytesOf(progress), total, totalKnown },
    startedAt: new Date(times.startedAt).toISOString(),
    advancedAt: new Date(times.advancedAt).toISOString(),
    finishedAt: times.finishedAt === null ? null : new Date(times.finishedAt).toISOString(),
    error,
  };
}

/* ── The jobs ─────────────────────────────────────────────────────── */

export interface PullSource {
  /** Starts Docker's pull and hands back its stream of JSON lines. */
  open(image: string): Promise<NodeJS.ReadableStream>;
  /** Whether the image is on this node now. */
  present(image: string): Promise<boolean>;
}

interface Job {
  image: string;
  progress: PullProgress;
  state: PullState;
  startedAt: number;
  advancedAt: number;
  finishedAt: number | null;
  error: string | null;
  stream: NodeJS.ReadableStream | null;
}

/** How long a finished pull's answer is kept for whoever asks after it. */
const KEEP_FINISHED_MS = 30 * 60_000;

function megabytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export class Pulls {
  private jobs = new Map<string, Job>();
  private now: () => number;

  constructor(
    private source: PullSource,
    /** No movement for this long is a stalled pull. */
    private stallMs: number,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /* Starts a pull, or joins the one already running for this image.

     An image already on the node is answered as done without asking
     Docker anything. A pull that failed is started again: whatever
     stopped it may not stop the next one, and Docker keeps the layers
     it had, so a retry resumes rather than restarts. */
  async start(image: string): Promise<PullSummary> {
    const running = this.jobs.get(image);
    if (running?.state === "pulling") return this.summary(running);

    const job: Job = {
      image,
      progress: emptyProgress(),
      state: "pulling",
      startedAt: this.now(),
      advancedAt: this.now(),
      finishedAt: null,
      error: null,
      stream: null,
    };
    // Kept before anything is awaited, so a second request in the meantime joins this one.
    this.keep(job);

    const present = await this.source.present(image).catch(() => false);
    if (present) {
      this.finish(job, "done", null);
      return this.summary(job);
    }

    void this.run(job);
    return this.summary(job);
  }

  /** The pull for this image, if this agent has one running or recently finished. */
  get(image: string): PullSummary | null {
    const job = this.jobs.get(image);
    return job ? this.summary(job) : null;
  }

  /* Fails every pull that has stopped moving. Called on a timer by the
     agent, and directly by tests with a clock of their own. */
  checkStalls(): void {
    for (const job of this.jobs.values()) {
      if (job.state !== "pulling") continue;
      if (this.now() - job.advancedAt <= this.stallMs) continue;
      const summary = this.summary(job);
      const minutes = Math.round(this.stallMs / 60_000);
      const stream = job.stream as (NodeJS.ReadableStream & { destroy?: () => void }) | null;
      this.finish(
        job,
        "failed",
        `The download stopped moving: nothing new from Docker for ${minutes >= 1 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.round(this.stallMs / 1000)} seconds`}, at ${megabytes(summary.bytes.current)} and ${summary.layers.done} of ${summary.layers.total} layers. Docker keeps what it has; asking again resumes from there.`,
      );
      // Docker stops the pull when the stream it is writing to goes away.
      stream?.destroy?.();
    }
  }

  private summary(job: Job): PullSummary {
    return summarise(job.image, job.progress, job.state, job, job.error);
  }

  private keep(job: Job) {
    this.jobs.set(job.image, job);
  }

  private finish(job: Job, state: PullState, error: string | null) {
    if (job.state !== "pulling") return;
    job.state = state;
    job.error = error;
    job.finishedAt = this.now();
    job.stream = null;
    const timer = setTimeout(() => {
      if (this.jobs.get(job.image) === job) this.jobs.delete(job.image);
    }, KEEP_FINISHED_MS);
    timer.unref?.();
  }

  private async run(job: Job): Promise<void> {
    let stream: NodeJS.ReadableStream;
    try {
      stream = await this.source.open(job.image);
    } catch (error) {
      // A name Docker cannot resolve, a registry that refuses: said at once.
      this.finish(job, "failed", (error as Error).message);
      return;
    }
    job.stream = stream;

    let pending = "";
    const line = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      let event: PullEvent;
      try {
        event = JSON.parse(trimmed) as PullEvent;
      } catch {
        return;
      }
      if (applyEvent(job.progress, event)) job.advancedAt = this.now();
    };

    await new Promise<void>((resolve) => {
      stream.on("data", (chunk: Buffer | string) => {
        pending += chunk.toString();
        let at: number;
        while ((at = pending.indexOf("\n")) >= 0) {
          line(pending.slice(0, at));
          pending = pending.slice(at + 1);
        }
      });
      stream.on("end", () => {
        line(pending);
        resolve();
      });
      stream.on("close", () => resolve());
      stream.on("error", (error: Error) => {
        if (job.state === "pulling") this.finish(job, "failed", error.message);
        resolve();
      });
    });

    if (job.state !== "pulling") return;
    if (job.progress.error) {
      this.finish(job, "failed", job.progress.error);
      return;
    }
    /* The stream ending is not the image arriving: a registry that hung
       up part way ends the stream too. The engine is asked. */
    const there = await this.source.present(job.image).catch(() => false);
    this.finish(job, there ? "done" : "failed", there ? null : "Docker finished the pull without the image. Asking again resumes it.");
  }
}
