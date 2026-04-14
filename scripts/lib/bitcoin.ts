import { createHash } from "crypto";

import * as ecc from "@bitcoinerlab/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  address as bitcoinAddress,
  initEccLib,
  networks,
  payments,
} from "bitcoinjs-lib";

initEccLib(ecc);

export const DEFAULT_BITCOIN_SEQUENCE = 0xffff_fffd;
export const DEFAULT_BITCOIN_LOCK_TIME = 0;
export const DEFAULT_BITCOIN_FEE_SATS = 10_000n;
export const DEFAULT_BITCOIN_BROADCAST_URL =
  "https://blockstream.info/testnet/api";

const DEFAULT_TX_VERSION = 2;
const SIGHASH_ALL = 0x01;

export interface BitcoinLiquidationPlan {
  prevTxidHex: string;
  prevVout: number;
  prevAmountSats: bigint;
  senderCompressedPubkey: Buffer;
  recipientAddress: string;
  sendAmountSats: bigint;
  sequence?: number;
  lockTime?: number;
  network?: "testnet" | "bitcoin";
}

export interface BitcoinLiquidationArtifacts {
  senderPubkeyHash: Buffer;
  recipientPubkeyHash: Buffer;
  preimage: Buffer;
  approvalMessageHash: Buffer;
  signingDigest: Buffer;
  sendAmountSats: bigint;
  sequence: number;
  lockTime: number;
  prevTxidBytes: Buffer;
  prevVout: number;
}

export interface SignedBitcoinTransaction {
  rawTx: Buffer;
  rawTxHex: string;
  txid: string;
}

function normalizeNetwork(network: "testnet" | "bitcoin" = "testnet") {
  return network === "bitcoin" ? networks.bitcoin : networks.testnet;
}

function bigintToU64LE(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function u32ToLE(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0, 0);
  return out;
}

function writeVarint(out: Buffer[], value: number) {
  if (value < 0xfd) {
    out.push(Buffer.from([value]));
    return;
  }
  if (value <= 0xffff) {
    const encoded = Buffer.alloc(3);
    encoded[0] = 0xfd;
    encoded.writeUInt16LE(value, 1);
    out.push(encoded);
    return;
  }
  if (value <= 0xffff_ffff) {
    const encoded = Buffer.alloc(5);
    encoded[0] = 0xfe;
    encoded.writeUInt32LE(value, 1);
    out.push(encoded);
    return;
  }
  const encoded = Buffer.alloc(9);
  encoded[0] = 0xff;
  encoded.writeBigUInt64LE(BigInt(value), 1);
  out.push(encoded);
}

export function txidHexToWireBytes(txidHex: string): Buffer {
  const normalized = txidHex.startsWith("0x") ? txidHex.slice(2) : txidHex;
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error(`Invalid bitcoin txid hex: ${txidHex}`);
  }
  return Buffer.from(normalized, "hex").reverse();
}

export function txidFromRawTransaction(rawTx: Buffer): string {
  return Buffer.from(sha256d(rawTx)).reverse().toString("hex");
}

export function sha256d(data: Buffer | Uint8Array): Buffer {
  const first = createHash("sha256").update(data).digest();
  return createHash("sha256").update(first).digest();
}

export function keccak256(data: Buffer | Uint8Array): Buffer {
  return Buffer.from(keccak_256.create().update(data).digest());
}

export function recipientAddressToPubkeyHash(
  address: string,
  network: "testnet" | "bitcoin" = "testnet"
): Buffer {
  const decoded = bitcoinAddress.fromBech32(address);
  const expectedPrefix = network === "bitcoin" ? "bc" : "tb";
  if (decoded.prefix !== expectedPrefix) {
    throw new Error(
      `Recipient address network mismatch: expected ${expectedPrefix}1..., got ${address}`
    );
  }
  if (decoded.version !== 0 || decoded.data.length !== 20) {
    throw new Error("Recipient address must be a P2WPKH bech32 address");
  }
  return Buffer.from(decoded.data);
}

export function senderPubkeyToPubkeyHash(
  compressedPubkey: Buffer,
  network: "testnet" | "bitcoin" = "testnet"
): Buffer {
  const payment = payments.p2wpkh({
    network: normalizeNetwork(network),
    pubkey: compressedPubkey,
  });
  if (!payment.hash) {
    throw new Error(
      "Failed to derive sender P2WPKH witness program from dWallet pubkey"
    );
  }
  return Buffer.from(payment.hash);
}

