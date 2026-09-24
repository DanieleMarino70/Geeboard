import type { RuntimeDownload } from "./types";

/* A download, said to a person watching it.

   Only what the node counted. The layers are known from the start, and
   the size of the whole only once every layer has begun downloading — so
   until then the sentence says how much has come so far, not "of" what,
   and the bar follows the bytes only when the total is the total. While
   the layers are being unpacked, the node counts layers, not bytes, and
   so does this. */

export function size(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function downloadSentence(download: RuntimeDownload): string {
  const { layers, bytes } = download;
  switch (download.phase) {
    case "starting":
      return "Asking for the download";
    case "downloading": {
      const amount = bytes.totalKnown ? `${size(bytes.current)} of ${size(bytes.total)}` : `${size(bytes.current)} so far`;
      return `Downloading: ${amount}, ${layers.downloaded} of ${layers.total} layers`;
    }
    case "unpacking":
      return `Unpacking: ${layers.done} of ${layers.total} layers`;
    case "done":
      return "Downloaded";
  }
}

/** 0–100 when the node's numbers support one, null when any bar would be a guess. */
export function downloadPercent(download: RuntimeDownload): number | null {
  const { layers, bytes } = download;
  if (download.phase === "done") return 100;
  if (download.phase === "downloading" && bytes.totalKnown && bytes.total > 0) {
    return Math.min(100, Math.floor((bytes.current / bytes.total) * 100));
  }
  if (download.phase === "unpacking" && layers.total > 0) {
    return Math.min(100, Math.floor((layers.done / layers.total) * 100));
  }
  return null;
}
