import test from "node:test";
import assert from "node:assert/strict";
import { cacheControlForStaticPath, parseByteRange } from "../src/static-media.mjs";

test("parses closed, open and suffix byte ranges", () => {
  assert.deepEqual(parseByteRange("bytes=10-19", 100), { start:10, end:19, length:10 });
  assert.deepEqual(parseByteRange("bytes=90-", 100), { start:90, end:99, length:10 });
  assert.deepEqual(parseByteRange("bytes=-12", 100), { start:88, end:99, length:12 });
  assert.deepEqual(parseByteRange("bytes=-200", 100), { start:0, end:99, length:100 });
  assert.deepEqual(parseByteRange("bytes=95-200", 100), { start:95, end:99, length:5 });
  assert.equal(parseByteRange(undefined, 100), null);
});

test("rejects malformed and unsatisfiable byte ranges", () => {
  for (const value of ["bytes=", "bytes=10-5", "bytes=100-", "bytes=0-1,4-5", "items=0-1", "bytes=-0"]) {
    assert.throws(() => parseByteRange(value, 100), { code:"INVALID_RANGE" });
  }
  assert.throws(() => parseByteRange("bytes=0-1", 0), { code:"INVALID_RANGE" });
});

test("only content-addressed generated videos use immutable caching", () => {
  assert.equal(cacheControlForStaticPath("/dinet-avatar/generated/0123456789abcdef01234567.mp4", ".mp4"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForStaticPath("/wav2lip-avatar/generated/abcdef0123456789abcdef01.mp4", ".mp4"), "public, max-age=31536000, immutable");
  assert.equal(cacheControlForStaticPath("/dinet-avatar/generated/latest.mp4", ".mp4"), "no-cache");
  assert.equal(cacheControlForStaticPath("/index.html", ".html"), "no-store");
});
