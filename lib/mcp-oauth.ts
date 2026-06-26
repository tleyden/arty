import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";

import {
  fetchOAuthServerMetadata,
  fetchResourceMetadata,
  registerOAuthClient,
} from "../modules/vm-webrtc/src/mcp_client/extensions";
import { log } from "./logger";
import {
  deleteMcpClientSecret,
  getMcpClientSecret,
  getMcpClientId,
  getMcpRefreshToken,
  getMcpResource,
  getMcpTokenEndpoint,
  saveMcpAuthMode,
  saveMcpBearerToken,
  saveMcpClientId,
  saveMcpClientSecret,
  saveMcpRefreshToken,
  saveMcpResource,
  saveMcpTokenEndpoint,
} from "./secure-storage";

export interface McpOAuthPendingState {
  extensionId: string;
  codeVerifier: string;
  redirectUri: string;
  clientId: string;
  tokenEndpoint: string;
  extensionName: string;
  extensionServerUrl: string;
  extensionNormalizedName: string;
}

export type McpOAuthFlowResult =
  | { type: "success"; accessToken: string; refreshToken?: string }
  | { type: "needs_manual_callback"; pendingState: McpOAuthPendingState };

// Static client credentials — only the client ID and optional secret are needed.
// OAuth endpoints are auto-discovered from the MCP server, just like DCR mode.
export interface StaticOAuthCredentials {
  clientId: string;
  clientSecret?: string;
}

export async function performMcpOAuthFlow(
  extensionId: string,
  resourceMetadataUrl: string,
  connectorName?: string,
  extensionInfo?: { serverUrl: string; normalizedName: string },
  staticCredentials?: StaticOAuthCredentials,
): Promise<McpOAuthFlowResult> {
  const mode = staticCredentials ? "static" : "dcr";
  log.info(
    "[mcp_oauth] Starting OAuth flow",
    {},
    { extension_id: extensionId, connector_name: connectorName, mode },
  );

  // Both DCR and static share OAuth endpoint discovery from the MCP server.
  const resourceMetadata = await fetchResourceMetadata(resourceMetadataUrl, connectorName);
  const authServerUrl = resourceMetadata.authorizationServers[0];
  const oauthMeta = await fetchOAuthServerMetadata(authServerUrl, connectorName);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vibemachine",
    path: "mcp-oauth-callback",
  });

  let clientId: string;
  let clientSecret: string | undefined;

  if (staticCredentials) {
    // Static mode: use provided credentials, skip dynamic client registration.
    clientId = staticCredentials.clientId;
    clientSecret = staticCredentials.clientSecret;
    await saveMcpClientId(extensionId, clientId);
    if (clientSecret) {
      await saveMcpClientSecret(extensionId, clientSecret);
    } else {
      await deleteMcpClientSecret(extensionId);
    }
    await saveMcpAuthMode(extensionId, "static");
  } else {
    // DCR mode: register a new public client or reuse a cached one.
    const cachedId = await getMcpClientId(extensionId);
    if (cachedId) {
      clientId = cachedId;
    } else {
      if (!oauthMeta.registrationEndpoint) {
        throw new Error(
          "Server requires OAuth but has no registration_endpoint and no cached client_id",
        );
      }
      const reg = await registerOAuthClient(
        oauthMeta.registrationEndpoint,
        redirectUri,
        connectorName,
      );
      clientId = reg.clientId;
      await saveMcpClientId(extensionId, clientId);
    }
    await deleteMcpClientSecret(extensionId);
    await saveMcpAuthMode(extensionId, "dcr");
  }

  await saveMcpTokenEndpoint(extensionId, oauthMeta.tokenEndpoint);
  await saveMcpResource(extensionId, resourceMetadata.resource);

  const discovery = {
    authorizationEndpoint: oauthMeta.authorizationEndpoint,
    tokenEndpoint: oauthMeta.tokenEndpoint,
  };

  const request = new AuthSession.AuthRequest({
    clientId,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
    scopes: [],
    usePKCE: true,
    extraParams: { resource: resourceMetadata.resource },
  });

  await request.makeAuthUrlAsync(discovery);

  const pendingState: McpOAuthPendingState = {
    extensionId,
    codeVerifier: request.codeVerifier ?? "",
    redirectUri,
    clientId,
    tokenEndpoint: oauthMeta.tokenEndpoint,
    extensionName: connectorName ?? "",
    extensionServerUrl: extensionInfo?.serverUrl ?? "",
    extensionNormalizedName: extensionInfo?.normalizedName ?? "",
  };

  log.info(
    "[mcp_oauth] Opening browser for authorization",
    {},
    { connector_name: connectorName, mode },
  );

  const result = await request.promptAsync(discovery);

  log.info(
    "[mcp_oauth] promptAsync returned",
    {},
    {
      result_type: result.type,
      error: (result as any).error ?? undefined,
      connector_name: connectorName,
    },
  );

  if (result.type === "success" && result.params.code) {
    log.info(
      "[mcp_oauth] Exchanging code for token",
      {},
      { connector_name: connectorName },
    );
    const tokens = await exchangeAndStore(
      result.params.code,
      clientId,
      redirectUri,
      request.codeVerifier ?? "",
      oauthMeta.tokenEndpoint,
      extensionId,
      connectorName,
      clientSecret,
      resourceMetadata.resource,
    );
    return { type: "success", ...tokens };
  }

  if (result.type === "error") {
    const detail = (result as any).error_description ?? (result as any).error ?? JSON.stringify((result as any).params ?? result);
    log.error(
      "[mcp_oauth] OAuth server returned an error",
      {},
      { connector_name: connectorName, result },
    );
    throw new Error(`OAuth error: ${detail}`);
  }

  log.info(
    "[mcp_oauth] Browser closed without redirect, returning manual callback state",
    {},
    { connector_name: connectorName, result_type: result.type },
  );
  return { type: "needs_manual_callback", pendingState };
}

