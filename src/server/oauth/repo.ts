export interface OAuthClient {
  clientId: string;
  clientName: string | null;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
}

export interface AuthCode {
  codeHash: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface TokenRecord {
  tokenHash: string;
  kind: "access" | "refresh";
  clientId: string;
  userId: string;
  resource: string;
  scope: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Refresh: previous refresh hash, or the auth code hash for the first one. Access: its paired refresh hash. */
  parentHash: string | null;
}

export interface ClientRepo {
  create(client: OAuthClient): Promise<void>;
  find(clientId: string): Promise<OAuthClient | null>;
}

export interface CodeRepo {
  insert(code: AuthCode): Promise<void>;
  find(codeHash: string): Promise<AuthCode | null>;
  /** Atomic: true only for the one caller that flips used_at from null. */
  markUsed(codeHash: string, at: Date): Promise<boolean>;
}

export interface TokenRepo {
  insert(token: TokenRecord): Promise<void>;
  find(tokenHash: string): Promise<TokenRecord | null>;
  findChildren(parentHashes: string[]): Promise<TokenRecord[]>;
  /** Atomic: true only if the token was active and is now revoked by this call. */
  revokeIfActive(tokenHash: string, at: Date): Promise<boolean>;
  revokeMany(tokenHashes: string[], at: Date): Promise<void>;
}
