/**
 * USDC on Base → NATIVE Bitcoin, end to end.
 *
 * This is the example most swap APIs cannot run at all. The BTC that lands is real Bitcoin on
 * the Bitcoin network — not wBTC, not cbBTC, not a bridge receipt. RAVN races Garden, Chainflip,
 * THORChain, Relay and NEAR Intents for it and takes the best net output.
 *
 *   DRY RUN (no wallet, no funds):  npm run btc-out
 *   REAL SWAP:                      set PRIVATE_KEY and EXECUTE=1
 *
 * Cross-ecosystem swaps need `destinationAddress` — your Bitcoin address — because the payout
 * chain has no concept of your EVM address.
 */
import { createWalletClient, createPublicClient, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { ravn, CHAIN, fromBaseUnits, toBaseUnits } from "./ravn.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// Where the real BTC should land. Replace with your own before running for real.
const BTC_DESTINATION = process.env.BTC_DESTINATION ?? "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const AMOUNT_USDC = process.env.AMOUNT_USDC ?? "25";

async function main() {
  const account = process.env.PRIVATE_KEY
    ? privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`)
    : undefined;
  // A quote needs *an* address to price against; a real swap needs your actual one.
  const userAddress = account?.address ?? "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

  console.log(`\nQuoting ${AMOUNT_USDC} USDC (Base) → native BTC…`);

  const quote = await ravn.quote({
    inputChainId: CHAIN.base,
    inputToken: USDC_BASE,
    outputChainId: CHAIN.bitcoin,
    outputToken: "BTC",
    inputAmount: toBaseUnits(AMOUNT_USDC, 6),
    userAddress,
    destinationAddress: BTC_DESTINATION,
  });

  console.log(`  venue      ${quote.venue.name}`);
  console.log(`  you get    ${fromBaseUnits(quote.output.amount, quote.output.token.decimals)} BTC`);
  console.log(`  RAVN fee   ${quote.fee.bps} bps`);
  console.log(`  eta        ~${quote.estimatedTimeSeconds}s`);

  if (!account || process.env.EXECUTE !== "1") {
    console.log("\nDry run only. Set PRIVATE_KEY and EXECUTE=1 to actually swap.\n");
    return;
  }

  const execution = await ravn.execute(quote.quoteToken, { destinationAddress: BTC_DESTINATION });
  console.log(`  execution  ${execution.executionType}`);

  const wallet = createWalletClient({ account, chain: base, transport: http() });
  const pub = createPublicClient({ chain: base, transport: http() });

  if (execution.executionType === "DEPOSIT") {
    // Most BTC-out routes land here: send the input asset to an address RAVN gives you, and
    // the venue delivers native BTC to your destination.
    const { address, amount } = execution.deposit;
    console.log(`  → sending ${amount} USDC-base-units to ${address}`);
    const hash = await wallet.writeContract({
      address: USDC_BASE, abi: erc20Abi, functionName: "transfer",
      args: [address as `0x${string}`, BigInt(amount)],
    });
    await pub.waitForTransactionReceipt({ hash });
    await track(quote.quoteToken, execution.statusRef);
    return;
  }

  if (execution.executionType === "TRANSACTION") {
    // The approval, when present, MUST be mined before the swap or it reverts on transferFrom.
    if (execution.approval) {
      console.log(`  → approving ${execution.approval.spender}`);
      const approveHash = await wallet.sendTransaction({
        to: execution.approval.to as `0x${string}`,
        data: execution.approval.data as `0x${string}`,
        value: BigInt(execution.approval.value ?? "0"),
      });
      await pub.waitForTransactionReceipt({ hash: approveHash }); // wait for MINED, not broadcast
    }
    const hash = await wallet.sendTransaction({
      to: execution.transaction.to as `0x${string}`,
      data: execution.transaction.data as `0x${string}`,
      value: BigInt(execution.transaction.value ?? "0"),
    });
    console.log(`  → swap tx ${hash}`);
    await pub.waitForTransactionReceipt({ hash });
    await track(quote.quoteToken, hash);
  }
}

async function track(quoteToken: string, ref: string) {
  console.log("\nTracking…");
  for (let i = 0; i < 60; i++) {
    const s = await ravn.status(quoteToken, ref);
    console.log(`  ${s.status}`);
    if (["success", "refunded", "failed"].includes(s.status)) return;
    await new Promise((r) => setTimeout(r, 10_000));
  }
  console.log("  still pending — cross-ecosystem swaps can take several minutes");
}

main().catch((e) => {
  console.error(`\n${e.name ?? "Error"}: ${e.message}${e.requestId ? ` (request ${e.requestId})` : ""}`);
  process.exit(1);
});
