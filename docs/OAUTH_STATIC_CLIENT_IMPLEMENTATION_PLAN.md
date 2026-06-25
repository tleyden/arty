# OAuth2 Static Client Credentials Implementation Plan

## Overview

This document provides a detailed implementation plan for adding static client ID and client secret support to the MCP OAuth2 client. Currently, the system only supports Dynamic Client Registration (DCR). This enhancement will allow users to configure pre-existing OAuth2 client credentials.

---

## Current State Analysis

### Existing Capabilities

**Dynamic Client Registration (DCR)** ✅
- Fully implemented in `lib/mcp-oauth.ts` and `modules/vm-webrtc/src/mcp_client/extensions.ts`
- OAuth discovery via `/.well-known/oauth-authorization-server`
- Automatic client registration via `registration_endpoint`
- PKCE-based authorization code flow
- Refresh token support
- Uses `token_endpoint_auth_method: "none"` (public client)

**Manual Bearer Tokens** ✅
- Users can provide pre-existing bearer tokens
- No OAuth flow required
- Stored securely per extension

**NOT Supported (Yet)** ❌
- Static OAuth2 client credentials (client_id + optional client_secret)
- Manual OAuth endpoint configuration
- Confidential client authentication (`client_secret_post`)

### Current Storage Schema

Per-extension secure storage:
```
MCP_TOKEN_PREFIX + id          → access/bearer token
MCP_CLIENT_ID_PREFIX + id      → dynamically registered client_id
MCP_REFRESH_TOKEN_PREFIX + id  → refresh token
MCP_TOKEN_ENDPOINT_PREFIX + id → token endpoint URL
```

Extension metadata (AsyncStorage):
```typescript
interface McpExtensionRecord {
  id: string;
  name: string;
  normalizedName: string;
  serverUrl: string;
  disabled?: boolean;
}
```

---

## Requirements Summary

1. Support static client_id and optional client_secret
2. Support `token_endpoint_auth_method` of:
   - `"none"` (public client with PKCE only)
   - `"client_secret_post"` (confidential client)
3. Skip server probe when using static mode (go directly to OAuth flow)
4. Maintain full backwards compatibility with existing DCR-based connectors
5. NO CIMD support (deferred)

---

## Implementation Plan

### Phase 1: Storage Layer Enhancement

**File:** `lib/secure-storage.ts`

#### 1.1 Add Storage Constants

Add these constants near line 818 (after existing MCP constants):

```typescript
const MCP_CLIENT_SECRET_PREFIX = "VIBEMACHINE_MCP_CLIENT_SECRET_";
const MCP_AUTH_MODE_PREFIX = "VIBEMACHINE_MCP_AUTH_MODE_";
```

#### 1.2 Update McpExtensionRecord Interface

Update the interface (line 775) to track auth mode:

```typescript
export interface McpExtensionRecord {
  id: string;
  name: string;
  normalizedName: string;
  serverUrl: string;
  disabled?: boolean;
  authMode?: 'dcr' | 'static' | 'bearer'; // NEW: Track authentication type
}
```

#### 1.3 Add Client Secret Storage Functions

Add after `getMcpClientId()` function (around line 889):

```typescript
export async function saveMcpClientSecret(id: string, secret: string): Promise<void> {
  await setCachedValue(`${MCP_CLIENT_SECRET_PREFIX}${id}`, secret);
}

export async function getMcpClientSecret(id: string): Promise<string | null> {
  try {
    return await getCachedValue(`${MCP_CLIENT_SECRET_PREFIX}${id}`);
  } catch {
    return null;
  }
}

export async function deleteMcpClientSecret(id: string): Promise<void> {
  try {
    await deleteCachedValue(`${MCP_CLIENT_SECRET_PREFIX}${id}`);
  } catch {
    // secret may not exist
  }
}
```

#### 1.4 Add Auth Mode Storage Functions

Add after client secret functions:

