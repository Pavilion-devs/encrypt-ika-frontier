import { Connection } from "@solana/web3.js";

import {
  DEFAULT_SOLANA_RPC_URL,
  ENCRYPT_PROGRAM_ID,
  LIQUIDATION_PROGRAM_ID,
  loadKeypair,
  parsePublicKey,
  resolveAuction,
} from "./lib/liquidation";

interface ResolveCliArgs {
  position: string;
  bids: string;
  wallet?: string;
  rpcUrl?: string;
  liquidationProgramId?: string;
  encryptProgramId?: string;
}

function parseArgs(argv: string[]): ResolveCliArgs {
  const args: ResolveCliArgs = {
    position: "",
    bids: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key.startsWith("--")) {
      continue;
    }
    if (value === undefined) {
      throw new Error(`Missing value for ${key}`);
    }

    switch (key) {
      case "--position":
        args.position = value;
        break;
      case "--bids":
        args.bids = value;
        break;
      case "--wallet":
        args.wallet = value;
        break;
      case "--rpc-url":
        args.rpcUrl = value;
        break;
      case "--liquidation-program-id":
        args.liquidationProgramId = value;
        break;
      case "--encrypt-program-id":
        args.encryptProgramId = value;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
    index += 1;
  }

  if (!args.position || !args.bids) {
    throw new Error(
      "Usage: yarn resolve --position <POSITION_PUBKEY> --bids <BID1,BID2,BID3> [--wallet <KEYPAIR_JSON>] [--rpc-url <URL>]",
    );
  }

  return args;
}

function parseBidAccounts(value: string) {
  const bids = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => parsePublicKey(entry, `bid account ${index + 1}`));

  if (bids.length !== 3) {
    throw new Error("Resolve auction requires exactly 3 ordered bid accounts");
  }

  return bids as [typeof bids[0], typeof bids[1], typeof bids[2]];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payer = loadKeypair(args.wallet);
  const position = parsePublicKey(args.position, "position pubkey");
  const bidAccounts = parseBidAccounts(args.bids);
  const rpcUrl = args.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;
  const liquidationProgramId = args.liquidationProgramId
    ? parsePublicKey(args.liquidationProgramId, "liquidation program id")
    : LIQUIDATION_PROGRAM_ID;
  const encryptProgramId = args.encryptProgramId
    ? parsePublicKey(args.encryptProgramId, "encrypt program id")
    : ENCRYPT_PROGRAM_ID;

  const connection = new Connection(rpcUrl, "confirmed");
  const { signature, resultCiphertext, priceCiphertext } = await resolveAuction({
    connection,
    payer,
    position,
    bidAccounts,
    programId: liquidationProgramId,
    encryptProgramId,
  });

  console.log(`Position: ${position.toBase58()}`);
  console.log(`Winner ciphertext: ${resultCiphertext.toBase58()}`);
  console.log(`Price ciphertext: ${priceCiphertext.toBase58()}`);
  console.log(`Resolve auction signature: ${signature}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
