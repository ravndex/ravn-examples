/**
 * A minimal, dependency-free RAVN client.
 *
 * There is no RAVN SDK on purpose — the API is small enough that this file IS the SDK. Copy it
 * into your project and delete what you don't use.
 *
 * Docs: https://docs.ravn.exchange
 */

export const RAVN_BASE = process.env.RAVN_BASE_URL ?? "https://app.ravn.exchange/api/v1";

/** Native coin sentinel — use as a token address for ETH, BNB, AVAX, etc. */
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const CHAIN = {
  ethereum: 1,
  optimism: 10,
  bnb: 56,
  unichain: 130,
  monad: 143,
  polygon: 137,
  zksync: 324,
  worldchain: 480,
  hyperevm: 999,
  robinhood: 4663,
  base: 8453,
  arbitrum: 42161,
  linea: 59144,
  avalanche: 43114,
  /** Native Bitcoin. Not wrapped, not cbBTC. */
  bitcoin: -1,
  solana: -2,
} as const;

export interface QuoteRequest {
  inputChainId: number;
  inputToken: string;
  outputChainId: number;
  outputToken: string;
  /** Smallest unit, as a string: wei, lamports, satoshis. Never a float. */
  inputAmount: string;
  userAddress: string;
  /** Required when the destination is a different ecosystem (e.g. an EVM sell landing in BTC). */
  destinationAddress?: string;
  refundAddress?: string;
  slippageBps?: number;
  rankingMode?: "best_output" | "fastest";
}

export interface Quote {
  quoteToken: string;
  venue: { id: string; name: string };
  routeType: string;
  input: { token: TokenInfo; amount: string };
  output: { token: TokenInfo; amount: string };
  fee: { bps: number; amount: string; token?: TokenInfo };
  slippage: { bps: number; isFirm: boolean; guaranteedMin: string | null };
  gas?: { native: string; nativeSymbol: string; usd: string | null; estimated: boolean };
  estimatedTimeSeconds: number;
  expiresAt: number;
}

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  chainId: number;
  isNative: boolean;
}

/**
 * An ERC-20 `approve()` you must land BEFORE the swap.
 *
 * Present only when the input token actually needs an allowance. Read the on-chain allowance
 * for `spender` first and skip this when it already covers `amount`.
 */
export interface Approval {
  to: string;
  data: string;
  value: string;
  chainId?: number;
  spender?: string;
  amount: string;
}

export type Execution =
  | { executionType: "TRANSACTION"; approval?: Approval; transaction: { to?: string; data?: string; value?: string; chainId?: number; serialized?: string } }
  | { executionType: "SIGNATURE"; approval?: Approval; typedData?: Record<string, unknown>; approvalData?: Record<string, unknown>; submit: { url: string; payload?: Record<string, unknown> } }
  | { executionType: "DEPOSIT"; deposit: { address: string; amount: string; chainId?: number }; statusRef: string };

export interface SwapStatus {
  status: "pending" | "processing" | "success" | "refunded" | "failed" | "unknown" | string;
  [k: string]: unknown;
}

class RavnError extends Error {
  constructor(public code: string, message: string, public requestId?: string) {
    super(message);
    this.name = "RavnError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${RAVN_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      // Optional. Anonymous works at 30 req/min; a free key raises it to 120.
      ...(process.env.RAVN_API_KEY ? { "x-api-key": process.env.RAVN_API_KEY } : {}),
      ...init.headers,
    },
  });
  const body = (await res.json()) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || body.error) {
    // Branch on the stable `code`, never the message.
    throw new RavnError(
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? `HTTP ${res.status}`,
      res.headers.get("x-request-id") ?? undefined
    );
  }
  return body.data as T;
}

export const ravn = {
  quote: (req: QuoteRequest) => call<Quote>("/quote", { method: "POST", body: JSON.stringify(req) }),

  execute: (quoteToken: string, opts: { destinationAddress?: string; refundAddress?: string } = {}) =>
    call<Execution>("/execute", { method: "POST", body: JSON.stringify({ quoteToken, ...opts }) }),

  submitSignature: (quoteToken: string, signature: string, approvalSignature?: string) =>
    call<{ statusRef?: string; [k: string]: unknown }>("/submit-signature", {
      method: "POST",
      body: JSON.stringify({ quoteToken, signature, ...(approvalSignature ? { approvalSignature } : {}) }),
    }),

  status: (quoteToken: string, ref: string) =>
    call<SwapStatus>(`/status?quoteToken=${encodeURIComponent(quoteToken)}&ref=${encodeURIComponent(ref)}`),

  health: () => call<{ status: string; venues: { id: string; name: string; healthy: boolean }[] }>("/health"),
};

/** Human amount → smallest unit, without floating-point error. */
export function toBaseUnits(amount: string, decimals: number): string {
  const [whole, frac = ""] = amount.split(".");
  return (BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

/** Smallest unit → human string, for display only. */
export function fromBaseUnits(amount: string, decimals: number): string {
  const s = amount.padStart(decimals + 1, "0");
  const out = `${s.slice(0, -decimals) || "0"}.${s.slice(-decimals)}`.replace(/\.?0+$/, "");
  return out || "0";
}

export { RavnError };
