import { encode } from "uqr";

/* A QR code, as rows of modules. The one place the encoder is imported.

   This is a dependency where the project would usually have written the
   thing itself — TOTP, the S3 signature and the tar writer are all by
   hand. Those had something to be checked against: RFC vectors, Amazon's
   published examples, another tar. A QR encoder is three hundred lines of
   Reed–Solomon, masking and per-version tables whose only test is whether
   a phone reads the result, and nothing here can hold a phone up to it.
   `uqr` has no dependencies of its own, is a port of Nayuki's reference
   encoder, and returns the modules rather than drawing anything — so the
   code is made on the server, from a secret that goes to no other
   service, and drawn by the page as plain rectangles.

   Rows of "1" and "0" rather than booleans: it crosses to the browser
   inside a server action's answer, and a string per row is a tenth the
   size. The quiet zone is included, because a code without one does not
   scan against a dark page. */
export function qrRows(text: string): string[] {
  const { data } = encode(text, { ecc: "M", border: 4 });
  return data.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""));
}
