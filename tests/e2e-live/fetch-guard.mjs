// Preloaded into the LIVE test server only (NODE_OPTIONS=--import). Hard-caps outbound LLM traffic:
// one request per operation (rewrites, rules), no retries, only the Gemini host, nothing else leaves the process.
// Each allowed operation claims a slot file atomically, so the cap holds across forked server processes.
import fs from "node:fs";
import path from "node:path";

const dir = process.env.LIVE_GUARD_DIR;
const HOST = "generativelanguage.googleapis.com";
const scrub = (s) => String(s).replace(/AIza[A-Za-z0-9_-]{10,}/g, "[redacted]").replace(/\s+/g, " ").slice(0, 300);

if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  const log = (line) => fs.appendFileSync(path.join(dir, "guard.log"), `${new Date().toISOString()} pid=${process.pid} ${line}\n`);
  const real = process.env.LIVE_GUARD_STUB === "1"
    ? async (_i, init) => { // offline stub for dry runs: never touches the network
        const body = typeof init?.body === "string" ? init.body : "";
        const text = /rewrites/.test(body) ? '{"rewrites":[{"id":0,"text":"durable"}]}' : '{"rules":[{"statement":"Avoid the word cheap","kind":"forbidden_term","terms":["cheap"]}]}';
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP" }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    : globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(url).host;
    if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return real(input, init);
    if (host !== HOST) { log(`BLOCKED host=${host}`); throw new Error("blocked: host not allowed"); }
    const body = typeof init?.body === "string" ? init.body : "";
    const op = /Return \{\\?"rewrites\\?"/.test(body) ? "rewrites" : /Return \{\\?"rules\\?"/.test(body) ? "rules" : null;
    if (!op) { log("BLOCKED unrecognised request body"); throw new Error("blocked: unrecognised request"); }
    try { fs.writeFileSync(path.join(dir, `slot-${op}`), "", { flag: "wx" }); }
    catch { log(`BLOCKED second request for op=${op} (retry prevented)`); throw new Error("blocked: request budget exhausted"); }
    const t = Date.now();
    log(`ALLOWED op=${op}`);
    try {
      const res = await real(input, init);
      log(`RESPONSE op=${op} http=${res.status} ms=${Date.now() - t}`);
      if (res.status >= 400) log(`ERROR_BODY op=${op} ${scrub(await res.clone().text().catch(() => "(unreadable)"))}`);
      return res;
    } catch (e) {
      log(`FETCH_THREW op=${op} ms=${Date.now() - t} ${scrub(e instanceof Error ? e.message : e)}`);
      throw e;
    }
  };
}
