import path from "path";

import { bcs } from "@mysten/bcs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export const DEFAULT_IKA_GRPC_URL = "pre-alpha-dev-1.ika.ika-network.net:443";

export const DWALLET_ACCOUNT_DISCRIMINATOR = 2;
export const MESSAGE_APPROVAL_ACCOUNT_DISCRIMINATOR = 14;
export const MESSAGE_APPROVAL_STATUS_PENDING = 0;
export const MESSAGE_APPROVAL_STATUS_SIGNED = 1;
export const MESSAGE_APPROVAL_SIGNATURE_SCHEME_SECP256K1 = 1;

const DWALLET_ACCOUNT_LEN = 102;
const MESSAGE_APPROVAL_ACCOUNT_LEN = 287;

const ChainId = bcs.enum("ChainId", {
  Solana: null,
  Sui: null,
});

const DWalletCurve = bcs.enum("DWalletCurve", {
  Secp256k1: null,
  Secp256r1: null,
  Curve25519: null,
  Ristretto: null,
});

const DWalletSignatureAlgorithm = bcs.enum("DWalletSignatureAlgorithm", {
  ECDSASecp256k1: null,
  ECDSASecp256r1: null,
  Taproot: null,
  EdDSA: null,
  SchnorrkelSubstrate: null,
});

const DWalletHashScheme = bcs.enum("DWalletHashScheme", {
  Keccak256: null,
  SHA256: null,
  DoubleSHA256: null,
  SHA512: null,
  Merlin: null,
});

const ApprovalProof = bcs.enum("ApprovalProof", {
  Solana: bcs.struct("ApprovalProofSolana", {
    transaction_signature: bcs.vector(bcs.u8()),
    slot: bcs.u64(),
  }),
  Sui: bcs.struct("ApprovalProofSui", {
    effects_certificate: bcs.vector(bcs.u8()),
  }),
});

const UserSignature = bcs.enum("UserSignature", {
  Ed25519: bcs.struct("UserSignatureEd25519", {
    signature: bcs.vector(bcs.u8()),
    public_key: bcs.vector(bcs.u8()),
  }),
  Secp256k1: bcs.struct("UserSignatureSecp256k1", {
    signature: bcs.vector(bcs.u8()),
    public_key: bcs.vector(bcs.u8()),
  }),
  Secp256r1: bcs.struct("UserSignatureSecp256r1", {
    signature: bcs.vector(bcs.u8()),
    public_key: bcs.vector(bcs.u8()),
  }),
});

const DWalletRequest = bcs.enum("DWalletRequest", {
  DKG: bcs.struct("DKG", {
    dwallet_network_encryption_public_key: bcs.vector(bcs.u8()),
    curve: DWalletCurve,
    centralized_public_key_share_and_proof: bcs.vector(bcs.u8()),
    encrypted_centralized_secret_share_and_proof: bcs.vector(bcs.u8()),
    encryption_key: bcs.vector(bcs.u8()),
    user_public_output: bcs.vector(bcs.u8()),
    signer_public_key: bcs.vector(bcs.u8()),
  }),
  DKGWithPublicShare: bcs.struct("DKGWithPublicShare", {
    dwallet_network_encryption_public_key: bcs.vector(bcs.u8()),
    curve: DWalletCurve,
    centralized_public_key_share_and_proof: bcs.vector(bcs.u8()),
    public_user_secret_key_share: bcs.vector(bcs.u8()),
    signer_public_key: bcs.vector(bcs.u8()),
  }),
  Sign: bcs.struct("Sign", {
    message: bcs.vector(bcs.u8()),
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
    hash_scheme: DWalletHashScheme,
    presign_id: bcs.vector(bcs.u8()),
    message_centralized_signature: bcs.vector(bcs.u8()),
    approval_proof: ApprovalProof,
  }),
  ImportedKeySign: bcs.struct("ImportedKeySign", {
    message: bcs.vector(bcs.u8()),
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
    hash_scheme: DWalletHashScheme,
    presign_id: bcs.vector(bcs.u8()),
    message_centralized_signature: bcs.vector(bcs.u8()),
    approval_proof: ApprovalProof,
  }),
  Presign: bcs.struct("Presign", {
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
  }),
  PresignForDWallet: bcs.struct("PresignForDWallet", {
    dwallet_id: bcs.vector(bcs.u8()),
    curve: DWalletCurve,
    signature_algorithm: DWalletSignatureAlgorithm,
  }),
  ImportedKeyVerification: null,
  ReEncryptShare: null,
  MakeSharePublic: null,
  FutureSign: null,
  SignWithPartialUserSig: null,
  ImportedKeySignWithPartialUserSig: null,
});

const SignedRequestData = bcs.struct("SignedRequestData", {
  session_identifier_preimage: bcs.fixedArray(32, bcs.u8()),
  epoch: bcs.u64(),
  chain_id: ChainId,
  intended_chain_sender: bcs.vector(bcs.u8()),
  request: DWalletRequest,
});