export async function completeMcpOAuthFromCallbackUrl(
  callbackUrl: string,
  pendingState: McpOAuthPendingState,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const questionIdx = callbackUrl.indexOf("?");
  if (questionIdx === -1) {
    throw new Error("No authorization code found in that URL.");
  }
  const params = new URLSearchParams(callbackUrl.slice(questionIdx + 1));
  const code = params.get("code");
  if (!code) {
    throw new Error("No authorization code found in that URL.");
  }

  log.info(
    "[mcp_oauth] Completing OAuth from pasted callback URL",
    {},
    { extension_id: pendingState.extensionId },
  );

  const [clientSecret, resource] = await Promise.all([
    getMcpClientSecret(pendingState.extensionId),
    getMcpResource(pendingState.extensionId),
  ]);

  return exchangeAndStore(
    code,
    pendingState.clientId,
    pendingState.redirectUri,
    pendingState.codeVerifier,
    pendingState.tokenEndpoint,
    pendingState.extensionId,
    undefined,
    clientSecret ?? undefined,
    resource ?? undefined,
  );
}

async function exchangeAndStore(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  tokenEndpoint: string,
  extensionId: string,
  connectorName?: string,
  clientSecret?: string,
  resource?: string,
): Promise<{ accessToken: string; refreshToken?: string }> {
  const exchangeConfig: any = {
    code,
    clientId,
    redirectUri,
  };
  if (clientSecret) {
    exchangeConfig.clientSecret = clientSecret;
  }
  const extraParams: Record<string, string> = {};
  if (codeVerifier) {
    extraParams.code_verifier = codeVerifier;
  }
  if (resource) {
    extraParams.resource = resource;
  }
  if (Object.keys(extraParams).length > 0) {
    exchangeConfig.extraParams = extraParams;
  }
  const tokenResponse = await AuthSession.exchangeCodeAsync(
    exchangeConfig,
    { tokenEndpoint },
  );

  await saveMcpBearerToken(extensionId, tokenResponse.accessToken);
  await saveMcpTokenEndpoint(extensionId, tokenEndpoint);
  if (tokenResponse.refreshToken) {
    await saveMcpRefreshToken(extensionId, tokenResponse.refreshToken);
  }

  log.info(
    "[mcp_oauth] OAuth flow complete",
    {},
    {
      connector_name: connectorName,
      has_refresh_token: !!tokenResponse.refreshToken,
      used_client_secret: !!clientSecret,
    },
  );

  return {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken ?? undefined,
  };
}

export async function refreshMcpAccessToken(
  extensionId: string,
  connectorName?: string,
): Promise<string | null> {
  const result = await refreshMcpAccessTokenWithDetails(extensionId, connectorName);
  return result.type === "success" ? result.accessToken : null;
}

export type McpAccessTokenRefreshResult =
  | { type: "success"; accessToken: string }
  | { type: "failure"; userMessage: string; oauthErrorCode?: string };

const sha256Prefix = async (value: string | null | undefined): Promise<string> => {
  if (!value) return "(none)";
  const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value);
  return hash.slice(0, 8);
};

const getOAuthRefreshErrorCode = (err: unknown): string | undefined =>
  (err as any)?.code ??
  (err as any)?.error ??
  (typeof (err as any)?.message === "string"
    ? (err as any).message.match(/\b(invalid_\w+|unauthorized_client|access_denied)\b/)?.[0]
    : undefined) ??
  undefined;

