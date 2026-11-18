import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { HttpRequest, HttpResponse } from "./engine.js";

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;

/** True for addresses inside a network: a process must not reach the office's own systems by accident. */
export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) return ip === "::1" || ip === "::" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || /^::ffff:(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(ip);
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The server's HTTP client for the "HTTP request" step. http and https only, no redirects, a time limit, a size limit,
 * and no addresses inside a network, except the demo API of this prototype (`allowPrefix`).
 */
export function makeHttpClient(allowPrefix: string): (req: HttpRequest) => Promise<HttpResponse> {
  return async (req) => {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      throw new Error(`“${req.url || "(empty)"}” is not a valid address.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https addresses are allowed.");
    if (!req.url.startsWith(allowPrefix)) {
      const host = url.hostname.replace(/^\[|\]$/g, "");
      if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Addresses inside a network are not allowed.");
      const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
      if (ips.length === 0) throw new Error(`The address “${host}” could not be found.`);
      if (ips.some(isPrivateAddress)) throw new Error("Addresses inside a network are not allowed.");
    }
    const res = await fetch(url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((e: unknown) => {
      throw new Error(e instanceof Error && e.name === "TimeoutError" ? "The system did not answer in time." : `The system could not be reached.`);
    });
    if (res.status >= 300 && res.status < 400) throw new Error(`The system redirects to another address (status ${res.status}). Use the final address.`);
    const text = (await res.text()).slice(0, MAX_BYTES);
    return { status: res.status, body: text };
  };
}

/** A fake system with a nested answer, so the JSON picker can be shown without a real API. */
export const DEMO_EXCHANGE = {
  meta: { source: "Musterbank (fake data)", updated: "2026-11-18", paging: { page: 1, pages: 1 } },
  data: {
    base: "EUR",
    country: { code: "CA", name: "Canada", region: { name: "North America", eu: false } },
    rates: [
      { currency: "CAD", value: 1.52, trend: "up" },
      { currency: "USD", value: 1.08, trend: "down" },
      { currency: "GBP", value: 0.86, trend: "flat" },
    ],
    limits: { monthlyFunding: { max: 934, currency: "EUR" } },
  },
};
