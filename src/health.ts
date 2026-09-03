/**
 * The 10-second smoke test: is RAVN up, and which venues are racing right now?
 *
 *   npm run health
 *
 * No key, no signup, no wallet. If this prints venues, you are already integrated enough to quote.
 */
import { ravn } from "./ravn.js";

const h = await ravn.health();

console.log(`\nRAVN: ${h.status}  (${h.venues.filter((v) => v.healthy).length}/${h.venues.length} venues healthy)\n`);
for (const v of h.venues) {
  console.log(`  ${v.healthy ? "up  " : "DOWN"}  ${v.name}`);
}
console.log("\nNext: npm run btc-out\n");
