import { beforeEach, describe, expect, mock, test } from "bun:test";

type PromptResult =
  | { type: "success"; params: { code?: string } }
  | { type: "dismiss" }
  | { type: "error"; error?: string; error_description?: string; params?: Record<string, unknown> };

const secureState = {
  clientId: null as string | null,
  clientSecret: null as string | null,
  refreshToken: null as string | null,
  tokenEndpoint: null as string | null,
  savedBearerTokens: [] as string[],
  savedClientIds: [] as { id: string; clientId: string }[],
  savedClientSecrets: [] as { id: string; clientSecret: string }[],
  savedRefreshTokens: [] as string[],
  savedTokenEndpoints: [] as { id: string; tokenEndpoint: string }[],
  savedAuthModes: [] as { id: string; mode: string }[],
};

const authState = {
  promptResult: { type: "success", params: { code: "auth-code" } } as PromptResult,
  exchangeResponse: {
    accessToken: "access-token",
    refreshToken: "refresh-token",
  },
  refreshResponse: {
    accessToken: "refreshed-token",
    refreshToken: "rotated-refresh-token",
  },
  lastAuthRequestConfig: null as Record<string, unknown> | null,
  exchangeCalls: [] as Record<string, unknown>[],
  refreshCalls: [] as Record<string, unknown>[],
};

const extensionState = {
  resourceMetadata: {
    authorizationServers: ["https://auth.example.com"],
    resource: "https://resource.example.com",
  },
  oauthMetadata: {
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    registrationEndpoint: "https://auth.example.com/register",
  },
  registeredClientId: "registered-client-id",
};

mock.module("../secure-storage", () => ({
  deleteMcpClientSecret: async () => {},
  getMcpAuthMode: async () => null,
  getMcpClientId: async () => secureState.clientId,
  getMcpClientSecret: async () => secureState.clientSecret,
  getMcpRefreshToken: async () => secureState.refreshToken,
  getMcpTokenEndpoint: async () => secureState.tokenEndpoint,
  saveMcpAuthMode: async (id: string, mode: string) => {
    secureState.savedAuthModes.push({ id, mode });
  },
  saveMcpBearerToken: async (_id: string, token: string) => {
    secureState.savedBearerTokens.push(token);
  },
  saveMcpClientId: async (id: string, clientId: string) => {
    secureState.savedClientIds.push({ id, clientId });
  },
  saveMcpClientSecret: async (id: string, clientSecret: string) => {
    secureState.savedClientSecrets.push({ id, clientSecret });
  },
  saveMcpRefreshToken: async (_id: string, refreshToken: string) => {
    secureState.savedRefreshTokens.push(refreshToken);
  },
  saveMcpTokenEndpoint: async (id: string, tokenEndpoint: string) => {
    secureState.savedTokenEndpoints.push({ id, tokenEndpoint });
  },
}));