```typescript
export async function saveMcpAuthMode(id: string, mode: 'dcr' | 'static' | 'bearer'): Promise<void> {
  await setCachedValue(`${MCP_AUTH_MODE_PREFIX}${id}`, mode);
}

export async function getMcpAuthMode(id: string): Promise<'dcr' | 'static' | 'bearer' | null> {
  try {
    const mode = await getCachedValue(`${MCP_AUTH_MODE_PREFIX}${id}`);
    if (mode === 'dcr' || mode === 'static' || mode === 'bearer') {
      return mode;
    }
    return null;
  } catch {
    return null;
  }
}
```

#### 1.5 Update clearMcpAuthCredentials()

Modify function (line 915) to also clear client secret and auth mode:

```typescript
export async function clearMcpAuthCredentials(id: string): Promise<void> {
  await Promise.allSettled([
    deleteCachedValue(`${MCP_CLIENT_ID_PREFIX}${id}`),
    deleteCachedValue(`${MCP_REFRESH_TOKEN_PREFIX}${id}`),
    deleteCachedValue(`${MCP_TOKEN_ENDPOINT_PREFIX}${id}`),
    deleteCachedValue(`${MCP_CLIENT_SECRET_PREFIX}${id}`),      // NEW
    deleteCachedValue(`${MCP_AUTH_MODE_PREFIX}${id}`),           // NEW
  ]);
}
```

#### 1.6 Update clearAllStoredSecrets()

Add client secret and auth mode keys to the cleanup list (around line 1006):

```typescript
for (const ext of mcpExtensions) {
  secureStoreKeys.push(
    `${MCP_TOKEN_PREFIX}${ext.id}`,
    `${MCP_CLIENT_ID_PREFIX}${ext.id}`,
    `${MCP_REFRESH_TOKEN_PREFIX}${ext.id}`,
    `${MCP_TOKEN_ENDPOINT_PREFIX}${ext.id}`,
    `${MCP_CLIENT_SECRET_PREFIX}${ext.id}`,    // NEW
    `${MCP_AUTH_MODE_PREFIX}${ext.id}`,        // NEW
  );
}
```

---

### Phase 2: OAuth Flow Enhancement

#### 2.1 Update `lib/mcp-oauth.ts`

##### 2.1.1 Add Static Credentials Type

Add near the top of the file (after existing interfaces, around line 28):

```typescript
export interface StaticOAuthCredentials {
  clientId: string;
  clientSecret?: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes?: string[];
}
```

##### 2.1.2 Update performMcpOAuthFlow() Signature

Modify function signature (line 34):

```typescript
export async function performMcpOAuthFlow(
  extensionId: string,
  resourceMetadataUrl: string,
  connectorName?: string,
  extensionInfo?: { serverUrl: string; normalizedName: string },
  staticCredentials?: StaticOAuthCredentials,  // NEW parameter
): Promise<McpOAuthFlowResult>
```

##### 2.1.3 Add Static OAuth Flow Branch

Replace the content of `performMcpOAuthFlow()` with logic that branches based on whether `staticCredentials` is provided:

```typescript
export async function performMcpOAuthFlow(
  extensionId: string,
  resourceMetadataUrl: string,
  connectorName?: string,
  extensionInfo?: { serverUrl: string; normalizedName: string },
  staticCredentials?: StaticOAuthCredentials,
): Promise<McpOAuthFlowResult> {
  
  // NEW: Branch for static credentials
  if (staticCredentials) {
    log.info(
      "[mcp_oauth] Starting OAuth flow with static credentials",
      {},
      { extension_id: extensionId, connector_name: connectorName },
    );
    
    return performStaticOAuthFlow(
      extensionId,
      staticCredentials,
      connectorName,
    );
  }
  
  // EXISTING: DCR flow continues below
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
    { connector_name: connectorName },
  );

  const result = await request.promptAsync(discovery);

  log.info(
    "[mcp_oauth] promptAsync returned",
    {},
    {
      result_type: result.type,
      params: result.type === "success" ? result.params : undefined,
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
      undefined, // clientSecret not used in DCR flow
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
```

##### 2.1.4 Add performStaticOAuthFlow() Function

Add new function after `performMcpOAuthFlow()`:

