/**
 * The 10-second smoke test: is RAVN up, and which venues are racing right now?
 *
 *   npm run health
 *
 * No key, no signup, no wallet. If this prints venues, you are already integrated enough to quote.
 */
import { RAVN_BASE } from "./ravn.js";

// /health isn't in the SDK (0.1.15): a plain fetch.
const res = await fetch(`${RAVN_BASE}/health`);
if (!res.ok) throw new Error(`RAVN /health answered HTTP ${res.status}`);
const { data: h } = (await res.json()) as { data: { status: string; venues: { id: string; name: string; healthy: boolean }[] } };

console.log(`\nRAVN: ${h.status}  (${h.venues.filter((v) => v.healthy).length}/${h.venues.length} venues healthy)\n`);
for (const v of h.venues) {
  console.log(`  ${v.healthy ? "up  " : "DOWN"}  ${v.name}`);
}
console.log("\nNext: npm run btc-out\n");
