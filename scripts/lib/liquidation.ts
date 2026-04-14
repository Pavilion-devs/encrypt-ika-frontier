import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

export const LIQUIDATION_PROGRAM_ID = new PublicKey(
  "9tzQ4FnSYVuqFA3EeYzKVPAZBtGq266TvuFR6H22rm59"
);
export const ENCRYPT_PROGRAM_ID = new PublicKey(
  "4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8"
);
export const IKA_PROGRAM_ID = new PublicKey(
  "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY"
);
export const DEFAULT_SOLANA_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_WALLET_PATH = "~/.config/solana/id.json";
export const DEFAULT_NETWORK_KEY = Buffer.alloc(32, 0x55);
export const FHE_UINT64 = 4;
export const DEPOSIT_IX_DISCRIMINATOR = 14;
export const AUCTION_STATUS = {
  Active: 0,
  AuctionOpen: 1,
  Resolving: 2,
  Resolved: 3,
} as const;

const BID_SEED = "bid";
const ENCRYPT_CONFIG_SEED = "encrypt_config";
const ENCRYPT_DEPOSIT_SEED = "encrypt_deposit";
const ENCRYPT_CPI_AUTHORITY_SEED = "__encrypt_cpi_authority";
const ENCRYPT_EVENT_AUTHORITY_SEED = "__event_authority";
const NETWORK_ENCRYPTION_KEY_SEED = "network_encryption_key";
const IKA_CPI_AUTHORITY_SEED = "__ika_cpi_authority";
const MESSAGE_APPROVAL_SEED = "message_approval";
const ENCRYPT_DR_CIPHERTEXT_DIGEST_OFFSET = 34;
const ENCRYPT_DR_TOTAL_LEN_OFFSET = 99;
const ENCRYPT_DR_BYTES_WRITTEN_OFFSET = 103;
const ENCRYPT_DR_HEADER_END = 107;

export interface EncryptAccounts {
  encryptProgram: PublicKey;
  configPda: PublicKey;
  depositPda: PublicKey;
  cpiAuthority: PublicKey;
  eventAuthority: PublicKey;
  networkKeyPda: PublicKey;
  networkKey: Buffer;
}

export interface BidSubmissionResult {
  signature: string;
  bidPda: PublicKey;
}

export interface ResolveAuctionResult {
  signature: string;
  resultCiphertext: PublicKey;
  priceCiphertext: PublicKey;
}

export interface ResolutionDecryptionRequestResult {
  signature: string;
  resultRequest: PublicKey;
  priceRequest: PublicKey;
}

export interface FinalizeAuctionResult {
  signature: string;
  messageApproval: PublicKey;
}

export interface DecodedBidAccount {
  position: PublicKey;
  bidder: PublicKey;
  bidderBtcAddress: string;
  ciphertextAccount: PublicKey;
  submittedAt: bigint;
  bump: number;
}

export interface DecodedPositionAccount {
  borrower: PublicKey;
  debtAmount: bigint;
  collateralBtc: bigint;
  dwalletId: PublicKey;
  dwalletBtcAddress: string;
  healthThreshold: bigint;
  lastHealthFactor: bigint;
  status: number;
  auctionDeadline: bigint;
  bidCount: number;
  resolvedWinner: PublicKey;
  resolvedBid: PublicKey;
  resolutionResultCiphertext: PublicKey;
  resolutionPriceCiphertext: PublicKey;
  resolutionBid0: PublicKey;
  resolutionBid1: PublicKey;
  resolutionBid2: PublicKey;
  resolutionResultRequest: PublicKey;
  resolutionPriceRequest: PublicKey;
  resolutionResultDigest: Buffer;
  resolutionPriceDigest: Buffer;
  winningCiphertext: PublicKey;
  clearingPrice: bigint;
  approvedBtcTxHash: Buffer;
  resolveGraph: Buffer;
  bump: number;
}

export interface ResolutionDecryptionValues {
  position: DecodedPositionAccount;
  winnerIndex: bigint;
  winningBidAmount: bigint;
}

class AnchorAccountReader {
  private offset = 8;

  constructor(private readonly data: Buffer) {}

  readPubkey(): PublicKey {
    const value = new PublicKey(
      this.data.subarray(this.offset, this.offset + 32)
    );
    this.offset += 32;
    return value;
  }