```typescript
async function performStaticOAuthFlow(
  extensionId: string,
  credentials: StaticOAuthCredentials,
  connectorName?: string,
): Promise<McpOAuthFlowResult> {
  
  const redirectUri = AuthSession.makeRedirectUri({
    scheme: "vibemachine",
    path: "mcp-oauth-callback",
  });

  // Save static credentials
  await saveMcpClientId(extensionId, credentials.clientId);
  if (credentials.clientSecret) {
    await saveMcpClientSecret(extensionId, credentials.clientSecret);
  }
  await saveMcpTokenEndpoint(extensionId, credentials.tokenEndpoint);
  await saveMcpAuthMode(extensionId, 'static');

  const discovery = {
    authorizationEndpoint: credentials.authorizationEndpoint,
    tokenEndpoint: credentials.tokenEndpoint,
  };

  const scopes = credentials.scopes ?? [];
  const usePKCE = !credentials.clientSecret; // Use PKCE only if no client secret

  const request = new AuthSession.AuthRequest({
    clientId: credentials.clientId,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
    scopes,
    usePKCE,
    extraParams: {},
  });

  await request.makeAuthUrlAsync(discovery);

  const pendingState: McpOAuthPendingState = {
    extensionId,
    codeVerifier: request.codeVerifier ?? "",
    redirectUri,
    clientId: credentials.clientId,
    tokenEndpoint: credentials.tokenEndpoint,
    extensionName: connectorName ?? "",
    extensionServerUrl: "", // Not applicable for static mode
    extensionNormalizedName: "", // Not applicable for static mode
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
      connector_name: connectorName,
    },
  );

  if (result.type === "success" && result.params.code) {
    log.info(
      "[mcp_oauth] Exchanging code for token (static)",
      {},
      { connector_name: connectorName },
    );
    const tokens = await exchangeAndStore(
      result.params.code,
      credentials.clientId,
      redirectUri,
      request.codeVerifier ?? "",
      credentials.tokenEndpoint,
      extensionId,
      connectorName,
      credentials.clientSecret, // Include client secret if provided
    );
    return { type: "success", ...tokens };
  }

  if (result.type === "error") {
    const detail = (result as any).error_description ?? (result as any).error ?? JSON.stringify((result as any).params ?? result);
    log.error(
      "[mcp_oauth] Static OAuth error",
      {},
      { connector_name: connectorName, result },
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
```

**Important:** Don't forget to add the import at the top:
```typescript
import {
  getMcpClientId,
  getMcpClientSecret,        // NEW
  getMcpRefreshToken,
  getMcpTokenEndpoint,
  saveMcpBearerToken,
  saveMcpClientId,
  saveMcpClientSecret,        // NEW
  saveMcpRefreshToken,
  saveMcpTokenEndpoint,
  saveMcpAuthMode,            // NEW
  getMcpAuthMode,             // NEW (for refresh logic)
} from "./secure-storage";
```

##### 2.1.5 Update exchangeAndStore() Function

Modify function signature and implementation (line 184):

```typescript
async function exchangeAndStore(
  code: string,
  clientId: string,
  redirectUri: string,
  codeVerifier: string,
  tokenEndpoint: string,
  extensionId: string,
  connectorName?: string,
  clientSecret?: string,  // NEW parameter
): Promise<{ accessToken: string; refreshToken?: string }> {
  
  const exchangeConfig: any = {
    code,
    clientId,
    redirectUri,
  };

  // Add client secret for confidential clients (client_secret_post method)
  if (clientSecret) {
    exchangeConfig.clientSecret = clientSecret;
  }

  // Add PKCE verifier for public clients or when using PKCE
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
```

##### 2.1.6 Update refreshMcpAccessToken() Function

Modify function (line 221) to support client secrets:

```typescript
export async function refreshMcpAccessToken(
  extensionId: string,
  connectorName?: string,
): Promise<string | null> {
  const [refreshToken, tokenEndpoint, clientId, clientSecret] = await Promise.all([
    getMcpRefreshToken(extensionId),
    getMcpTokenEndpoint(extensionId),
    getMcpClientId(extensionId),
    getMcpClientSecret(extensionId),  // NEW
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

    // Include client secret for confidential clients
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

    log.info(
      "[mcp_oauth] Token refresh succeeded", 
      {}, 
      { connector_name: connectorName },
    );
    return tokenResponse.accessToken;
  } catch (err) {
    log.warn(
      "[mcp_oauth] Token refresh failed",
      {},
      { 
        connector_name: connectorName, 
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return null;
  }
}
```

