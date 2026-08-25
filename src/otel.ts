/**
 * Minimal OTLP/HTTP trace emission — no SDK, no dependencies.
 *
 * Each verb invocation becomes one span, POSTed as OTLP JSON to the local
 * collector (the same one Claude Code's telemetry lands in, see
 * bdelanghe/home programs/claude-monitoring.nix). Fire-and-forget with a
 * short timeout and silent failure: a machine without a collector runs the
 * verbs exactly as before. Hand-rolled because pulling the OpenTelemetry SDK
 * into a two-verb CLI would be more dependency than tool.
 */
const ENDPOINT =
  (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318")
    .replace(/:4317$/, ":4318"); // grpc port → http port if someone set the grpc one

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

export async function emitVerbSpan(opts: {
  verb: string;
  ok: boolean;
  exitCode: number;
  startMs: number;
  attributes?: Record<string, string | number | boolean>;
}): Promise<void> {
  const toVal = (v: string | number | boolean) =>
    typeof v === "string" ? { stringValue: v }
    : typeof v === "boolean" ? { boolValue: v }
    : Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  const attrs = Object.entries({
    "verb.id": opts.verb, "verb.ok": opts.ok, "verb.exit_code": opts.exitCode,
    ...opts.attributes,
  }).map(([key, v]) => ({ key, value: toVal(v) }));

  const body = JSON.stringify({
    resourceSpans: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "flake-verbs" } }] },
      scopeSpans: [{
        scope: { name: "flake-verbs" },
        spans: [{
          traceId: hex(16), spanId: hex(8),
          name: `verb ${opts.verb}`, kind: 1,
          startTimeUnixNano: String(Math.round(opts.startMs * 1e6)),
          endTimeUnixNano: String(Math.round(Date.now() * 1e6)),
          attributes: attrs,
          status: { code: opts.ok ? 1 : 2 },
        }],
      }],
    }],
  });

  try {
    await fetch(`${ENDPOINT}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(400),
    });
  } catch { /* no collector — the verbs owe nothing to telemetry */ }
}