const TransactionResponseData = bcs.enum("TransactionResponseData", {
  Signature: bcs.struct("SignatureResponse", {
    signature: bcs.vector(bcs.u8()),
  }),
  Attestation: bcs.struct("AttestationResponse", {
    attestation_data: bcs.vector(bcs.u8()),
    network_signature: bcs.vector(bcs.u8()),
    network_pubkey: bcs.vector(bcs.u8()),
    epoch: bcs.u64(),
  }),
  Presign: bcs.struct("PresignResponse", {
    presign_id: bcs.vector(bcs.u8()),
    presign_data: bcs.vector(bcs.u8()),
    epoch: bcs.u64(),
  }),
  Error: bcs.struct("ErrorResponse", {
    message: bcs.string(),
  }),
});

type GrpcClient = {
  SubmitTransaction(
    request: Record<string, unknown>,
    callback: (
      error: grpc.ServiceError | null,
      response?: Record<string, unknown>
    ) => void
  ): void;
  close(): void;
};

export interface DecodedDWalletAccount {
  authority: PublicKey;
  publicKey: Buffer;
  curve: number;
  isImported: boolean;
}

export interface DecodedMessageApprovalAccount {
  dwallet: PublicKey;
  messageHash: Buffer;
  userPubkey: Buffer;
  signatureScheme: number;
  callerProgram: PublicKey;
  cpiAuthority: PublicKey;
  status: number;
  signature: Buffer;
}

export interface RequestPresignParams {
  payer: Keypair;
  dwalletAddress: Buffer | Uint8Array;
}

export interface RequestSignParams {
  payer: Keypair;
  dwalletAddress: Buffer | Uint8Array;
  message: Buffer | Uint8Array;
  presignId: Buffer | Uint8Array;
  approvalTxSignature: string | Buffer | Uint8Array;
  approvalTxSlot: bigint | number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadIkaService(): new (
  address: string,
  credentials: grpc.ChannelCredentials
) => GrpcClient {
  const protoPath = path.resolve(__dirname, "../../proto/ika_dwallet.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    ika: {
      dwallet: {
        v1: {
          DWalletService: new (
            address: string,
            credentials: grpc.ChannelCredentials
          ) => GrpcClient;
        };
      };
    };
  };

  return proto.ika.dwallet.v1.DWalletService;
}

function buildUserSignature(payer: Keypair): Uint8Array {
  return UserSignature.serialize({
    Ed25519: {
      signature: Array.from(new Uint8Array(64)),
      public_key: Array.from(payer.publicKey.toBytes()),
    },
  }).toBytes();
}

function normalizeDWalletAddress(bytes: Buffer | Uint8Array): Uint8Array {
  const value = Uint8Array.from(bytes);
  if (value.length !== 32) {
    throw new Error(`dWallet address must be 32 bytes, got ${value.length}`);
  }
  return value;
}

function decodeSolanaTxSignature(
  signature: string | Buffer | Uint8Array
): Uint8Array {
  if (typeof signature === "string") {
    return Uint8Array.from(bs58.decode(signature));
  }
  return Uint8Array.from(signature);
}

async function fetchAccountData(
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

function submitTransaction(
  client: GrpcClient,
  userSignature: Uint8Array,
  signedRequestData: Uint8Array
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    client.SubmitTransaction(
      {
        user_signature: Buffer.from(userSignature),
        signed_request_data: Buffer.from(signedRequestData),
      },
      (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(
          (response?.response_data as Uint8Array | undefined) ??
            new Uint8Array()
        );
      }
    );
  });
}