##### 2.1.7 Update completeMcpOAuthFromCallbackUrl()

This function needs to handle retrieving the client secret if it was stored (for static mode):

```typescript
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

  // Retrieve client secret if this is a static mode flow
  const clientSecret = await getMcpClientSecret(pendingState.extensionId);

  return exchangeAndStore(
    code,
    pendingState.clientId,
    pendingState.redirectUri,
    pendingState.codeVerifier,
    pendingState.tokenEndpoint,
    pendingState.extensionId,
    undefined,
    clientSecret,  // NEW: pass client secret if available
  );
}
```

---

### Phase 3: UI Enhancement

**File:** `components/settings/McpConnectorConfig.tsx`

#### 3.1 Add Import for New Storage Functions

Update imports (around line 18):

```typescript
import {
  addMcpExtension,
  deleteMcpBearerToken,
  getMcpBearerToken,
  getMcpExtensions,
  getMcpRefreshToken,
  saveMcpBearerToken,
  toNormalizedName,
  uniqueNormalizedName,
  type McpExtensionRecord,
  getMcpClientId,           // NEW
  getMcpClientSecret,       // NEW
  getMcpAuthMode,           // NEW
  saveMcpAuthMode,          // NEW
} from "../../lib/secure-storage";
```

Also update mcp-oauth import:

```typescript
import {
  completeMcpOAuthFromCallbackUrl,
  performMcpOAuthFlow,
  type McpOAuthPendingState,
  type StaticOAuthCredentials,  // NEW
} from "../../lib/mcp-oauth";
```

#### 3.2 Add New State Variables

Add these state variables after existing state declarations (around line 70):

```typescript
const [authMethod, setAuthMethod] = useState<'auto' | 'static'>('auto');
const [staticClientId, setStaticClientId] = useState('');
const [staticClientSecret, setStaticClientSecret] = useState('');
const [staticAuthEndpoint, setStaticAuthEndpoint] = useState('');
const [staticTokenEndpoint, setStaticTokenEndpoint] = useState('');
const [staticScopes, setStaticScopes] = useState('');
const [staticSecretVisible, setStaticSecretVisible] = useState(false);
```

#### 3.3 Update Load Logic (useEffect)

Modify the existing useEffect that loads extension data (around line 72) to also load static credentials:

```typescript
useEffect(() => {
  if (visible && existingExtension) {
    setName(existingExtension.name);
    setServerUrl(existingExtension.serverUrl);
    setNormalizedNamePreview(existingExtension.normalizedName ?? toNormalizedName(existingExtension.name));
    
    Promise.all([
      getMcpBearerToken(existingExtension.id),
      getMcpRefreshToken(existingExtension.id),
      getMcpAuthMode(existingExtension.id),        // NEW
      getMcpClientId(existingExtension.id),        // NEW
      getMcpClientSecret(existingExtension.id),    // NEW
    ]).then(([token, refreshToken, authMode, clientId, clientSecret]) => {
      
      // Detect auth method based on stored data
      if (authMode === 'static') {
        setAuthMethod('static');
        setStaticClientId(clientId ?? '');
        setStaticClientSecret(clientSecret ?? '');
        // Note: We don't store endpoints separately for display,
        // they're only used during OAuth flow. Could add if needed.
      } else if (authMode === 'dcr') {
        setAuthMethod('auto');
      } else if (refreshToken) {
        // Legacy detection: has refresh token = OAuth was used
        setHasOAuthToken(true);
        setAuthMethod('auto');
      } else if (token) {
        // Has bearer token only = manual token mode
        setBearerToken(token);
        setAdvancedExpanded(true);
      }
    });
  } else if (visible) {
    setNormalizedNamePreview("");
    setHasOAuthToken(false);
    setAuthMethod('auto');
    setStaticClientId('');
    setStaticClientSecret('');
    setStaticAuthEndpoint('');
    setStaticTokenEndpoint('');
    setStaticScopes('');
  }
}, [visible, existingExtension]);
```

