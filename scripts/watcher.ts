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
  DEFAULT_IKA_GRPC_URL,
  MESSAGE_APPROVAL_STATUS_SIGNED,
  createIkaClient,
  fetchDecodedDWalletAccount,
  fetchDecodedMessageApprovalAccount,
  waitForMessageApprovalSigned,
  waitForTransactionSlot,
} from "./lib/ika-client";
import {
  AUCTION_STATUS,
  DEFAULT_SOLANA_RPC_URL,
  IKA_PROGRAM_ID,
  auctionStatusLabel,
  fetchDecodedBidAccount,
  fetchDecodedPositionAccount,
  finalizeAuction,
  findMessageApprovalPda,
  loadKeypair,
  parse32ByteValue,
  parsePublicKey,
  requestResolutionDecryption,
  waitForResolutionDecryption,
} from "./lib/liquidation";

const DEFAULT_PUBLIC_KEY = new PublicKey(Buffer.alloc(32));

interface WatcherCliArgs {
  position: string;
  bids: string;
  dwallet: string;
  approvalUserPubkey: string;
  prevTxid: string;
  prevVout: string;
  prevAmountSats?: string;
  sendAmountSats?: string;
  feeSats?: string;
  sequence?: string;
  lockTime?: string;
  wallet?: string;
  rpcUrl?: string;
  ikaGrpcUrl?: string;
  dwalletProgramId?: string;
  broadcastUrl?: string;
  pollIntervalMs?: string;
  timeoutMs?: string;
  approvalTxSignature?: string;
  approvalTxSlot?: string;
}

