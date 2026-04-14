import { Connection, PublicKey } from "@solana/web3.js";

import {
  DEFAULT_BITCOIN_FEE_SATS,
  DEFAULT_BITCOIN_LOCK_TIME,
  DEFAULT_BITCOIN_SEQUENCE,
  buildBitcoinLiquidationArtifacts,
  buildSignedBitcoinTransaction,
  broadcastViaEsplora,
  deriveExplorerUrl,
} from "./lib/bitcoin";
import {
  MESSAGE_APPROVAL_SIGNATURE_SCHEME_SECP256K1,
  MESSAGE_APPROVAL_STATUS_SIGNED,
  fetchDecodedDWalletAccount,
  fetchDecodedMessageApprovalAccount,
} from "./lib/ika-client";
import {
  DEFAULT_SOLANA_RPC_URL,
  IKA_PROGRAM_ID,
  auctionStatusLabel,
  fetchDecodedBidAccount,
  fetchDecodedPositionAccount,
  findMessageApprovalPda,
  parsePublicKey,
} from "./lib/liquidation";

interface BroadcastCliArgs {
  position: string;
  dwallet: string;
  prevTxid: string;
  prevVout: string;
  prevAmountSats?: string;
  sendAmountSats?: string;
  feeSats?: string;
  sequence?: string;
  lockTime?: string;
  rpcUrl?: string;
  dwalletProgramId?: string;
  broadcastUrl?: string;
}

const DEFAULT_PUBLIC_KEY = new PublicKey(Buffer.alloc(32));

function parseArgs(argv: string[]): BroadcastCliArgs {
  const args: BroadcastCliArgs = {
    position: "",
    dwallet: "",
    prevTxid: "",
    prevVout: "",
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
      case "--dwallet":
        args.dwallet = value;
        break;
      case "--btc-prev-txid":
        args.prevTxid = value;
        break;
      case "--btc-prev-vout":
        args.prevVout = value;
        break;
      case "--btc-prev-amount-sats":
        args.prevAmountSats = value;
        break;
      case "--btc-send-amount-sats":
        args.sendAmountSats = value;
        break;
      case "--btc-fee-sats":
        args.feeSats = value;
        break;
      case "--btc-sequence":
        args.sequence = value;
        break;
      case "--btc-lock-time":
        args.lockTime = value;
        break;
      case "--rpc-url":
        args.rpcUrl = value;
        break;
      case "--dwallet-program-id":
        args.dwalletProgramId = value;
        break;
      case "--broadcast-url":
        args.broadcastUrl = value;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
    index += 1;
  }

  if (!args.position || !args.dwallet || !args.prevTxid || !args.prevVout) {
    throw new Error(
      "Usage: yarn broadcast --position <POSITION_PUBKEY> --dwallet <DWALLET_PUBKEY> --btc-prev-txid <TXID_HEX> --btc-prev-vout <VOUT> [--btc-prev-amount-sats <SATS>] [--btc-send-amount-sats <SATS>] [--btc-fee-sats <SATS>] [--btc-sequence <U32>] [--btc-lock-time <U32>] [--rpc-url <URL>] [--broadcast-url <ESPLORA_BASE>]"
    );
  }

  return args;
}