const buildMissingRefreshPrerequisiteMessage = (missingFields: string[]): string => {
  if (missingFields.length === 1) {
    const missingField = missingFields[0];
    if (missingField === "refresh_token") {
      return "Missing saved refresh token. Re-authenticate this connector, then try again.";
    }
    if (missingField === "token_endpoint") {
      return "Missing saved token endpoint. Re-authenticate this connector, then try again.";
    }
    if (missingField === "client_id") {
      return "Missing saved client ID. Re-authenticate this connector, then try again.";
    }
  }

  return `Missing saved OAuth refresh credentials (${missingFields.join(", ")}). Re-authenticate this connector, then try again.`;
};

export async function refreshMcpAccessTokenWithDetails(
  extensionId: string,
  connectorName?: string,
): Promise<McpAccessTokenRefreshResult> {
  const [refreshToken, tokenEndpoint, clientId, clientSecret, resource] = await Promise.all([
    getMcpRefreshToken(extensionId),
    getMcpTokenEndpoint(extensionId),
    getMcpClientId(extensionId),
    getMcpClientSecret(extensionId),
    getMcpResource(extensionId),
  ]);

  const missingFields = [
    !refreshToken ? "refresh_token" : null,
    !tokenEndpoint ? "token_endpoint" : null,
    !clientId ? "client_id" : null,
  ].filter((field): field is string => !!field);

  if (!refreshToken || !tokenEndpoint || !clientId) {
    log.warn(
      "[mcp_oauth] Cannot refresh access token because stored OAuth refresh prerequisites are missing",
      {},
      {
        extension_id: extensionId,
        connector_name: connectorName,
        missing_fields: missingFields,
        has_refresh_token: !!refreshToken,
        has_token_endpoint: !!tokenEndpoint,
        has_client_id: !!clientId,
        has_client_secret: !!clientSecret,
      },
    );
    return {
      type: "failure",
      userMessage: buildMissingRefreshPrerequisiteMessage(missingFields),
      oauthErrorCode: undefined,
    };
  }

  const [clientIdHash, clientSecretHash] = await Promise.all([
    sha256Prefix(clientId),
    sha256Prefix(clientSecret),
  ]);

  log.info(
    "[mcp_oauth] Refreshing access token",
    {},
    {
      extension_id: extensionId,
      connector_name: connectorName,
      has_client_id: !!clientId,
      client_id: clientId,
      client_id_hash: clientIdHash,
      has_client_secret: !!clientSecret,
      client_secret_length: clientSecret?.length ?? 0,
      client_secret_hash: clientSecretHash,
      token_endpoint: tokenEndpoint,
      resource: resource ?? null,
    },
  );

  try {
    const refreshConfig: any = {
      clientId,
      refreshToken,
    };
    if (clientSecret) {
      refreshConfig.clientSecret = clientSecret;
    }
    if (resource) {
      refreshConfig.extraParams = { resource };
    }
    const tokenResponse = await AuthSession.refreshAsync(
      refreshConfig,
      { tokenEndpoint },
    );

    if (!tokenResponse.accessToken) {
      log.error(
        "[mcp_oauth] Token refresh response did not include an access token",
        {},
        {
          extension_id: extensionId,
          connector_name: connectorName,
          token_endpoint: tokenEndpoint,
          response_keys: Object.keys(tokenResponse),
        },
      );
      return {
        type: "failure",
        userMessage:
          "The OAuth provider refresh response did not include an access token. Re-authenticate this connector, then try again.",
      };
    }

    await saveMcpBearerToken(extensionId, tokenResponse.accessToken);
    if (tokenResponse.refreshToken) {
      await saveMcpRefreshToken(extensionId, tokenResponse.refreshToken);
    }

    log.info("[mcp_oauth] Token refresh succeeded", {}, { connector_name: connectorName });
    return { type: "success", accessToken: tokenResponse.accessToken };
  } catch (err) {
    const oauthCode = getOAuthRefreshErrorCode(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.warn(
      "[mcp_oauth] Token refresh failed",
      {},
      {
        extension_id: extensionId,
        connector_name: connectorName,
        error_name: err instanceof Error ? err.name : undefined,
        error_message: errorMessage,
        error_stack: err instanceof Error ? err.stack : undefined,
        oauth_error_code: oauthCode,
        token_endpoint: tokenEndpoint,
        has_refresh_token: !!refreshToken,
        has_client_id: !!clientId,
        client_id: clientId,
        client_id_hash: clientIdHash,
        has_client_secret: !!clientSecret,
        client_secret_hash: clientSecretHash,
      },
    );
    return {
      type: "failure",
      userMessage: oauthCode
        ? `The OAuth provider rejected the refresh request (${oauthCode}). Re-authenticate this connector, then try again.`
        : `Could not refresh the access token: ${errorMessage}`,
      oauthErrorCode: oauthCode,
    };
  }
}