#### 3.4 Update persistExtension Function

Add auth mode parameter and save it (around line 132):

```typescript
const persistExtension = async (
  id: string,
  manualToken?: string,
  options?: { preserveExistingToken?: boolean; authMode?: 'dcr' | 'static' | 'bearer' },
) => {
  log.info("[mcp_connector] persistExtension start", {}, { id, isEditing, hasManualToken: !!manualToken, preserveExistingToken: options?.preserveExistingToken, authMode: options?.authMode });
  const allExtensions = await getMcpExtensions();
  const normalizedName = uniqueNormalizedName(toNormalizedName(name), allExtensions, existingExtension?.id);
  const record: McpExtensionRecord = { 
    id, 
    name, 
    normalizedName, 
    serverUrl,
    authMode: options?.authMode,  // NEW
  };
  await addMcpExtension(record);
  if (manualToken) {
    await saveMcpBearerToken(id, manualToken);
    if (options?.authMode) {
      await saveMcpAuthMode(id, options.authMode);
    }
  } else if (!options?.preserveExistingToken) {
    await deleteMcpBearerToken(id);
  }
  if (options?.authMode) {
    await saveMcpAuthMode(id, options.authMode);
  }
  DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
  log.info("[mcp_connector] calling onSave", {}, { id });
  onSave?.(record);
  log.info("[mcp_connector] calling resetAndClose", {}, { id });
  resetAndClose();
  Alert.alert(
    isEditing ? "Saved" : "Connected Successfully",
    isEditing
      ? "Extension updated."
      : "Extension added. You can update its config anytime from the Extensions (MCP) screen.",
    [{ text: "OK" }],
  );
};
```

#### 3.5 Update handleSave Function

Replace the existing `handleSave` function (around line 161) to branch on auth method:

```typescript
const handleSave = async () => {
  setIsConnecting(true);
  setConnectingLabel("Connecting…");
  try {
    // NEW: Static credentials mode
    if (authMethod === 'static') {
      // Validate required fields
      if (!staticClientId.trim()) {
        Alert.alert("Missing Field", "Client ID is required for static OAuth.", [{ text: "OK" }]);
        return;
      }
      if (!staticAuthEndpoint.trim() || !staticTokenEndpoint.trim()) {
        Alert.alert("Missing Fields", "Authorization and Token endpoints are required.", [{ text: "OK" }]);
        return;
      }

      const id = existingExtension?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setConnectingLabel("Opening sign-in…");

      const staticCredentials: StaticOAuthCredentials = {
        clientId: staticClientId.trim(),
        clientSecret: staticClientSecret.trim() || undefined,
        authorizationEndpoint: staticAuthEndpoint.trim(),
        tokenEndpoint: staticTokenEndpoint.trim(),
        scopes: staticScopes.trim() ? staticScopes.trim().split(',').map(s => s.trim()) : undefined,
      };

      try {
        onBeforeBrowserOpen?.();
        const oauthResult = await performMcpOAuthFlow(
          id,
          '', // resourceMetadataUrl not used for static mode
          name,
          undefined, // extensionInfo not used for static mode
          staticCredentials,
        );

        log.info("[mcp_connector] Static OAuth flow returned", {}, { oauthResult_type: oauthResult.type });

        if (oauthResult.type === "success") {
          await persistExtension(id, undefined, { preserveExistingToken: true, authMode: 'static' });
        } else {
          setPendingOAuth(oauthResult.pendingState);
          setPendingExtensionId(id);
          onNeedsManualCallback?.();
        }
      } catch (oauthError: any) {
        log.error("[mcp_connector] Static OAuth error caught", {}, { message: oauthError?.message });
        Alert.alert(
          "Authentication Failed",
          oauthError?.message ?? "OAuth sign-in failed.",
          [{ text: "OK" }],
        );
      }
      return;
    }

    // EXISTING: Auto (DCR) mode
    const token = bearerToken.trim() || undefined;
    const result = await probeMcpServer(serverUrl, token, name);

    if (result.success) {
      const id = existingExtension?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await persistExtension(id, token, { authMode: token ? 'bearer' : undefined });
    } else if (result.statusCode === 401 && result.resourceMetadataUrl) {
      const id = existingExtension?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setConnectingLabel("Opening sign-in…");
      const allExtensions = await getMcpExtensions();
      const normalizedName = uniqueNormalizedName(toNormalizedName(name), allExtensions, existingExtension?.id);
      log.info("[mcp_connector] entering OAuth branch", {}, { id, serverUrl, normalizedName, resourceMetadataUrl: result.resourceMetadataUrl });
      try {
        onBeforeBrowserOpen?.();
        const oauthResult = await performMcpOAuthFlow(id, result.resourceMetadataUrl, name, { serverUrl, normalizedName });
        log.info("[mcp_connector] OAuth flow returned", {}, { oauthResult_type: oauthResult.type });
        if (oauthResult.type === "success") {
          await persistExtension(id, undefined, { preserveExistingToken: true, authMode: 'dcr' });
        } else {
          setPendingOAuth(oauthResult.pendingState);
          setPendingExtensionId(id);
          onNeedsManualCallback?.();
        }
      } catch (oauthError: any) {
        log.error("[mcp_connector] oauthError caught", {}, { message: oauthError?.message });
        Alert.alert(
          "Authentication Failed",
          oauthError?.message ?? "OAuth sign-in failed.",
          [{ text: "OK" }],
        );
      }
    } else if (result.statusCode === 401) {
      Alert.alert(
        "Authentication Required",
        "This server requires a Bearer token. Enter it in the Advanced section.",
        [{ text: "OK" }],
      );
    } else {
      const detail = result.error ?? `Server returned ${result.statusCode}`;
      Alert.alert("Connection Failed", detail, [{ text: "OK" }]);
    }
  } finally {
    log.info("[mcp_connector] handleSave finally — clearing isConnecting");
    setIsConnecting(false);
    setConnectingLabel("Connecting…");
  }
};
```

