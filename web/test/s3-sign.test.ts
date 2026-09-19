import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amzDate,
  archiveKey,
  awsEncode,
  objectUrl,
  presignUrl,
  signRequest,
  type StorageTarget,
} from "../src/domain/storage/s3.ts";

/* Signature Version 4 against Amazon's own worked examples — the
   "examplebucket" ones from the S3 developer guide, with the documented
   example keys and the fixed moment 2013-05-24T00:00:00Z. A signer that
   reproduces those signatures byte for byte is one MinIO and S3 will
   both accept. */

const AWS: StorageTarget = {
  endpoint: "https://s3.amazonaws.com",
  region: "us-east-1",
  bucket: "examplebucket",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  pathStyle: false,
};
const AT = new Date("2013-05-24T00:00:00Z");

test("the presigned GET from the S3 guide comes out exactly", () => {
  const url = new URL(presignUrl(AWS, "GET", "test.txt", { expiresS: 86400, at: AT }));
  assert.equal(url.host, "examplebucket.s3.amazonaws.com");
  assert.equal(url.pathname, "/test.txt");
  assert.equal(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert.equal(url.searchParams.get("X-Amz-Credential"), "AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request");
  assert.equal(url.searchParams.get("X-Amz-Date"), "20130524T000000Z");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "86400");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.equal(
    url.searchParams.get("X-Amz-Signature"),
    "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
  );
});

test("the header-signed GET with a Range from the S3 guide comes out exactly", () => {
  const signed = signRequest(AWS, "GET", objectUrl(AWS, "test.txt"), {
    headers: { Range: "bytes=0-9" },
    at: AT,
  });
  assert.equal(
    signed.headers.authorization,
    "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
      "SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, " +
      "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
  );
  assert.equal(signed.headers["x-amz-content-sha256"], "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(signed.headers.host, undefined, "the host goes on the wire by itself");
});

test("path-style addressing puts the bucket in the path, for MinIO and friends", () => {
  const minio: StorageTarget = { ...AWS, endpoint: "http://localhost:9000", pathStyle: true };
  const url = objectUrl(minio, "backups/srv 1/manual-09-19.tar.gz");
  assert.equal(url.toString(), "http://localhost:9000/examplebucket/backups/srv%201/manual-09-19.tar.gz");
  const presigned = new URL(presignUrl(minio, "PUT", "a/b.tar.gz", { at: AT }));
  assert.equal(presigned.host, "localhost:9000");
  assert.equal(presigned.pathname, "/examplebucket/a/b.tar.gz");
  assert.equal(presigned.searchParams.get("X-Amz-Expires"), "900");
});

test("encoding is RFC 3986, not encodeURIComponent's looser cousin", () => {
  assert.equal(awsEncode("a b*(c)!'"), "a%20b%2A%28c%29%21%27");
  assert.equal(awsEncode("x/y z", true), "x/y%20z");
  assert.equal(amzDate(AT).stamp, "20130524T000000Z");
  assert.equal(amzDate(AT).day, "20130524");
});

test("an archive's key is prefix, server, artifact", () => {
  assert.equal(archiveKey("/geeboard/", "srv1", "manual.tar.gz"), "geeboard/srv1/manual.tar.gz");
  assert.equal(archiveKey("", "srv1", "manual.tar.gz"), "srv1/manual.tar.gz");
});
