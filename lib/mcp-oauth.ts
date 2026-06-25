import * as AuthSession from "expo-auth-session";

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
  getMcpTokenEndpoint,
  saveMcpAuthMode,
  saveMcpBearerToken,
  saveMcpClientId,
  saveMcpClientSecret,
  saveMcpRefreshToken,
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

export interface StaticOAuthCredentials {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes?: string[];
}

export async function performMcpOAuthFlow(
  extensionId: string,
  resourceMetadataUrl: string,
  connectorName?: string,
  extensionInfo?: { serverUrl: string; normalizedName: string },
  staticCredentials?: StaticOAuthCredentials,
): Promise<McpOAuthFlowResult> {
  if (staticCredentials) {
    log.info(
      "[mcp_oauth] Starting OAuth flow with static credentials",
      {},
      { extension_id: extensionId, connector_name: connectorName },
    );
    return performStaticOAuthFlow(extensionId, staticCredentials, connectorName);
  }

  log.info(
    "[mcp_oauth] Starting OAuth flow with DCR",
    {},
    { extension_id: extensionId, connector_name: connectorName },
  );

  const resourceMetadata = await fetchResourceMetadata(resourceMetadataUrl, connectorName);
  const authServerUrl = resourceMetadata.authorizationServers[0];
  const oauthMeta = await fetchOAuthServerMetadata(authServerUrl, connectorName);

  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vibemachine",
    path: "mcp-oauth-callback",
  });

  let clientId = await getMcpClientId(extensionId);
  if (!clientId) {
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
    "[mcp_oauth] Step 5: opening browser for authorization",
    {},
    { connector_name: connectorName },
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
      "[mcp_oauth] Step 6: exchanging code for token",
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
      undefined,
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

  // Browser was dismissed or redirect wasn't intercepted — surface manual paste UI
  log.info(
    "[mcp_oauth] Browser closed without redirect, returning manual callback state",
    {},
    { connector_name: connectorName, result_type: result.type },
  );
  return { type: "needs_manual_callback", pendingState };
}

async function performStaticOAuthFlow(
  extensionId: string,
  credentials: StaticOAuthCredentials,
  connectorName?: string,
): Promise<McpOAuthFlowResult> {
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vibemachine",
    path: "mcp-oauth-callback",
  });

  await saveMcpClientId(extensionId, credentials.clientId);
  if (credentials.clientSecret) {
    await saveMcpClientSecret(extensionId, credentials.clientSecret);
  } else {
    await deleteMcpClientSecret(extensionId);
  }
  await saveMcpTokenEndpoint(extensionId, credentials.tokenEndpoint);
  await saveMcpAuthMode(extensionId, "static");

  const discovery = {
    authorizationEndpoint: credentials.authorizationEndpoint,
    tokenEndpoint: credentials.tokenEndpoint,
  };

  const request = new AuthSession.AuthRequest({
    clientId: credentials.clientId,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
    scopes: credentials.scopes ?? [],
    usePKCE: !credentials.clientSecret,
  });

  await request.makeAuthUrlAsync(discovery);

  const pendingState: McpOAuthPendingState = {
    extensionId,
    codeVerifier: request.codeVerifier ?? "",
    redirectUri,
    clientId: credentials.clientId,
    tokenEndpoint: credentials.tokenEndpoint,
    extensionName: connectorName ?? "",
    extensionServerUrl: "",
    extensionNormalizedName: "",
  };

  log.info(
    "[mcp_oauth] Opening browser for static OAuth authorization",
    {},
    { connector_name: connectorName },
  );

  const result = await request.promptAsync(discovery);

  log.info(
    "[mcp_oauth] Static OAuth promptAsync returned",
    {},
    {
      result_type: result.type,
      error: (result as any).error ?? undefined,
      connector_name: connectorName,
    },
  );

  if (result.type === "success" && result.params.code) {
    const tokens = await exchangeAndStore(
      result.params.code,
      credentials.clientId,
      redirectUri,
      request.codeVerifier ?? "",
      credentials.tokenEndpoint,
      extensionId,
      connectorName,
      credentials.clientSecret,
    );
    return { type: "success", ...tokens };
  }

  if (result.type === "error") {
    const detail =
      (result as any).error_description ??
      (result as any).error ??
      JSON.stringify((result as any).params ?? result);
    log.error(
      "[mcp_oauth] Static OAuth error",
      {},
      { connector_name: connectorName, result_type: result.type, error: detail },
    );
    throw new Error(`OAuth error: ${detail}`);
  }

  log.info(
    "[mcp_oauth] Browser closed, returning manual callback state",
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

  const clientSecret = await getMcpClientSecret(pendingState.extensionId);

  return exchangeAndStore(
    code,
    pendingState.clientId,
    pendingState.redirectUri,
    pendingState.codeVerifier,
    pendingState.tokenEndpoint,
    pendingState.extensionId,
    undefined,
    clientSecret ?? undefined,
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
): Promise<{ accessToken: string; refreshToken?: string }> {
  const exchangeConfig: any = {
    code,
    clientId,
    redirectUri,
  };
  if (clientSecret) {
    exchangeConfig.clientSecret = clientSecret;
  }
  if (codeVerifier) {
    exchangeConfig.extraParams = { code_verifier: codeVerifier };
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
  const [refreshToken, tokenEndpoint, clientId, clientSecret] = await Promise.all([
    getMcpRefreshToken(extensionId),
    getMcpTokenEndpoint(extensionId),
    getMcpClientId(extensionId),
    getMcpClientSecret(extensionId),
  ]);

  if (!refreshToken || !tokenEndpoint || !clientId) return null;

  log.info(
    "[mcp_oauth] Refreshing access token",
    {},
    {
      extension_id: extensionId,
      connector_name: connectorName,
      has_client_secret: !!clientSecret,
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
    const tokenResponse = await AuthSession.refreshAsync(
      refreshConfig,
      { tokenEndpoint },
    );

    await saveMcpBearerToken(extensionId, tokenResponse.accessToken);
    if (tokenResponse.refreshToken) {
      await saveMcpRefreshToken(extensionId, tokenResponse.refreshToken);
    }

    log.info("[mcp_oauth] Token refresh succeeded", {}, { connector_name: connectorName });
    return tokenResponse.accessToken;
  } catch (err) {
    log.warn(
      "[mcp_oauth] Token refresh failed",
      {},
      { connector_name: connectorName, error: err instanceof Error ? err.message : String(err) },
    );
    return null;
  }
}