#### 3.6 Update resetAndClose Function

Add new fields to reset (around line 229):

```typescript
const resetAndClose = () => {
  log.info("[mcp_connector] resetAndClose");
  setName("");
  setServerUrl("");
  setBearerToken("");
  setNormalizedNamePreview("");
  setAdvancedExpanded(false);
  setTokenVisible(false);
  setHasOAuthToken(false);
  setPendingOAuth(null);
  setPendingExtensionId(null);
  setCallbackUrl("");
  setCallbackError("");
  setAuthMethod('auto');           // NEW
  setStaticClientId('');           // NEW
  setStaticClientSecret('');       // NEW
  setStaticAuthEndpoint('');       // NEW
  setStaticTokenEndpoint('');      // NEW
  setStaticScopes('');             // NEW
  setStaticSecretVisible(false);   // NEW
  onClose();
};
```

#### 3.7 Add UI Components for Static OAuth

Find the "Advanced" section in the JSX (search for "Advanced" text, around line 400+). Add a new section BEFORE the bearer token section:

```tsx
{/* OAuth Configuration Method */}
<View style={styles.section}>
  <Text style={styles.label}>OAuth Method</Text>
  <View style={styles.segmentControl}>
    <Pressable
      style={[
        styles.segment,
        authMethod === 'auto' && styles.segmentActive,
      ]}
      onPress={() => setAuthMethod('auto')}
    >
      <Text
        style={[
          styles.segmentText,
          authMethod === 'auto' && styles.segmentTextActive,
        ]}
      >
        Auto (DCR)
      </Text>
    </Pressable>
    <Pressable
      style={[
        styles.segment,
        authMethod === 'static' && styles.segmentActive,
      ]}
      onPress={() => setAuthMethod('static')}
    >
      <Text
        style={[
          styles.segmentText,
          authMethod === 'static' && styles.segmentTextActive,
        ]}
      >
        Static Credentials
      </Text>
    </Pressable>
  </View>
  <Text style={styles.hint}>
    {authMethod === 'auto'
      ? "Automatically discover OAuth endpoints and register client (Dynamic Client Registration)."
      : "Use pre-existing OAuth client credentials with manually configured endpoints."}
  </Text>
</View>

{/* Static OAuth Fields (only shown when authMethod === 'static') */}
{authMethod === 'static' && (
  <>
    <View style={styles.section}>
      <Text style={styles.label}>Client ID *</Text>
      <TextInput
        style={styles.input}
        value={staticClientId}
        onChangeText={setStaticClientId}
        placeholder="your-client-id"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>

    <View style={styles.section}>
      <Text style={styles.label}>Client Secret (optional)</Text>
      <View style={styles.passwordContainer}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          value={staticClientSecret}
          onChangeText={setStaticClientSecret}
          placeholder="Optional for confidential clients"
          secureTextEntry={!staticSecretVisible}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          style={styles.eyeButton}
          onPress={() => setStaticSecretVisible(!staticSecretVisible)}
        >
          <Text style={styles.eyeButtonText}>
            {staticSecretVisible ? "👁️" : "👁️‍🗨️"}
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Leave blank for public clients (uses PKCE only). Provide for confidential clients.
      </Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.label}>Authorization Endpoint *</Text>
      <TextInput
        style={styles.input}
        value={staticAuthEndpoint}
        onChangeText={setStaticAuthEndpoint}
        placeholder="https://provider.com/oauth/authorize"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
    </View>

    <View style={styles.section}>
      <Text style={styles.label}>Token Endpoint *</Text>
      <TextInput
        style={styles.input}
        value={staticTokenEndpoint}
        onChangeText={setStaticTokenEndpoint}
        placeholder="https://provider.com/oauth/token"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
    </View>

    <View style={styles.section}>
      <Text style={styles.label}>Scopes (optional)</Text>
      <TextInput
        style={styles.input}
        value={staticScopes}
        onChangeText={setStaticScopes}
        placeholder="read, write, openid"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.hint}>
        Comma-separated list of OAuth scopes to request.
      </Text>
    </View>
  </>
)}

{/* Existing Bearer Token section (only shown when authMethod === 'auto') */}
{authMethod === 'auto' && (
  // ... existing bearer token UI ...
)}
```

