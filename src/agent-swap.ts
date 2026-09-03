/**
 * Give Claude a wallet: a tool-calling loop where the model decides the swap and RAVN executes it.
 *
 *   npm run agent -- "swap 25 USDC on Base into native bitcoin"
 *
 * The model never holds a key. It calls `get_quote`, you decide whether to sign. That separation
 * is the whole point: the LLM chooses intent, your code keeps custody.
 *
 * If your agent already speaks MCP, you do not need any of this — point it at
 * https://app.ravn.exchange/api/mcp and the same tools show up natively. See MCP.md.
 */
import Anthropic from "@anthropic-ai/sdk";
import { ravn, CHAIN, NATIVE, fromBaseUnits, toBaseUnits } from "./ravn.js";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

const USER_ADDRESS = process.env.USER_ADDRESS ?? "0x742d35Cc6634C0532925a3b844Bc454e4438f44e";

const TOKENS: Record<string, { chainId: number; address: string; decimals: number }> = {
  "usdc-base": { chainId: CHAIN.base, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  "usdc-arbitrum": { chainId: CHAIN.arbitrum, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
  "eth-base": { chainId: CHAIN.base, address: NATIVE, decimals: 18 },
  "eth-ethereum": { chainId: CHAIN.ethereum, address: NATIVE, decimals: 18 },
  "btc": { chainId: CHAIN.bitcoin, address: "BTC", decimals: 8 },
  "sol": { chainId: CHAIN.solana, address: "So11111111111111111111111111111111111111112", decimals: 9 },
};

const tools: Anthropic.Tool[] = [
  {
    name: "get_quote",
    description:
      "Price a crypto swap through RAVN across 16 chains, including native (non-wrapped) Bitcoin " +
      "and Solana. Returns the best net output across 12 venues. Does not move any funds.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", enum: Object.keys(TOKENS), description: "Token to sell" },
        to: { type: "string", enum: Object.keys(TOKENS), description: "Token to buy" },
        amount: { type: "string", description: "Human amount to sell, e.g. '25' or '0.5'" },
        destinationAddress: {
          type: "string",
          description: "Required when buying BTC or SOL — the address on that chain.",
        },
      },
      required: ["from", "to", "amount"],
    },
  },
];

async function getQuote(input: { from: string; to: string; amount: string; destinationAddress?: string }) {
  const from = TOKENS[input.from];
  const to = TOKENS[input.to];
  if (!from || !to) return { error: "unknown token" };

  const quote = await ravn.quote({
    inputChainId: from.chainId,
    inputToken: from.address,
    outputChainId: to.chainId,
    outputToken: to.address,
    inputAmount: toBaseUnits(input.amount, from.decimals),
    userAddress: USER_ADDRESS,
    ...(input.destinationAddress ? { destinationAddress: input.destinationAddress } : {}),
  });

  return {
    venue: quote.venue.name,
    youReceive: `${fromBaseUnits(quote.output.amount, quote.output.token.decimals)} ${quote.output.token.symbol}`,
    ravnFeeBps: quote.fee.bps,
    estimatedSeconds: quote.estimatedTimeSeconds,
    // Keep the token: it is what /execute needs. Opaque — never parse it.
    quoteToken: quote.quoteToken,
  };
}

async function main() {
  const prompt = process.argv.slice(2).join(" ") || "swap 25 USDC on Base into native bitcoin";
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let turn = 0; turn < 6; turn++) {
    const res = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      tools,
      system:
        "You help users swap crypto via RAVN. Quote before asserting any number. RAVN charges " +
        "0 bps. Buying BTC or SOL requires a destinationAddress — ask for one if it is missing. " +
        "Never claim a swap executed: you can only quote.",
      messages,
    });

    const toolUses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
    for (const block of res.content) {
      if (block.type === "text" && block.text.trim()) console.log(`\n${block.text}`);
    }
    if (toolUses.length === 0) return;

    messages.push({ role: "assistant", content: res.content });
    messages.push({
      role: "user",
      content: await Promise.all(
        toolUses.map(async (tu) => {
          let result: unknown;
          try {
            result = await getQuote(tu.input as Parameters<typeof getQuote>[0]);
          } catch (e) {
            result = { error: (e as Error).message };
          }
          console.log(`  [${tu.name}] ${JSON.stringify(result).slice(0, 160)}…`);
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          };
        })
      ),
    });
  }
}

main().catch((e) => {
  console.error(`\n${e.name ?? "Error"}: ${e.message}`);
  process.exit(1);
});
