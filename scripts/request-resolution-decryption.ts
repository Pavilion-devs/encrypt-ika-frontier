import { Connection } from "@solana/web3.js";

import {
  DEFAULT_SOLANA_RPC_URL,
  ENCRYPT_PROGRAM_ID,
  LIQUIDATION_PROGRAM_ID,
  loadKeypair,
  parsePublicKey,
  requestResolutionDecryption,
} from "./lib/liquidation";

interface RequestCliArgs {
  position: string;
  wallet?: string;
  rpcUrl?: string;
  liquidationProgramId?: string;
  encryptProgramId?: string;
}

function parseArgs(argv: string[]): RequestCliArgs {
  const args: RequestCliArgs = { position: "" };

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

  if (!args.position) {
    throw new Error(
      "Usage: yarn request-resolution-decryption --position <POSITION_PUBKEY> [--wallet <KEYPAIR_JSON>] [--rpc-url <URL>]",
    );
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payer = loadKeypair(args.wallet);
  const position = parsePublicKey(args.position, "position pubkey");
  const rpcUrl = args.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;
  const liquidationProgramId = args.liquidationProgramId
    ? parsePublicKey(args.liquidationProgramId, "liquidation program id")
    : LIQUIDATION_PROGRAM_ID;
  const encryptProgramId = args.encryptProgramId
    ? parsePublicKey(args.encryptProgramId, "encrypt program id")
    : ENCRYPT_PROGRAM_ID;

  const connection = new Connection(rpcUrl, "confirmed");
  const { signature, resultRequest, priceRequest } =
    await requestResolutionDecryption({
      connection,
      payer,
      position,
      programId: liquidationProgramId,
      encryptProgramId,
    });

  console.log(`Position: ${position.toBase58()}`);
  console.log(`Winner request: ${resultRequest.toBase58()}`);
  console.log(`Price request: ${priceRequest.toBase58()}`);
  console.log(`Request decryption signature: ${signature}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
