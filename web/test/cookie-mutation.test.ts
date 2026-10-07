import assert from "node:assert/strict";
import { test } from "node:test";
import { cookieMutationProblem } from "../src/domain/access/origin.ts";

/* A request with only a cookie is the one a hostile page can cause. To change anything it has to come from the panel's own
   origin and, with a body, say it is JSON. */

const request = (method: string, headers: Record<string, string>) => new Request("https://panel.example.com/api/v1/servers/aurora/start", { method, headers });

test("a cross-origin form post, which is a text/plain body from another site, is refused", () => {
  const problem = cookieMutationProblem(
    request("POST", { origin: "https://evil.example", host: "panel.example.com", "content-type": "text/plain", "content-length": "9" }),
  );
  assert.equal(problem?.code, "FORBIDDEN");
});

test("a post with no origin at all is refused: a browser sends one, and what does not is not one of ours", () => {
  assert.equal(cookieMutationProblem(request("POST", { host: "panel.example.com", "content-type": "application/json", "content-length": "2" }))?.code, "FORBIDDEN");
  assert.equal(cookieMutationProblem(request("DELETE", { host: "panel.example.com" }))?.code, "FORBIDDEN");
  assert.equal(cookieMutationProblem(request("POST", { origin: "null", host: "panel.example.com" }))?.code, "FORBIDDEN");
});

test("the panel's own origin with a JSON body is fine, whatever the casing and the charset", () => {
  const own = { origin: "https://panel.example.com", host: "panel.example.com" };
  assert.equal(cookieMutationProblem(request("POST", { ...own, "content-type": "application/json", "content-length": "2" })), null);
  assert.equal(cookieMutationProblem(request("PATCH", { ...own, "content-type": "Application/JSON; charset=utf-8", "content-length": "20" })), null);
  assert.equal(cookieMutationProblem(request("POST", { ...own })), null, "no body, so nothing to say what it is");
});

test("the panel's own origin with a body that is not JSON is refused, and a file's route may take one", () => {
  const own = { origin: "https://panel.example.com", host: "panel.example.com" };
  assert.equal(cookieMutationProblem(request("POST", { ...own, "content-type": "text/plain", "content-length": "5" }))?.code, "VALIDATION_FAILED");
  assert.equal(cookieMutationProblem(request("POST", { ...own, "content-length": "5" }))?.code, "VALIDATION_FAILED");
  assert.equal(cookieMutationProblem(request("PUT", { ...own, "content-type": "application/octet-stream", "content-length": "5" }), { rawBody: true }), null);
  assert.equal(cookieMutationProblem(request("PUT", { origin: "https://evil.example", host: "panel.example.com", "content-length": "5" }), { rawBody: true })?.code, "FORBIDDEN", "a file's route still checks where it came from");
});

test("a read is never asked: nothing changes", () => {
  assert.equal(cookieMutationProblem(request("GET", { origin: "https://evil.example", host: "panel.example.com" })), null);
  assert.equal(cookieMutationProblem(request("HEAD", {})), null);
});

test("behind a proxy the host the browser asked for is the forwarded one", () => {
  const forwarded = { origin: "https://panel.example.com", host: "127.0.0.1:3000", "x-forwarded-host": "panel.example.com", "content-type": "application/json", "content-length": "2" };
  assert.equal(cookieMutationProblem(request("POST", forwarded)), null);
});