#### 3.8 Add Styles

Add these styles to the StyleSheet (around line 600+):

```typescript
segmentControl: {
  flexDirection: "row",
  backgroundColor: "#f0f0f0",
  borderRadius: 8,
  padding: 2,
},
segment: {
  flex: 1,
  paddingVertical: 8,
  paddingHorizontal: 12,
  alignItems: "center",
  borderRadius: 6,
},
segmentActive: {
  backgroundColor: "#fff",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.1,
  shadowRadius: 2,
  elevation: 2,
},
segmentText: {
  fontSize: 14,
  color: "#666",
  fontWeight: "500",
},
segmentTextActive: {
  color: "#000",
  fontWeight: "600",
},
passwordContainer: {
  position: "relative",
},
passwordInput: {
  paddingRight: 50,
},
eyeButton: {
  position: "absolute",
  right: 12,
  top: 12,
  padding: 4,
},
eyeButtonText: {
  fontSize: 20,
},
```

---

### Phase 4: Testing & Validation

#### 4.1 Test Scenarios

Create test cases for the following scenarios:

**Test 1: DCR Flow (Regression Test)**
- Create new MCP connector with server that supports DCR
- Verify auto-discovery works
- Verify client registration happens
- Verify OAuth flow completes
- Verify tokens are stored correctly
- Verify connector works after setup

**Test 2: Static Public Client (PKCE)**
- Create new connector with auth method = "Static Credentials"
- Provide: client_id, auth endpoint, token endpoint (NO secret)
- Verify PKCE is used
- Verify OAuth flow completes
- Verify tokens work
- Test token refresh

**Test 3: Static Confidential Client (with Secret)**
- Create connector with static credentials
- Provide: client_id, client_secret, endpoints
- Verify client_secret is included in token exchange
- Verify tokens work
- Test token refresh with secret

**Test 4: Mixed Connectors**
- Have 2-3 connectors: one DCR, one static public, one static confidential
- Verify they all work independently
- Verify token refresh works for each

**Test 5: Edit Existing Connector**
- Create connector with DCR
- Edit it and switch to static mode
- Verify old credentials are cleared
- Verify new flow works
- Test reverse (static → DCR)