export function createIkaClient(grpcUrl: string = DEFAULT_IKA_GRPC_URL) {
  const DWalletService = loadIkaService();
  const isLocal =
    grpcUrl.startsWith("localhost") || grpcUrl.startsWith("127.0.0.1");
  const credentials = isLocal
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl();
  const client = new DWalletService(grpcUrl, credentials);

  return {
    async requestPresignForDWallet(
      params: RequestPresignParams
    ): Promise<Buffer> {
      const dwalletAddress = normalizeDWalletAddress(params.dwalletAddress);
      const requestData = SignedRequestData.serialize({
        session_identifier_preimage: Array.from(dwalletAddress),
        epoch: 1n,
        chain_id: { Solana: true },
        intended_chain_sender: Array.from(params.payer.publicKey.toBytes()),
        request: {
          PresignForDWallet: {
            dwallet_id: Array.from(dwalletAddress),
            curve: { Secp256k1: true },
            signature_algorithm: { ECDSASecp256k1: true },
          },
        },
      }).toBytes();

      const responseBytes = await submitTransaction(
        client,
        buildUserSignature(params.payer),
        requestData
      );
      const response = TransactionResponseData.parse(
        new Uint8Array(responseBytes)
      ) as {
        Presign?: { presign_id: number[] | Uint8Array };
        Error?: { message: string };
      };

      if (response.Presign) {
        return Buffer.from(response.Presign.presign_id);
      }
      if (response.Error) {
        throw new Error(`Ika presign failed: ${response.Error.message}`);
      }
      throw new Error(
        `Unexpected Ika presign response: ${JSON.stringify(response)}`
      );
    },

    async requestBitcoinSign(params: RequestSignParams): Promise<Buffer> {
      const dwalletAddress = normalizeDWalletAddress(params.dwalletAddress);
      const requestData = SignedRequestData.serialize({
        session_identifier_preimage: Array.from(dwalletAddress),
        epoch: 1n,
        chain_id: { Solana: true },
        intended_chain_sender: Array.from(params.payer.publicKey.toBytes()),
        request: {
          Sign: {
            message: Array.from(params.message),
            curve: { Secp256k1: true },
            signature_algorithm: { ECDSASecp256k1: true },
            hash_scheme: { DoubleSHA256: true },
            presign_id: Array.from(params.presignId),
            message_centralized_signature: Array.from(new Uint8Array(64)),
            approval_proof: {
              Solana: {
                transaction_signature: Array.from(
                  decodeSolanaTxSignature(params.approvalTxSignature)
                ),
                slot: BigInt(params.approvalTxSlot),
              },
            },
          },
        },
      }).toBytes();

      const responseBytes = await submitTransaction(
        client,
        buildUserSignature(params.payer),
        requestData
      );
      const response = TransactionResponseData.parse(
        new Uint8Array(responseBytes)
      ) as {
        Signature?: { signature: number[] | Uint8Array };
        Error?: { message: string };
      };

      if (response.Signature) {
        return Buffer.from(response.Signature.signature);
      }
      if (response.Error) {
        throw new Error(`Ika sign failed: ${response.Error.message}`);
      }
      throw new Error(
        `Unexpected Ika sign response: ${JSON.stringify(response)}`
      );
    },

    close() {
      client.close();
    },
  };
}

export function decodeDWalletAccount(data: Buffer): DecodedDWalletAccount {
  if (
    data.length < DWALLET_ACCOUNT_LEN ||
    data[0] !== DWALLET_ACCOUNT_DISCRIMINATOR
  ) {
    throw new Error("Invalid dWallet account data");
  }

  const publicKeyLen = data[99];
  return {
    authority: new PublicKey(data.subarray(2, 34)),
    publicKey: Buffer.from(data.subarray(34, 34 + publicKeyLen)),
    curve: data[100],
    isImported: data[101] === 1,
  };
}

export function decodeMessageApprovalAccount(
  data: Buffer
): DecodedMessageApprovalAccount {
  if (
    data.length < MESSAGE_APPROVAL_ACCOUNT_LEN ||
    data[0] !== MESSAGE_APPROVAL_ACCOUNT_DISCRIMINATOR
  ) {
    throw new Error("Invalid MessageApproval account data");
  }

  const signatureLen = data.readUInt16LE(140);
  return {
    dwallet: new PublicKey(data.subarray(2, 34)),
    messageHash: Buffer.from(data.subarray(34, 66)),
    userPubkey: Buffer.from(data.subarray(66, 98)),
    signatureScheme: data[98],
    callerProgram: new PublicKey(data.subarray(99, 131)),
    cpiAuthority: new PublicKey(data.subarray(131, 163)),
    status: data[139],
    signature: Buffer.from(data.subarray(142, 142 + signatureLen)),
  };
}

export async function fetchDecodedDWalletAccount(
  connection: Connection,
  dwallet: PublicKey
): Promise<DecodedDWalletAccount> {
  return decodeDWalletAccount(
    await fetchAccountData(connection, dwallet, "dWallet")
  );
}

export async function fetchDecodedMessageApprovalAccount(
  connection: Connection,
  messageApproval: PublicKey
): Promise<DecodedMessageApprovalAccount> {
  return decodeMessageApprovalAccount(
    await fetchAccountData(connection, messageApproval, "MessageApproval")
  );
}

export async function waitForMessageApprovalSigned(
  connection: Connection,
  messageApproval: PublicKey,
  timeoutMs = 30_000,
  intervalMs = 2_000
): Promise<DecodedMessageApprovalAccount> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const decoded = await fetchDecodedMessageApprovalAccount(
        connection,
        messageApproval
      );
      if (decoded.status === MESSAGE_APPROVAL_STATUS_SIGNED) {
        return decoded;
      }
    } catch {
      // Retry until the account exists and is signed.
    }
    await sleep(intervalMs);
  }

  throw new Error(
    `Timed out waiting for MessageApproval ${messageApproval.toBase58()} to be signed`
  );
}

export async function waitForTransactionSlot(
  connection: Connection,
  signature: string,
  timeoutMs = 30_000,
  intervalMs = 1_000
): Promise<number> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const transaction = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction) {
      return transaction.slot;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for transaction slot for ${signature}`);
}
