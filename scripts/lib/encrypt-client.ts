import path from "path";

import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export const DEVNET_PRE_ALPHA_GRPC_URL =
  "pre-alpha-dev-1.encrypt.ika-network.net:443";

export const Chain = {
  Solana: 0,
} as const;

export interface EncryptedInput {
  ciphertextBytes: Buffer;
  fheType: number;
}

export interface CreateInputParams {
  chain: number;
  inputs: EncryptedInput[];
  proof?: Buffer;
  authorized: Buffer;
  networkEncryptionPublicKey: Buffer;
}

export interface CreateInputResult {
  ciphertextIdentifiers: Buffer[];
}

export interface ReadCiphertextParams {
  message: Buffer;
  signature: Buffer;
  signer: Buffer;
}

export interface ReadCiphertextResult {
  value: Buffer;
  fheType: number;
  digest: Buffer;
}

type GrpcClient = {
  CreateInput(
    request: Record<string, unknown>,
    callback: (error: grpc.ServiceError | null, response?: Record<string, unknown>) => void,
  ): void;
  ReadCiphertext(
    request: Record<string, unknown>,
    callback: (error: grpc.ServiceError | null, response?: Record<string, unknown>) => void,
  ): void;
  close(): void;
};

function loadEncryptService(): new (
  address: string,
  credentials: grpc.ChannelCredentials,
) => GrpcClient {
  const protoPath = path.resolve(__dirname, "../../proto/encrypt_service.proto");
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    encrypt: {
      v1: {
        EncryptService: new (
          address: string,
          credentials: grpc.ChannelCredentials,
        ) => GrpcClient;
      };
    };
  };

  return proto.encrypt.v1.EncryptService;
}

export function createEncryptClient(
  grpcUrl: string = DEVNET_PRE_ALPHA_GRPC_URL,
) {
  const EncryptService = loadEncryptService();
  const isLocal =
    grpcUrl.startsWith("localhost") || grpcUrl.startsWith("127.0.0.1");
  const credentials = isLocal
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl();
  const client = new EncryptService(grpcUrl, credentials);

  return {
    createInput(params: CreateInputParams): Promise<CreateInputResult> {
      return new Promise((resolve, reject) => {
        client.CreateInput(
          {
            chain: params.chain,
            inputs: params.inputs.map((input) => ({
              ciphertext_bytes: input.ciphertextBytes,
              fhe_type: input.fheType,
            })),
            proof: params.proof ?? Buffer.alloc(0),
            authorized: params.authorized,
            network_encryption_public_key: params.networkEncryptionPublicKey,
          },
          (error, response) => {
            if (error) {
              reject(error);
              return;
            }

            const ciphertextIdentifiers =
              (response?.ciphertext_identifiers as Buffer[] | undefined) ?? [];
            resolve({ ciphertextIdentifiers });
          },
        );
      });
    },

    readCiphertext(
      params: ReadCiphertextParams,
    ): Promise<ReadCiphertextResult> {
      return new Promise((resolve, reject) => {
        client.ReadCiphertext(
          {
            message: params.message,
            signature: params.signature,
            signer: params.signer,
          },
          (error, response) => {
            if (error) {
              reject(error);
              return;
            }

            resolve({
              value: (response?.value as Buffer | undefined) ?? Buffer.alloc(0),
              fheType: Number(response?.fhe_type ?? 0),
              digest: (response?.digest as Buffer | undefined) ?? Buffer.alloc(0),
            });
          },
        );
      });
    },

    close() {
      client.close();
    },
  };
}

export function mockCiphertext(value: bigint): Uint8Array {
  const bytes = new Uint8Array(16);
  let remaining = value;
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}
