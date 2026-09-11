import { z } from "zod";
import type { Environment } from "../config/environment.js";
import type { AlpacaPaperAuthentication } from "../execution/broker.js";
import type { BrokerConnectionMethod, CustomerStore, MasterCredentialStore } from "./customer-store.js";
import { decryptSecret } from "./customer-security.js";

const apiKeyBundleSchema = z.object({
  apiKeyId: z.string().min(1),
  apiSecret: z.string().min(1),
}).strict();

export interface BrokerCredentialProvider {
  getAuthentication(customerId: string): Promise<{
    readonly method: BrokerConnectionMethod;
    readonly authentication: AlpacaPaperAuthentication;
  } | null>;
}

export class EncryptedStoreBrokerCredentialProvider implements BrokerCredentialProvider {
  constructor(
    private readonly store: CustomerStore,
    private readonly environment: Environment,
  ) {}

  async getAuthentication(customerId: string) {
    const stored = await this.store.getFollowerCredential(customerId);
    if (!stored) return null;
    if (stored.keyRef !== this.environment.PAPER_COPY_TOKEN_KEY_REF)
      throw new Error("FOLLOWER_CREDENTIAL_KEY_VERSION_MISMATCH");
    const plaintext = decryptSecret(
      stored,
      this.environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? "",
      customerId,
    );
    if (stored.connectionMethod === "ALPACA_OAUTH") {
      return {
        method: stored.connectionMethod,
        authentication: { kind: "FOLLOWER_OAUTH" as const, accessToken: plaintext },
      };
    }
    const bundle = apiKeyBundleSchema.parse(JSON.parse(plaintext));
    return {
      method: stored.connectionMethod,
      authentication: {
        kind: "FOLLOWER_API_KEY" as const,
        apiKey: bundle.apiKeyId,
        apiSecret: bundle.apiSecret,
      },
    };
  }
}

export class MasterEncryptedStoreBrokerCredentialProvider {
  constructor(
    private readonly store: MasterCredentialStore,
    private readonly environment: Environment,
  ) {}

  async getAuthentication() {
    const stored = await this.store.getMasterCredential();
    if (!stored) return null;
    if (stored.connectionMethod !== 'PAPER_API_KEY_PRIVATE_BETA')
      throw new Error('MASTER_CREDENTIAL_METHOD_UNSUPPORTED');
    if (stored.keyRef !== this.environment.PAPER_COPY_TOKEN_KEY_REF)
      throw new Error('MASTER_CREDENTIAL_KEY_VERSION_MISMATCH');
    const plaintext = decryptSecret(
      stored,
      this.environment.PAPER_COPY_TOKEN_ENCRYPTION_KEY ?? '',
      stored.customerId,
    );
    const bundle = apiKeyBundleSchema.parse(JSON.parse(plaintext));
    return {
      method: stored.connectionMethod,
      providerAccountRef: stored.providerAccountRef,
      authentication: { kind: 'MASTER_API_KEY' as const, apiKey: bundle.apiKeyId, apiSecret: bundle.apiSecret },
    };
  }
}