  readU64(): bigint {
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readI64(): bigint {
    const value = this.data.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readU8(): number {
    const value = this.data.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readFixedBytes(length: number): Buffer {
    const value = Buffer.from(
      this.data.subarray(this.offset, this.offset + length)
    );
    this.offset += length;
    return value;
  }

  readString(): string {
    const length = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    const value = this.data
      .subarray(this.offset, this.offset + length)
      .toString("utf8");
    this.offset += length;
    return value;
  }

  readVecU8(): Buffer {
    const length = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    const value = Buffer.from(
      this.data.subarray(this.offset, this.offset + length)
    );
    this.offset += length;
    return value;
  }
}

export function expandHomePath(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export function loadKeypair(filePath: string = DEFAULT_WALLET_PATH): Keypair {
  const absolutePath = expandHomePath(filePath);
  const secretKey = JSON.parse(
    fs.readFileSync(absolutePath, "utf8")
  ) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

export function parsePublicKey(value: string, label: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function parse32ByteValue(value: string, label: string): Buffer {
  const normalized = value.startsWith("0x") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  try {
    return new PublicKey(value).toBuffer();
  } catch {
    throw new Error(
      `Invalid ${label}: expected 32-byte hex or base58 public key`
    );
  }
}

export function pda(
  seeds: (Buffer | Uint8Array)[],
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function findBidPda(
  position: PublicKey,
  bidder: PublicKey,
  programId: PublicKey = LIQUIDATION_PROGRAM_ID
): [PublicKey, number] {
  return pda(
    [Buffer.from(BID_SEED), position.toBuffer(), bidder.toBuffer()],
    programId
  );
}

export function findEncryptAccounts(
  payer: PublicKey,
  liquidationProgramId: PublicKey = LIQUIDATION_PROGRAM_ID,
  encryptProgramId: PublicKey = ENCRYPT_PROGRAM_ID,
  networkKey: Buffer = DEFAULT_NETWORK_KEY
): EncryptAccounts {
  const [configPda] = pda([Buffer.from(ENCRYPT_CONFIG_SEED)], encryptProgramId);
  const [depositPda] = pda(
    [Buffer.from(ENCRYPT_DEPOSIT_SEED), payer.toBuffer()],
    encryptProgramId
  );
  const [cpiAuthority] = pda(
    [Buffer.from(ENCRYPT_CPI_AUTHORITY_SEED)],
    liquidationProgramId
  );
  const [eventAuthority] = pda(
    [Buffer.from(ENCRYPT_EVENT_AUTHORITY_SEED)],
    encryptProgramId
  );
  const [networkKeyPda] = pda(
    [Buffer.from(NETWORK_ENCRYPTION_KEY_SEED), networkKey],
    encryptProgramId
  );

  return {
    encryptProgram: encryptProgramId,
    configPda,
    depositPda,
    cpiAuthority,
    eventAuthority,
    networkKeyPda,
    networkKey,
  };
}

export function findIkaCpiAuthority(
  liquidationProgramId: PublicKey = LIQUIDATION_PROGRAM_ID
): [PublicKey, number] {
  return pda([Buffer.from(IKA_CPI_AUTHORITY_SEED)], liquidationProgramId);
}

export function findMessageApprovalPda(
  dwallet: PublicKey,
  btcTxHash: Buffer,
  dwalletProgramId: PublicKey = IKA_PROGRAM_ID
): [PublicKey, number] {
  return pda(
    [Buffer.from(MESSAGE_APPROVAL_SEED), dwallet.toBuffer(), btcTxHash],
    dwalletProgramId
  );
}

export async function ensureEncryptDeposit(
  connection: Connection,
  payer: Keypair,
  encryptAccounts: EncryptAccounts
): Promise<void> {
  const existingDeposit = await connection.getAccountInfo(
    encryptAccounts.depositPda
  );
  if (existingDeposit) {
    return;
  }

  const configInfo = await connection.getAccountInfo(encryptAccounts.configPda);
  if (!configInfo) {
    throw new Error(
      `Encrypt config ${encryptAccounts.configPda.toBase58()} is missing. Is the pre-alpha executor live on this cluster?`
    );
  }

  const encVault = new PublicKey(
    (configInfo.data as Buffer).subarray(100, 132)
  );
  const vaultPubkey = encVault.equals(SystemProgram.programId)
    ? payer.publicKey
    : encVault;
  const [, depositBump] = pda(
    [Buffer.from(ENCRYPT_DEPOSIT_SEED), payer.publicKey.toBuffer()],
    encryptAccounts.encryptProgram
  );

  const data = Buffer.alloc(18);
  data[0] = DEPOSIT_IX_DISCRIMINATOR;
  data[1] = depositBump;

  const instruction = new TransactionInstruction({
    programId: encryptAccounts.encryptProgram,
    data,
    keys: [
      { pubkey: encryptAccounts.depositPda, isSigner: false, isWritable: true },
      { pubkey: encryptAccounts.configPda, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      {
        pubkey: vaultPubkey,
        isSigner: vaultPubkey.equals(payer.publicKey),
        isWritable: true,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });

  await sendInstructions(connection, payer, [instruction]);
}

export async function sendInstructions(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[] = []
): Promise<string> {
  const transaction = new Transaction().add(...instructions);
  return sendAndConfirmTransaction(
    connection,
    transaction,
    [payer, ...signers],
    {
      commitment: "confirmed",
    }
  );
}

export function anchorDiscriminator(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .subarray(0, 8);
}

export function encodePublicKey(pubkey: PublicKey): Buffer {
  return pubkey.toBuffer();
}

export function encodeString(value: string): Buffer {
  const utf8 = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(utf8.length, 0);
  return Buffer.concat([length, utf8]);
}

export function encodeVecU8(bytes: Buffer | Uint8Array): Buffer {
  const payload = Buffer.from(bytes);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(payload.length, 0);
  return Buffer.concat([length, payload]);
}

export function auctionStatusLabel(status: number): string {
  switch (status) {
    case AUCTION_STATUS.Active:
      return "Active";
    case AUCTION_STATUS.AuctionOpen:
      return "AuctionOpen";
    case AUCTION_STATUS.Resolving:
      return "Resolving";
    case AUCTION_STATUS.Resolved:
      return "Resolved";
    default:
      return `Unknown(${status})`;
  }
}

export async function fetchAccount(
  connection: Connection,
  pubkey: PublicKey,
  label: string
): Promise<Buffer> {
  const info = await connection.getAccountInfo(pubkey);
  if (!info) {
    throw new Error(`${label} ${pubkey.toBase58()} does not exist`);
  }
  return Buffer.from(info.data);
}

export function decodeBidAccount(data: Buffer): DecodedBidAccount {
  const reader = new AnchorAccountReader(data);
  return {
    position: reader.readPubkey(),
    bidder: reader.readPubkey(),
    bidderBtcAddress: reader.readString(),
    ciphertextAccount: reader.readPubkey(),
    submittedAt: reader.readI64(),
    bump: reader.readU8(),
  };
}

export function decodePositionAccount(data: Buffer): DecodedPositionAccount {
  const reader = new AnchorAccountReader(data);
  return {
    borrower: reader.readPubkey(),
    debtAmount: reader.readU64(),
    collateralBtc: reader.readU64(),
    dwalletId: reader.readPubkey(),
    dwalletBtcAddress: reader.readString(),
    healthThreshold: reader.readU64(),
    lastHealthFactor: reader.readU64(),
    status: reader.readU8(),
    auctionDeadline: reader.readI64(),
    bidCount: reader.readU8(),
    resolvedWinner: reader.readPubkey(),
    resolvedBid: reader.readPubkey(),
    resolutionResultCiphertext: reader.readPubkey(),
    resolutionPriceCiphertext: reader.readPubkey(),
    resolutionBid0: reader.readPubkey(),
    resolutionBid1: reader.readPubkey(),
    resolutionBid2: reader.readPubkey(),
    resolutionResultRequest: reader.readPubkey(),
    resolutionPriceRequest: reader.readPubkey(),
    resolutionResultDigest: reader.readFixedBytes(32),
    resolutionPriceDigest: reader.readFixedBytes(32),
    winningCiphertext: reader.readPubkey(),
    clearingPrice: reader.readU64(),
    approvedBtcTxHash: reader.readFixedBytes(32),
    resolveGraph: reader.readVecU8(),
    bump: reader.readU8(),
  };
}

export async function fetchDecodedBidAccount(
  connection: Connection,
  bidPubkey: PublicKey
): Promise<DecodedBidAccount> {
  return decodeBidAccount(
    await fetchAccount(connection, bidPubkey, "bid account")
  );
}

export async function fetchDecodedPositionAccount(
  connection: Connection,
  positionPubkey: PublicKey
): Promise<DecodedPositionAccount> {
  return decodePositionAccount(
    await fetchAccount(connection, positionPubkey, "position account")
  );
}

export function decodeResolutionRequestValue(
  requestData: Buffer,
  expectedDigest: Buffer
): bigint | null {
  if (
    requestData.length < ENCRYPT_DR_HEADER_END + 8 ||
    expectedDigest.length !== 32
  ) {
    return null;
  }

  const actualDigest = requestData.subarray(
    ENCRYPT_DR_CIPHERTEXT_DIGEST_OFFSET,
    ENCRYPT_DR_CIPHERTEXT_DIGEST_OFFSET + 32
  );
  if (!actualDigest.equals(expectedDigest)) {
    return null;
  }

  const totalLen = requestData.readUInt32LE(ENCRYPT_DR_TOTAL_LEN_OFFSET);
  const bytesWritten = requestData.readUInt32LE(
    ENCRYPT_DR_BYTES_WRITTEN_OFFSET
  );
  if (totalLen !== 8 || bytesWritten !== totalLen) {
    return null;
  }

  return requestData.readBigUInt64LE(ENCRYPT_DR_HEADER_END);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForResolutionDecryption(
  connection: Connection,
  positionPubkey: PublicKey,
  timeoutMs = 60_000,
  intervalMs = 2_000
): Promise<ResolutionDecryptionValues> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const position = await fetchDecodedPositionAccount(
      connection,
      positionPubkey
    );
    if (
      !position.resolutionResultRequest.equals(PublicKey.default) &&
      !position.resolutionPriceRequest.equals(PublicKey.default)
    ) {
      try {
        const [winnerRequest, priceRequest] = await Promise.all([
          fetchAccount(
            connection,
            position.resolutionResultRequest,
            "winner request"
          ),
          fetchAccount(
            connection,
            position.resolutionPriceRequest,
            "price request"
          ),
        ]);
        const winnerIndex = decodeResolutionRequestValue(
          winnerRequest,
          position.resolutionResultDigest
        );
        const winningBidAmount = decodeResolutionRequestValue(
          priceRequest,
          position.resolutionPriceDigest
        );

        if (winnerIndex !== null && winningBidAmount !== null) {
          return {
            position,
            winnerIndex,
            winningBidAmount,
          };
        }
      } catch {
        // Retry until the Encrypt executor has committed both decryption results.
      }
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for resolution decryption on ${positionPubkey.toBase58()}`
  );
}

export function buildSubmitBidInstruction(params: {
  programId?: PublicKey;
  position: PublicKey;
  bid: PublicKey;
  bidder: PublicKey;
  payer: PublicKey;
  ciphertextAccount: PublicKey;
  bidderBtcAddress: string;
}): TransactionInstruction {
  const programId = params.programId ?? LIQUIDATION_PROGRAM_ID;
  const data = Buffer.concat([
    anchorDiscriminator("submit_bid"),
    encodePublicKey(params.ciphertextAccount),
    encodeString(params.bidderBtcAddress),
  ]);

  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.position, isSigner: false, isWritable: true },
      { pubkey: params.bid, isSigner: false, isWritable: true },
      { pubkey: params.bidder, isSigner: true, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export function buildResolveAuctionInstruction(params: {
  programId?: PublicKey;
  position: PublicKey;
  payer: PublicKey;
  encryptAccounts: EncryptAccounts;
  bidAccounts: [PublicKey, PublicKey, PublicKey];
  bidCiphertexts: [PublicKey, PublicKey, PublicKey];
  resultCiphertext: PublicKey;
  priceCiphertext: PublicKey;
  graphData?: Buffer;
}): TransactionInstruction {
  const programId = params.programId ?? LIQUIDATION_PROGRAM_ID;
  const graphData = params.graphData ?? Buffer.alloc(0);
  const data = Buffer.concat([
    anchorDiscriminator("resolve_auction"),
    encodeVecU8(graphData),
  ]);

  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.position, isSigner: false, isWritable: true },
      { pubkey: params.bidAccounts[0], isSigner: false, isWritable: false },
      { pubkey: params.bidAccounts[1], isSigner: false, isWritable: false },
      { pubkey: params.bidAccounts[2], isSigner: false, isWritable: false },
      { pubkey: params.bidCiphertexts[0], isSigner: false, isWritable: true },
      { pubkey: params.bidCiphertexts[1], isSigner: false, isWritable: true },
      { pubkey: params.bidCiphertexts[2], isSigner: false, isWritable: true },
      { pubkey: params.resultCiphertext, isSigner: true, isWritable: true },
      { pubkey: params.priceCiphertext, isSigner: true, isWritable: true },
      {
        pubkey: params.encryptAccounts.encryptProgram,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: params.encryptAccounts.configPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: params.encryptAccounts.depositPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: params.encryptAccounts.cpiAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: programId, isSigner: false, isWritable: false },
      {
        pubkey: params.encryptAccounts.networkKeyPda,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      {
        pubkey: params.encryptAccounts.eventAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export function buildRequestResolutionDecryptionInstruction(params: {
  programId?: PublicKey;
  position: PublicKey;
  payer: PublicKey;
  encryptAccounts: EncryptAccounts;
  resultRequest: PublicKey;
  priceRequest: PublicKey;
  resultCiphertext: PublicKey;
  priceCiphertext: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? LIQUIDATION_PROGRAM_ID;
  const data = anchorDiscriminator("request_resolution_decryption");

  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.position, isSigner: false, isWritable: true },
      { pubkey: params.resultRequest, isSigner: true, isWritable: true },
      { pubkey: params.priceRequest, isSigner: true, isWritable: true },
      { pubkey: params.resultCiphertext, isSigner: false, isWritable: false },
      { pubkey: params.priceCiphertext, isSigner: false, isWritable: false },
      {
        pubkey: params.encryptAccounts.encryptProgram,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: params.encryptAccounts.configPda,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: params.encryptAccounts.depositPda,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: params.encryptAccounts.cpiAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: programId, isSigner: false, isWritable: false },
      {
        pubkey: params.encryptAccounts.networkKeyPda,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      {
        pubkey: params.encryptAccounts.eventAuthority,
        isSigner: false,
        isWritable: false,
      },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export function buildFinalizeInstruction(params: {
  programId?: PublicKey;
  position: PublicKey;
  bidAccounts: [PublicKey, PublicKey, PublicKey];
  resultRequest: PublicKey;
  priceRequest: PublicKey;
  messageApproval: PublicKey;
  dwallet: PublicKey;
  payer: PublicKey;
  btcTxHash: Buffer;
  approvalUserPubkey: Buffer;
  dwalletProgramId?: PublicKey;
}): TransactionInstruction {
  const programId = params.programId ?? LIQUIDATION_PROGRAM_ID;
  const dwalletProgramId = params.dwalletProgramId ?? IKA_PROGRAM_ID;
  const [cpiAuthority] = findIkaCpiAuthority(programId);
  const data = Buffer.concat([
    anchorDiscriminator("finalize"),
    Buffer.from(params.btcTxHash),
    Buffer.from(params.approvalUserPubkey),
  ]);

  return new TransactionInstruction({
    programId,
    data,
    keys: [
      { pubkey: params.position, isSigner: false, isWritable: true },
      { pubkey: params.bidAccounts[0], isSigner: false, isWritable: false },
      { pubkey: params.bidAccounts[1], isSigner: false, isWritable: false },
      { pubkey: params.bidAccounts[2], isSigner: false, isWritable: false },
      { pubkey: params.resultRequest, isSigner: false, isWritable: false },
      { pubkey: params.priceRequest, isSigner: false, isWritable: false },
      { pubkey: params.messageApproval, isSigner: false, isWritable: true },
      { pubkey: params.dwallet, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
      { pubkey: cpiAuthority, isSigner: false, isWritable: false },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: dwalletProgramId, isSigner: false, isWritable: false },
    ],
  });
}

export async function submitEncryptedBid(params: {
  connection: Connection;
  payer: Keypair;
  bidder?: Keypair;
  position: PublicKey;
  ciphertextAccount: PublicKey;
  bidderBtcAddress: string;
  programId?: PublicKey;
}): Promise<BidSubmissionResult> {
  const bidder = params.bidder ?? params.payer;
  const programId = params.programId ?? LIQUIDATION_PROGRAM_ID;
  const [bidPda] = findBidPda(params.position, bidder.publicKey, programId);

  const instruction = buildSubmitBidInstruction({
    programId,
    position: params.position,
    bid: bidPda,
    bidder: bidder.publicKey,
    payer: params.payer.publicKey,
    ciphertextAccount: params.ciphertextAccount,
    bidderBtcAddress: params.bidderBtcAddress,
  });

  const signature = await sendInstructions(
    params.connection,
    params.payer,
    [instruction],
    bidder.publicKey.equals(params.payer.publicKey) ? [] : [bidder]
  );

  return { signature, bidPda };
}

export async function resolveAuction(params: {
  connection: Connection;
  payer: Keypair;
  position: PublicKey;
  bidAccounts: [PublicKey, PublicKey, PublicKey];
  graphData?: Buffer;
  programId?: PublicKey;
  encryptProgramId?: PublicKey;
}): Promise<ResolveAuctionResult> {
  const encryptAccounts = findEncryptAccounts(
    params.payer.publicKey,
    params.programId ?? LIQUIDATION_PROGRAM_ID,
    params.encryptProgramId ?? ENCRYPT_PROGRAM_ID
  );
  await ensureEncryptDeposit(params.connection, params.payer, encryptAccounts);

  const decodedBids = await Promise.all(
    params.bidAccounts.map((bid) =>
      fetchDecodedBidAccount(params.connection, bid)
    )
  );
  const resultCiphertext = Keypair.generate();
  const priceCiphertext = Keypair.generate();
  const instruction = buildResolveAuctionInstruction({
    programId: params.programId,
    position: params.position,
    payer: params.payer.publicKey,
    encryptAccounts,
    bidAccounts: params.bidAccounts,
    bidCiphertexts: [
      decodedBids[0].ciphertextAccount,
      decodedBids[1].ciphertextAccount,
      decodedBids[2].ciphertextAccount,
    ],
    resultCiphertext: resultCiphertext.publicKey,
    priceCiphertext: priceCiphertext.publicKey,
    graphData: params.graphData,
  });

  const signature = await sendInstructions(
    params.connection,
    params.payer,
    [instruction],
    [resultCiphertext, priceCiphertext]
  );

  return {
    signature,
    resultCiphertext: resultCiphertext.publicKey,
    priceCiphertext: priceCiphertext.publicKey,
  };
}

export async function requestResolutionDecryption(params: {
  connection: Connection;
  payer: Keypair;
  position: PublicKey;
  programId?: PublicKey;
  encryptProgramId?: PublicKey;
}): Promise<ResolutionDecryptionRequestResult> {
  const encryptAccounts = findEncryptAccounts(
    params.payer.publicKey,
    params.programId ?? LIQUIDATION_PROGRAM_ID,
    params.encryptProgramId ?? ENCRYPT_PROGRAM_ID
  );
  await ensureEncryptDeposit(params.connection, params.payer, encryptAccounts);

  const positionState = await fetchDecodedPositionAccount(
    params.connection,
    params.position
  );
  const resultRequest = Keypair.generate();
  const priceRequest = Keypair.generate();
  const instruction = buildRequestResolutionDecryptionInstruction({
    programId: params.programId,
    position: params.position,
    payer: params.payer.publicKey,
    encryptAccounts,
    resultRequest: resultRequest.publicKey,
    priceRequest: priceRequest.publicKey,
    resultCiphertext: positionState.resolutionResultCiphertext,
    priceCiphertext: positionState.resolutionPriceCiphertext,
  });

  const signature = await sendInstructions(
    params.connection,
    params.payer,
    [instruction],
    [resultRequest, priceRequest]
  );

  return {
    signature,
    resultRequest: resultRequest.publicKey,
    priceRequest: priceRequest.publicKey,
  };
}

export async function finalizeAuction(params: {
  connection: Connection;
  payer: Keypair;
  position: PublicKey;
  bidAccounts: [PublicKey, PublicKey, PublicKey];
  dwallet: PublicKey;
  btcTxHash: Buffer;
  approvalUserPubkey: Buffer;
  programId?: PublicKey;
  dwalletProgramId?: PublicKey;
}): Promise<FinalizeAuctionResult> {
  const positionState = await fetchDecodedPositionAccount(
    params.connection,
    params.position
  );
  const [messageApproval] = findMessageApprovalPda(
    params.dwallet,
    params.btcTxHash,
    params.dwalletProgramId ?? IKA_PROGRAM_ID
  );
  const instruction = buildFinalizeInstruction({
    programId: params.programId,
    position: params.position,
    bidAccounts: params.bidAccounts,
    resultRequest: positionState.resolutionResultRequest,
    priceRequest: positionState.resolutionPriceRequest,
    messageApproval,
    dwallet: params.dwallet,
    payer: params.payer.publicKey,
    btcTxHash: params.btcTxHash,
    approvalUserPubkey: params.approvalUserPubkey,
    dwalletProgramId: params.dwalletProgramId,
  });

  const signature = await sendInstructions(params.connection, params.payer, [
    instruction,
  ]);
  return { signature, messageApproval };
}