function parseBigInt(
  value: string | undefined,
  label: string
): bigint | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) {
      throw new Error("negative");
    }
    return parsed;
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function parseU32(
  value: string | undefined,
  label: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const position = parsePublicKey(args.position, "position pubkey");
  const dwallet = parsePublicKey(args.dwallet, "dWallet pubkey");
  const dwalletProgramId = args.dwalletProgramId
    ? parsePublicKey(args.dwalletProgramId, "dWallet program id")
    : IKA_PROGRAM_ID;
  const rpcUrl =
    args.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;

  const connection = new Connection(rpcUrl, "confirmed");
  const positionState = await fetchDecodedPositionAccount(connection, position);
  if (positionState.resolvedBid.equals(DEFAULT_PUBLIC_KEY)) {
    throw new Error(
      "Position has no resolved bid yet; finalize must complete first"
    );
  }

  const winnerBid = await fetchDecodedBidAccount(
    connection,
    positionState.resolvedBid
  );
  const dwalletState = await fetchDecodedDWalletAccount(connection, dwallet);
  const [messageApproval] = findMessageApprovalPda(
    dwallet,
    positionState.approvedBtcTxHash,
    dwalletProgramId
  );
  const approval = await fetchDecodedMessageApprovalAccount(
    connection,
    messageApproval
  );

  if (approval.status !== MESSAGE_APPROVAL_STATUS_SIGNED) {
    throw new Error(
      `MessageApproval ${messageApproval.toBase58()} is ${
        approval.status === 0 ? "pending" : "not signed"
      }`
    );
  }
  if (
    approval.signatureScheme !== MESSAGE_APPROVAL_SIGNATURE_SCHEME_SECP256K1
  ) {
    throw new Error("MessageApproval signature scheme is not Secp256k1");
  }
  if (dwalletState.publicKey.length !== 33) {
    throw new Error(
      `dWallet public key must be 33-byte compressed secp256k1, got ${dwalletState.publicKey.length}`
    );
  }

  const feeSats =
    parseBigInt(args.feeSats, "bitcoin fee sats") ?? DEFAULT_BITCOIN_FEE_SATS;
  const prevAmountSats =
    parseBigInt(args.prevAmountSats, "bitcoin prev amount sats") ??
    positionState.collateralBtc;
  const sendAmountSats =
    parseBigInt(args.sendAmountSats, "bitcoin send amount sats") ??
    positionState.collateralBtc - feeSats;
  const sequence =
    parseU32(args.sequence, "bitcoin sequence") ?? DEFAULT_BITCOIN_SEQUENCE;
  const lockTime =
    parseU32(args.lockTime, "bitcoin lock time") ?? DEFAULT_BITCOIN_LOCK_TIME;

  if (sendAmountSats <= 0n) {
    throw new Error("Send amount must be positive after fees");
  }

  const artifacts = buildBitcoinLiquidationArtifacts({
    prevTxidHex: args.prevTxid,
    prevVout: parseU32(args.prevVout, "bitcoin prev vout") ?? 0,
    prevAmountSats,
    senderCompressedPubkey: dwalletState.publicKey,
    recipientAddress: winnerBid.bidderBtcAddress,
    sendAmountSats,
    sequence,
    lockTime,
    network: "testnet",
  });

  if (!artifacts.approvalMessageHash.equals(positionState.approvedBtcTxHash)) {
    throw new Error(
      "Computed approval hash does not match Position.approved_btc_tx_hash. Your UTXO or fee inputs do not match the preimage used during finalize."
    );
  }

  const signed = buildSignedBitcoinTransaction(
    artifacts,
    approval.signature,
    dwalletState.publicKey
  );

  console.log(`Position: ${position.toBase58()}`);
  console.log(`Auction status: ${auctionStatusLabel(positionState.status)}`);
  console.log(`Winner bid: ${positionState.resolvedBid.toBase58()}`);
  console.log(`Winner BTC address: ${winnerBid.bidderBtcAddress}`);
  console.log(`MessageApproval: ${messageApproval.toBase58()}`);
  console.log(
    `Approval hash: 0x${artifacts.approvalMessageHash.toString("hex")}`
  );
  console.log(
    `Signing digest (sha256d): 0x${artifacts.signingDigest.toString("hex")}`
  );
  console.log(`Raw tx hex: ${signed.rawTxHex}`);
  console.log(`Local txid: ${signed.txid}`);

  if (args.broadcastUrl) {
    const broadcastTxid = await broadcastViaEsplora(
      signed.rawTxHex,
      args.broadcastUrl
    );
    const explorerUrl = deriveExplorerUrl(args.broadcastUrl, broadcastTxid);
    console.log(`Broadcast txid: ${broadcastTxid}`);
    if (explorerUrl) {
      console.log(`Explorer: ${explorerUrl}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