function parseArgs(argv: string[]): WatcherCliArgs {
  const args: WatcherCliArgs = {
    position: "",
    bids: "",
    dwallet: "",
    approvalUserPubkey: "",
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
      case "--bids":
        args.bids = value;
        break;
      case "--dwallet":
        args.dwallet = value;
        break;
      case "--approval-user-pubkey":
        args.approvalUserPubkey = value;
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
      case "--wallet":
        args.wallet = value;
        break;
      case "--rpc-url":
        args.rpcUrl = value;
        break;
      case "--ika-grpc-url":
        args.ikaGrpcUrl = value;
        break;
      case "--dwallet-program-id":
        args.dwalletProgramId = value;
        break;
      case "--broadcast-url":
        args.broadcastUrl = value;
        break;
      case "--poll-interval-ms":
        args.pollIntervalMs = value;
        break;
      case "--timeout-ms":
        args.timeoutMs = value;
        break;
      case "--approval-tx-signature":
        args.approvalTxSignature = value;
        break;
      case "--approval-tx-slot":
        args.approvalTxSlot = value;
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
    !args.approvalUserPubkey ||
    !args.prevTxid ||
    !args.prevVout
  ) {
    throw new Error(
      "Usage: yarn watcher --position <POSITION_PUBKEY> --bids <BID1,BID2,BID3> --dwallet <DWALLET_PUBKEY> --approval-user-pubkey <32B_HEX_OR_BASE58_DKG_ADDR> --btc-prev-txid <TXID_HEX> --btc-prev-vout <VOUT> [--btc-prev-amount-sats <SATS>] [--btc-send-amount-sats <SATS>] [--btc-fee-sats <SATS>] [--btc-sequence <U32>] [--btc-lock-time <U32>] [--wallet <KEYPAIR_JSON>] [--rpc-url <URL>] [--ika-grpc-url <URL>] [--broadcast-url <ESPLORA_BASE>]"
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
    throw new Error("Watcher requires exactly 3 ordered bid accounts");
  }

  return bids as [(typeof bids)[0], (typeof bids)[1], (typeof bids)[2]];
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
  const payer = loadKeypair(args.wallet);
  const position = parsePublicKey(args.position, "position pubkey");
  const bidAccounts = parseBidAccounts(args.bids);
  const dwallet = parsePublicKey(args.dwallet, "dWallet pubkey");
  const approvalUserPubkey = parse32ByteValue(
    args.approvalUserPubkey,
    "approval user pubkey"
  );
  const dwalletProgramId = args.dwalletProgramId
    ? parsePublicKey(args.dwalletProgramId, "dWallet program id")
    : IKA_PROGRAM_ID;
  const rpcUrl =
    args.rpcUrl ?? process.env.SOLANA_RPC_URL ?? DEFAULT_SOLANA_RPC_URL;
  const ikaGrpcUrl =
    args.ikaGrpcUrl ?? process.env.IKA_GRPC_URL ?? DEFAULT_IKA_GRPC_URL;
  const timeoutMs = parseU32(args.timeoutMs, "timeout ms") ?? 90_000;
  const pollIntervalMs =
    parseU32(args.pollIntervalMs, "poll interval ms") ?? 2_000;

  const connection = new Connection(rpcUrl, "confirmed");
  let positionState = await fetchDecodedPositionAccount(connection, position);

  if (
    positionState.status === AUCTION_STATUS.Resolving &&
    positionState.resolutionResultRequest.equals(DEFAULT_PUBLIC_KEY)
  ) {
    const requestResult = await requestResolutionDecryption({
      connection,
      payer,
      position,
    });
    console.log(`Request decryption signature: ${requestResult.signature}`);
    console.log(`Winner request: ${requestResult.resultRequest.toBase58()}`);
    console.log(`Price request: ${requestResult.priceRequest.toBase58()}`);
  }

  let winnerIndex: bigint;
  let winningBidAmount: bigint;

  if (positionState.status === AUCTION_STATUS.Resolving) {
    const resolved = await waitForResolutionDecryption(
      connection,
      position,
      timeoutMs,
      pollIntervalMs
    );
    positionState = resolved.position;
    winnerIndex = resolved.winnerIndex;
    winningBidAmount = resolved.winningBidAmount;
  } else if (positionState.status === AUCTION_STATUS.Resolved) {
    winnerIndex = 0n;
    winningBidAmount = positionState.clearingPrice;
  } else {
    throw new Error(
      `Position must be Resolving or Resolved, got ${auctionStatusLabel(
        positionState.status
      )}`
    );
  }

  const dwalletState = await fetchDecodedDWalletAccount(connection, dwallet);
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

  const winnerBidPubkey =
    positionState.status === AUCTION_STATUS.Resolving
      ? [
          positionState.resolutionBid0,
          positionState.resolutionBid1,
          positionState.resolutionBid2,
        ][Number(winnerIndex)]
      : positionState.resolvedBid;

  if (winnerBidPubkey.equals(DEFAULT_PUBLIC_KEY)) {
    throw new Error("Unable to determine winner bid account");
  }

  const winnerBid = await fetchDecodedBidAccount(connection, winnerBidPubkey);
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

  let approvalSignature = args.approvalTxSignature;
  let approvalSlot = parseU32(args.approvalTxSlot, "approval tx slot");
  const [messageApproval] = findMessageApprovalPda(
    dwallet,
    artifacts.approvalMessageHash,
    dwalletProgramId
  );

  if (positionState.status === AUCTION_STATUS.Resolving) {
    const finalizeResult = await finalizeAuction({
      connection,
      payer,
      position,
      bidAccounts,
      dwallet,
      btcTxHash: artifacts.approvalMessageHash,
      approvalUserPubkey,
      dwalletProgramId,
    });
    approvalSignature = finalizeResult.signature;
    approvalSlot = await waitForTransactionSlot(
      connection,
      finalizeResult.signature,
      timeoutMs,
      pollIntervalMs
    );
    console.log(`Finalize signature: ${finalizeResult.signature}`);
    console.log(
      `MessageApproval: ${finalizeResult.messageApproval.toBase58()}`
    );
    positionState = await fetchDecodedPositionAccount(connection, position);
  } else if (
    !positionState.approvedBtcTxHash.equals(artifacts.approvalMessageHash)
  ) {
    throw new Error(
      "Position.approved_btc_tx_hash does not match the computed approval hash. Use the same Bitcoin inputs that were used at finalize time."
    );
  }

  let onchainApproval: Awaited<
    ReturnType<typeof fetchDecodedMessageApprovalAccount>
  > | null = null;

  try {
    onchainApproval = await fetchDecodedMessageApprovalAccount(
      connection,
      messageApproval
    );
  } catch {
    // The MessageApproval may not exist until finalize lands.
  }

  if (
    (!onchainApproval ||
      onchainApproval.status !== MESSAGE_APPROVAL_STATUS_SIGNED) &&
    (!approvalSignature || approvalSlot === undefined)
  ) {
    throw new Error(
      "MessageApproval is not signed yet and no finalize tx proof was provided. Re-run from the Resolving state or pass --approval-tx-signature and --approval-tx-slot."
    );
  }

  const ikaClient = createIkaClient(ikaGrpcUrl);
  try {
    if (
      !onchainApproval ||
      onchainApproval.status !== MESSAGE_APPROVAL_STATUS_SIGNED
    ) {
      const presignId = await ikaClient.requestPresignForDWallet({
        payer,
        dwalletAddress: approvalUserPubkey,
      });
      console.log(`Presign ID: 0x${presignId.toString("hex")}`);

      const grpcSignature = await ikaClient.requestBitcoinSign({
        payer,
        dwalletAddress: approvalUserPubkey,
        message: artifacts.preimage,
        presignId,
        approvalTxSignature: approvalSignature!,
        approvalTxSlot: approvalSlot!,
      });
      console.log(`Ika signature: 0x${grpcSignature.toString("hex")}`);
    }
  } finally {
    ikaClient.close();
  }

  onchainApproval = await waitForMessageApprovalSigned(
    connection,
    messageApproval,
    timeoutMs,
    pollIntervalMs
  );

  const signed = buildSignedBitcoinTransaction(
    artifacts,
    onchainApproval.signature,
    dwalletState.publicKey
  );

  console.log(`Position: ${position.toBase58()}`);
  console.log(`Auction status: ${auctionStatusLabel(positionState.status)}`);
  if (positionState.status === AUCTION_STATUS.Resolving) {
    console.log(`Winner index: ${winnerIndex}`);
  }
  console.log(`Winning bid amount: ${winningBidAmount}`);
  console.log(`Winner bid: ${winnerBidPubkey.toBase58()}`);
  console.log(`Winner BTC address: ${winnerBid.bidderBtcAddress}`);
  console.log(
    `Approval hash (keccak preimage): 0x${artifacts.approvalMessageHash.toString(
      "hex"
    )}`
  );
  console.log(
    `Signing digest (sha256d preimage): 0x${artifacts.signingDigest.toString(
      "hex"
    )}`
  );
  console.log(`MessageApproval: ${messageApproval.toBase58()}`);
  console.log(`Raw tx hex: ${signed.rawTxHex}`);
  console.log(`Local txid: ${signed.txid}`);

  if (args.broadcastUrl) {
    const txid = await broadcastViaEsplora(signed.rawTxHex, args.broadcastUrl);
    const explorerUrl = deriveExplorerUrl(args.broadcastUrl, txid);
    console.log(`Broadcast txid: ${txid}`);
    if (explorerUrl) {
      console.log(`Explorer: ${explorerUrl}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