export function buildBitcoinLiquidationArtifacts(
  plan: BitcoinLiquidationPlan
): BitcoinLiquidationArtifacts {
  const sequence = plan.sequence ?? DEFAULT_BITCOIN_SEQUENCE;
  const lockTime = plan.lockTime ?? DEFAULT_BITCOIN_LOCK_TIME;
  const network = plan.network ?? "testnet";
  const prevTxidBytes = txidHexToWireBytes(plan.prevTxidHex);
  const senderPubkeyHash = senderPubkeyToPubkeyHash(
    plan.senderCompressedPubkey,
    network
  );
  const recipientPubkeyHash = recipientAddressToPubkeyHash(
    plan.recipientAddress,
    network
  );

  const outpoint = Buffer.concat([prevTxidBytes, u32ToLE(plan.prevVout)]);
  const hashPrevouts = sha256d(outpoint);
  const hashSequence = sha256d(u32ToLE(sequence));

  const output = Buffer.concat([
    bigintToU64LE(plan.sendAmountSats),
    Buffer.from([22, 0x00, 0x14]),
    recipientPubkeyHash,
  ]);
  const hashOutputs = sha256d(output);

  const scriptCode = Buffer.concat([
    Buffer.from([0x19, 0x76, 0xa9, 0x14]),
    senderPubkeyHash,
    Buffer.from([0x88, 0xac]),
  ]);

  const preimage = Buffer.concat([
    u32ToLE(DEFAULT_TX_VERSION),
    hashPrevouts,
    hashSequence,
    outpoint,
    scriptCode,
    bigintToU64LE(plan.prevAmountSats),
    u32ToLE(sequence),
    hashOutputs,
    u32ToLE(lockTime),
    u32ToLE(SIGHASH_ALL),
  ]);

  return {
    senderPubkeyHash,
    recipientPubkeyHash,
    preimage,
    approvalMessageHash: keccak256(preimage),
    signingDigest: sha256d(preimage),
    sendAmountSats: plan.sendAmountSats,
    sequence,
    lockTime,
    prevTxidBytes,
    prevVout: plan.prevVout,
  };
}

function normalizeCompactSignature(signature: Buffer): Buffer {
  const normalizer = (
    ecc as unknown as {
      signatureNormalize?: (input: Uint8Array) => Uint8Array;
    }
  ).signatureNormalize;

  if (!normalizer) {
    return signature;
  }
  return Buffer.from(normalizer(signature));
}

export function encodeDerSignature(compactSignature: Buffer): Buffer {
  if (compactSignature.length !== 64) {
    throw new Error(
      `Expected a 64-byte compact secp256k1 signature, got ${compactSignature.length}`
    );
  }

  const normalized = normalizeCompactSignature(compactSignature);
  const exporter = (
    ecc as unknown as {
      signatureExport: (input: Uint8Array) => Uint8Array;
    }
  ).signatureExport;

  return Buffer.from(exporter(normalized));
}

export function buildSignedBitcoinTransaction(
  artifacts: BitcoinLiquidationArtifacts,
  compactSignature: Buffer,
  senderCompressedPubkey: Buffer
): SignedBitcoinTransaction {
  const witnessSignature = Buffer.concat([
    encodeDerSignature(compactSignature),
    Buffer.from([SIGHASH_ALL]),
  ]);
  const chunks: Buffer[] = [];

  chunks.push(u32ToLE(DEFAULT_TX_VERSION));
  chunks.push(Buffer.from([0x00, 0x01]));

  writeVarint(chunks, 1);
  chunks.push(artifacts.prevTxidBytes);
  chunks.push(u32ToLE(artifacts.prevVout));
  writeVarint(chunks, 0);
  chunks.push(u32ToLE(artifacts.sequence));

  writeVarint(chunks, 1);
  chunks.push(bigintToU64LE(artifacts.sendAmountSats));
  writeVarint(chunks, 22);
  chunks.push(Buffer.from([0x00, 0x14]));
  chunks.push(artifacts.recipientPubkeyHash);

  writeVarint(chunks, 2);
  writeVarint(chunks, witnessSignature.length);
  chunks.push(witnessSignature);
  writeVarint(chunks, senderCompressedPubkey.length);
  chunks.push(senderCompressedPubkey);

  chunks.push(u32ToLE(artifacts.lockTime));

  const rawTx = Buffer.concat(chunks);
  return {
    rawTx,
    rawTxHex: rawTx.toString("hex"),
    txid: txidFromRawTransaction(rawTx),
  };
}

export async function broadcastViaEsplora(
  rawTxHex: string,
  rpcBase: string = DEFAULT_BITCOIN_BROADCAST_URL
): Promise<string> {
  const endpoint = `${rpcBase.replace(/\/+$/, "")}/tx`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
    },
    body: rawTxHex,
  });

  const text = (await response.text()).trim();
  if (!response.ok) {
    throw new Error(`Esplora broadcast failed (${response.status}): ${text}`);
  }

  if (text.startsWith("{")) {
    const parsed = JSON.parse(text) as { txid?: string };
    if (!parsed.txid) {
      throw new Error(`Unexpected Esplora JSON response: ${text}`);
    }
    return parsed.txid;
  }

  return text;
}

export function deriveExplorerUrl(
  rpcBase: string,
  txid: string
): string | null {
  if (rpcBase.includes("blockstream.info/testnet")) {
    return `https://blockstream.info/testnet/tx/${txid}`;
  }
  if (rpcBase.includes("blockstream.info")) {
    return `https://blockstream.info/tx/${txid}`;
  }
  if (rpcBase.includes("mempool.space/testnet")) {
    return `https://mempool.space/testnet/tx/${txid}`;
  }
  if (rpcBase.includes("mempool.space")) {
    return `https://mempool.space/tx/${txid}`;
  }
  return null;
}
