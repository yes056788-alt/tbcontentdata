import { ApiError, parseInteger } from "./http";

const MAX_EXPECTED_REVISION = Number.MAX_SAFE_INTEGER - 1;

export function parseExpectedRevision(
  request: Request,
  bodyValue: unknown,
): number {
  const headerValue = request.headers.get("if-match");
  let headerRevision: number | undefined;
  if (headerValue) {
    const normalized = headerValue
      .trim()
      .replace(/^W\//i, "")
      .replace(/^"|"$/g, "");
    headerRevision = parseInteger(normalized, "If-Match", {
      min: 0,
      max: MAX_EXPECTED_REVISION,
      required: true,
    });
  }
  const bodyRevision = parseInteger(bodyValue, "expectedRevision", {
    min: 0,
    max: MAX_EXPECTED_REVISION,
  });
  if (
    headerRevision !== undefined &&
    bodyRevision !== undefined &&
    headerRevision !== bodyRevision
  ) {
    throw new ApiError(
      400,
      "REVISION_MISMATCH",
      "If-Match 与 expectedRevision 不一致。",
    );
  }
  const expected = headerRevision ?? bodyRevision;
  if (expected === undefined) {
    throw new ApiError(
      428,
      "REVISION_REQUIRED",
      "更新共享数据时必须提供 expectedRevision 或 If-Match。",
    );
  }
  return expected;
}

export function revisionEtag(revision: number) {
  return `"${revision}"`;
}