mock.module("../logger", () => ({
  log: {
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

mock.module("../../modules/vm-webrtc/src/mcp_client/extensions", () => ({
  fetchOAuthServerMetadata: async () => extensionState.oauthMetadata,
  fetchResourceMetadata: async () => extensionState.resourceMetadata,
  registerOAuthClient: async () => ({ clientId: extensionState.registeredClientId }),
}));

mock.module("expo-auth-session", () => ({
  ResponseType: {
    Code: "code",
  },
  makeRedirectUri: () => "vibemachine://mcp-oauth-callback",
  AuthRequest: class AuthRequest {
    codeVerifier = "generated-code-verifier";

    constructor(config: Record<string, unknown>) {
      authState.lastAuthRequestConfig = config;
    }

    async makeAuthUrlAsync() {
      return "https://auth.example.com/authorize";
    }

    async promptAsync() {
      return authState.promptResult;
    }
  },
  exchangeCodeAsync: async (config: Record<string, unknown>, discovery: Record<string, unknown>) => {
    authState.exchangeCalls.push({ ...config, ...discovery });
    return authState.exchangeResponse;
  },
  refreshAsync: async (config: Record<string, unknown>, discovery: Record<string, unknown>) => {
    authState.refreshCalls.push({ ...config, ...discovery });
    return authState.refreshResponse;
  },
}));

const oauthModule = await import("../mcp-oauth");

beforeEach(() => {
  secureState.clientId = null;
  secureState.clientSecret = null;
  secureState.refreshToken = null;
  secureState.tokenEndpoint = null;
  secureState.savedBearerTokens = [];
  secureState.savedClientIds = [];
  secureState.savedClientSecrets = [];
  secureState.savedRefreshTokens = [];
  secureState.savedTokenEndpoints = [];
  secureState.savedAuthModes = [];

  authState.promptResult = { type: "success", params: { code: "auth-code" } };
  authState.exchangeResponse = {
    accessToken: "access-token",
    refreshToken: "refresh-token",
  };
  authState.refreshResponse = {
    accessToken: "refreshed-token",
    refreshToken: "rotated-refresh-token",
  };
  authState.lastAuthRequestConfig = null;
  authState.exchangeCalls = [];
  authState.refreshCalls = [];
});

describe("performMcpOAuthFlow", () => {
  test("uses static credentials without probing resource metadata and disables PKCE for confidential clients", async () => {
    const result = await (oauthModule.performMcpOAuthFlow as any)(
      "extension-1",
      "",
      "Static Connector",
      undefined,
      {
        clientId: "static-client-id",
        clientSecret: "static-client-secret",
        authorizationEndpoint: "https://provider.example.com/authorize",
        tokenEndpoint: "https://provider.example.com/token",
        scopes: ["openid", "profile"],
      },
    );

    expect(result).toEqual({
      type: "success",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    expect(authState.lastAuthRequestConfig).toMatchObject({
      clientId: "static-client-id",
      scopes: ["openid", "profile"],
      usePKCE: false,
    });
    expect(authState.exchangeCalls[0]).toMatchObject({
      clientId: "static-client-id",
      clientSecret: "static-client-secret",
      tokenEndpoint: "https://provider.example.com/token",
    });
    expect(secureState.savedClientIds).toContainEqual({
      id: "extension-1",
      clientId: "static-client-id",
    });
    expect(secureState.savedClientSecrets).toContainEqual({
      id: "extension-1",
      clientSecret: "static-client-secret",
    });
    expect(secureState.savedAuthModes).toContainEqual({
      id: "extension-1",
      mode: "static",
    });
  });

  test("restores static client secrets for manual callback completion", async () => {
    secureState.clientSecret = "stored-static-secret";

    await oauthModule.completeMcpOAuthFromCallbackUrl(
      "vibemachine://mcp-oauth-callback?code=manual-code",
      {
        extensionId: "extension-2",
        codeVerifier: "",
        redirectUri: "vibemachine://mcp-oauth-callback",
        clientId: "static-client-id",
        tokenEndpoint: "https://provider.example.com/token",
        extensionName: "Static Connector",
        extensionServerUrl: "",
        extensionNormalizedName: "",
      },
    );

    expect(authState.exchangeCalls[0]).toMatchObject({
      code: "manual-code",
      clientId: "static-client-id",
      clientSecret: "stored-static-secret",
    });
  });
});

describe("refreshMcpAccessToken", () => {
  test("includes stored client secrets for confidential static clients during refresh", async () => {
    secureState.clientId = "static-client-id";
    secureState.clientSecret = "stored-static-secret";
    secureState.refreshToken = "stored-refresh-token";
    secureState.tokenEndpoint = "https://provider.example.com/token";

    const token = await oauthModule.refreshMcpAccessToken("extension-3", "Static Connector");

    expect(token).toBe("refreshed-token");
    expect(authState.refreshCalls[0]).toMatchObject({
      clientId: "static-client-id",
      clientSecret: "stored-static-secret",
      refreshToken: "stored-refresh-token",
      tokenEndpoint: "https://provider.example.com/token",
    });
  });
});
