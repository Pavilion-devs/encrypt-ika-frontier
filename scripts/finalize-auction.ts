import { Connection } from "@solana/web3.js";

import {
  DEFAULT_SOLANA_RPC_URL,
  IKA_PROGRAM_ID,
  LIQUIDATION_PROGRAM_ID,
  finalizeAuction,
  loadKeypair,
  parse32ByteValue,
  parsePublicKey,
} from "./lib/liquidation";

interface FinalizeCliArgs {
  position: string;
  bids: string;
  dwallet: string;
  btcTxHash: string;
  approvalUserPubkey: string;
  wallet?: string;
  rpcUrl?: string;
  liquidationProgramId?: string;
  dwalletProgramId?: string;
}

function parseArgs(argv: string[]): FinalizeCliArgs {
  const args: FinalizeCliArgs = {
    position: "",
    bids: "",
    dwallet: "",
    btcTxHash: "",
    approvalUserPubkey: "",
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
      case "--dwallet":
        args.dwallet = value;
        break;
      case "--btc-tx-hash":
        args.btcTxHash = value;
        break;
      case "--approval-user-pubkey":
        args.approvalUserPubkey = value;
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
      case "--dwallet-program-id":
        args.dwalletProgramId = value;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
    index += 1;
  }

  if (
    !args.position ||
    !args.bids ||
    !args.dwallet ||
    !args.btcTxHash ||
    !args.approvalUserPubkey
  ) {
    throw new Error(
      "Usage: yarn finalize-auction --position <POSITION_PUBKEY> --bids <BID1,BID2,BID3> --dwallet <DWALLET_PUBKEY> --btc-tx-hash <32B_KECCAK_APPROVAL_HASH> --approval-user-pubkey <32B_DKG_ADDR_HEX_OR_BASE58> [--wallet <KEYPAIR_JSON>] [--rpc-url <URL>]"
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
    throw new Error("Finalize requires exactly 3 ordered bid accounts");
  }

  return bids as [(typeof bids)[0], (typeof bids)[1], (typeof bids)[2]];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payer = loadKeypair(args.wallet);
  const position = parsePublicKey(args.position, "position pubkey");
  const bidAccounts = parseBidAccounts(args.bids);
  const dwallet = parsePublicKey(args.dwallet, "dWallet pubkey");
  const btcTxHash = parse32ByteValue(args.btcTxHash, "bitcoin tx hash");
  const approvalUserPubkey = parse32ByteValue(
    args.approvalUserPubkey,
    "approval user pubkey"
  );
  const rpcUrl =
    args.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;
  const liquidationProgramId = args.liquidationProgramId
    ? parsePublicKey(args.liquidationProgramId, "liquidation program id")
    : LIQUIDATION_PROGRAM_ID;
  const dwalletProgramId = args.dwalletProgramId
    ? parsePublicKey(args.dwalletProgramId, "dWallet program id")
    : IKA_PROGRAM_ID;

  const connection = new Connection(rpcUrl, "confirmed");
  const { signature, messageApproval } = await finalizeAuction({
    connection,
    payer,
    position,
    bidAccounts,
    dwallet,
    btcTxHash,
    approvalUserPubkey,
    programId: liquidationProgramId,
    dwalletProgramId,
  });

  console.log(`Position: ${position.toBase58()}`);
  console.log(`MessageApproval: ${messageApproval.toBase58()}`);
  console.log(`Finalize signature: ${signature}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
