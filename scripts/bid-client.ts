import { Connection, PublicKey } from "@solana/web3.js";

import {
  Chain,
  createEncryptClient,
  DEVNET_PRE_ALPHA_GRPC_URL,
  mockCiphertext,
} from "./lib/encrypt-client";
import {
  DEFAULT_SOLANA_RPC_URL,
  ENCRYPT_PROGRAM_ID,
  FHE_UINT64,
  LIQUIDATION_PROGRAM_ID,
  findEncryptAccounts,
  loadKeypair,
  parsePublicKey,
  submitEncryptedBid,
} from "./lib/liquidation";

interface BidCliArgs {
  position: string;
  bidAmount: string;
  bidderBtcAddress: string;
  wallet?: string;
  rpcUrl?: string;
  grpcUrl?: string;
  liquidationProgramId?: string;
  encryptProgramId?: string;
}

function parseArgs(argv: string[]): BidCliArgs {
  const args: BidCliArgs = {
    position: "",
    bidAmount: "",
    bidderBtcAddress: "",
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
      case "--bid-amount":
        args.bidAmount = value;
        break;
      case "--bidder-btc-address":
        args.bidderBtcAddress = value;
        break;
      case "--wallet":
        args.wallet = value;
        break;
      case "--rpc-url":
        args.rpcUrl = value;
        break;
      case "--grpc-url":
        args.grpcUrl = value;
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

  if (!args.position || !args.bidAmount || !args.bidderBtcAddress) {
    throw new Error(
      "Usage: yarn bid --position <POSITION_PUBKEY> --bid-amount <LAMPORTS> --bidder-btc-address <TB1...> [--wallet <KEYPAIR_JSON>] [--rpc-url <URL>] [--grpc-url <URL>]",
    );
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payer = loadKeypair(args.wallet);
  const position = parsePublicKey(args.position, "position pubkey");
  const bidAmount = BigInt(args.bidAmount);
  const rpcUrl = args.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;
  const grpcUrl =
    args.grpcUrl ?? process.env.ENCRYPT_GRPC_URL ?? DEVNET_PRE_ALPHA_GRPC_URL;
  const liquidationProgramId = args.liquidationProgramId
    ? parsePublicKey(args.liquidationProgramId, "liquidation program id")
    : LIQUIDATION_PROGRAM_ID;
  const encryptProgramId = args.encryptProgramId
    ? parsePublicKey(args.encryptProgramId, "encrypt program id")
    : ENCRYPT_PROGRAM_ID;

  const connection = new Connection(rpcUrl, "confirmed");
  const encrypt = createEncryptClient(grpcUrl);
  const encryptAccounts = findEncryptAccounts(
    payer.publicKey,
    liquidationProgramId,
    encryptProgramId,
  );

  const { ciphertextIdentifiers } = await encrypt.createInput({
    chain: Chain.Solana,
    inputs: [
      {
        ciphertextBytes: Buffer.from(mockCiphertext(bidAmount)),
        fheType: FHE_UINT64,
      },
    ],
    authorized: liquidationProgramId.toBuffer(),
    networkEncryptionPublicKey: encryptAccounts.networkKey,
  });

  if (ciphertextIdentifiers.length !== 1) {
    throw new Error(
      `Encrypt returned ${ciphertextIdentifiers.length} ciphertext ids; expected 1`,
    );
  }

  const ciphertextAccount = new PublicKey(ciphertextIdentifiers[0]);

  const { signature, bidPda } = await submitEncryptedBid({
    connection,
    payer,
    position,
    ciphertextAccount,
    bidderBtcAddress: args.bidderBtcAddress,
    programId: liquidationProgramId,
  });

  console.log(`Bidder: ${payer.publicKey.toBase58()}`);
  console.log(`Bid PDA: ${bidPda.toBase58()}`);
  console.log(`Ciphertext: ${ciphertextAccount.toBase58()}`);
  console.log(`Submit bid signature: ${signature}`);

  encrypt.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
