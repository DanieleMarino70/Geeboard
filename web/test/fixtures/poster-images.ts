import { crc32, deflateSync } from "node:zlib";

/* Images made here, byte by byte, for the tests of the posters (test/game-posters.test.ts, scripts/verify-covers.mts): nothing of a
   publisher's is in the repository. The PNG is a real one a browser draws; the JPEG and WebP are their headers and enough after them for
   the panel to read a type and a size, which is all it reads. */

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** A PNG of one colour, `width` × `height`, that any browser draws. `seed` changes the colour, and so the bytes and the hash. */
export function png(width: number, height: number, seed = 0): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per sample
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = (40 + seed * 53) & 0xff;
    row[2 + x * 3] = (90 + seed * 29) & 0xff;
    row[3 + x * 3] = (160 + seed * 17) & 0xff;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* A JPEG's start: the image marker, a JFIF segment, an Exif one and a Huffman table (whose marker, C4, sits among the frame markers and is
   not one), then the frame header with the size, then `padding` bytes. */
export function jpeg(width: number, height: number, padding = 64): Buffer {
  const segment = (marker: number, body: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(body.length + 2, 2);
    return Buffer.concat([head, body]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    segment(0xe1, Buffer.from("Exif\0\0padding-of-an-exif-block", "latin1")),
    segment(0xc4, Buffer.alloc(20, 1)),
    segment(0xc0, sof),
    Buffer.alloc(padding, 0x55),
    Buffer.from([0xff, 0xd9]),
  ]);
}

function riff(fourcc: string, payload: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(payload.length);
  const body = Buffer.concat([Buffer.from("WEBP", "ascii"), Buffer.from(fourcc, "ascii"), size, payload]);
  const total = Buffer.alloc(4);
  total.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "ascii"), total, body]);
}

/** A lossy WebP's header: a key frame's tag, its start code, then the size. */
export function webpLossy(width: number, height: number): Buffer {
  const frame = Buffer.alloc(20);
  frame.set([0x9d, 0x01, 0x2a], 3);
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  return riff("VP8 ", frame);
}

/** A lossless WebP's header: the signature byte, then 14 bits each of width and height less one. */
export function webpLossless(width: number, height: number): Buffer {
  const body = Buffer.alloc(10);
  body[0] = 0x2f;
  body.writeUInt32LE(((width - 1) | ((height - 1) << 14)) >>> 0, 1);
  return riff("VP8L", body);
}

/** An extended WebP's header, animated or not. */
export function webpExtended(width: number, height: number, animated = false): Buffer {
  const body = Buffer.alloc(10);
  body[0] = animated ? 0x02 : 0;
  body.writeUIntLE(width - 1, 4, 3);
  body.writeUIntLE(height - 1, 7, 3);
  return riff("VP8X", body);
}

export const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><script>alert(1)</script></svg>`);
export const GIF = Buffer.from("GIF89a\x58\x02\x84\x03\0\0\0;", "latin1");
export const HTML = Buffer.from("<!doctype html><title>Not found</title><p>The page moved.</p>");
