const IMMUTABLE_GENERATED_VIDEO = /^\/(?:dinet-avatar|wav2lip-avatar)\/generated\/[a-f0-9]{24}\.mp4$/;

function invalidRange() {
  return Object.assign(new RangeError("无效的字节范围"), { code: "INVALID_RANGE" });
}

export function cacheControlForStaticPath(pathname, extension) {
  if (IMMUTABLE_GENERATED_VIDEO.test(pathname)) return "public, max-age=31536000, immutable";
  if ([".html", ".js", ".json"].includes(extension)) return "no-store";
  return "no-cache";
}

export function parseByteRange(header, size) {
  if (!header) return null;
  if (!Number.isSafeInteger(size) || size <= 0) throw invalidRange();

  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) throw invalidRange();

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw invalidRange();
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) throw invalidRange();
    end = Math.min(end, size - 1);
  }

  return { start, end, length:end - start + 1 };
}