**Test 6: Manual Callback (Browser Dismissed)**
- Start OAuth flow (DCR or static)
- Dismiss browser before completing
- Verify manual paste UI appears
- Paste valid callback URL
- Verify flow completes

**Test 7: Error Handling**
- Invalid endpoints
- Wrong client credentials
- Network errors during OAuth
- Token refresh failures

#### 4.2 Validation Checklist

Before considering complete, verify:

- [ ] No TypeScript errors
- [ ] All existing DCR connectors continue working
- [ ] Static mode skips server probe (no unnecessary network call)
- [ ] Client secrets stored in secure keychain (not AsyncStorage)
- [ ] Sensitive data (secrets, tokens) never logged
- [ ] UI clearly distinguishes between auth methods
- [ ] Form validation prevents saving incomplete config
- [ ] Token refresh works for both DCR and static modes
- [ ] Clearing/deleting connector removes all stored credentials
- [ ] No memory leaks or state issues when switching between modes

---

## Implementation Checklist

Use this checklist to track progress:

### Phase 1: Storage
- [ ] Add storage constants
- [ ] Update `McpExtensionRecord` interface
- [ ] Add client secret storage functions
- [ ] Add auth mode storage functions
- [ ] Update `clearMcpAuthCredentials()`
- [ ] Update `clearAllStoredSecrets()`

### Phase 2: OAuth Logic
- [ ] Add `StaticOAuthCredentials` interface
- [ ] Update `performMcpOAuthFlow()` signature
- [ ] Add static credentials branch
- [ ] Implement `performStaticOAuthFlow()`
- [ ] Update `exchangeAndStore()` for client secrets
- [ ] Update `refreshMcpAccessToken()` for client secrets
- [ ] Update `completeMcpOAuthFromCallbackUrl()`
- [ ] Add all necessary imports

### Phase 3: UI
- [ ] Update imports
- [ ] Add state variables
- [ ] Update load logic (useEffect)
- [ ] Update `persistExtension()` 
- [ ] Update `handleSave()`
- [ ] Update `resetAndClose()`
- [ ] Add OAuth method selector UI
- [ ] Add static credentials input fields
- [ ] Add conditional rendering logic
- [ ] Add styles

### Phase 4: Testing
- [ ] Test DCR flow (regression)
- [ ] Test static public client
- [ ] Test static confidential client
- [ ] Test mixed connectors
- [ ] Test editing connectors
- [ ] Test manual callback flow
- [ ] Test error handling
- [ ] Run validation checklist

---

## Notes for Implementation

### Security Considerations

1. **Never log sensitive data**: Client secrets, tokens, and authorization codes should never appear in logs
2. **Use secure storage**: All secrets must use `setCachedValue` which uses iOS Keychain
3. **Sanitize logs**: When logging, use `[REDACTED]` for sensitive fields
4. **Clear on delete**: When deleting a connector, ensure ALL credentials are removed

### Common Pitfalls

1. **Don't use PKCE with client_secret**: If client secret is provided, PKCE is optional (set `usePKCE: false`)
2. **Token endpoint auth method**: expo-auth-session uses `client_secret_post` by default when `clientSecret` is provided
3. **Scope formatting**: Scopes should be an array, not a space-separated string
4. **Redirect URI**: Must be consistent across registration, authorization, and token exchange

### Expo AuthSession Reference

Key methods being used:
- `AuthSession.makeRedirectUri()` - generates redirect URI
- `AuthSession.AuthRequest` - builds authorization request
- `AuthSession.exchangeCodeAsync()` - exchanges code for tokens
- `AuthSession.refreshAsync()` - refreshes access token

Documentation: https://docs.expo.dev/versions/latest/sdk/auth-session/

---

## Questions or Issues?

If you encounter issues during implementation:

1. Check the expo-auth-session documentation
2. Verify all imports are correct
3. Check logs for error details (search for `[mcp_oauth]` and `[mcp_extensions]`)
4. Test with a known working OAuth provider first (e.g., Google, GitHub)
5. Use a tool like OAuth Debugger to validate OAuth flow independently

Good luck! 🚀
