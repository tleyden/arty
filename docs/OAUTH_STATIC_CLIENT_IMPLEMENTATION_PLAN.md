# OAuth2 Static Client Credentials Implementation Plan

## Overview

This document describes the design and implementation of static client ID/secret support in the MCP OAuth2 client. The key insight: static mode uses the **same OAuth endpoint discovery** as DCR — it just skips dynamic client registration and uses the pre-provided `client_id` instead.

This matches how other AI clients (Claude Desktop, Cursor, etc.) work: users only need to provide the MCP server URL, client ID, and optional client secret. The app discovers auth/token endpoints automatically.

---

## Design Principle: Discovery-First

**Wrong approach (old plan):** Ask users for auth endpoint, token endpoint, and scopes.

**Correct approach (current implementation):** Both DCR and static modes share the same discovery flow:
1. Probe MCP server → get `401` with `resource_metadata_url`
2. Fetch resource metadata → get `authorization_servers`
3. Fetch `/.well-known/oauth-authorization-server` → get `authorization_endpoint` and `token_endpoint`

The only difference between DCR and static:
- **DCR:** Register a new public client at `registration_endpoint`, get back a `client_id`
- **Static:** Skip registration, use the provided `client_id` (and optional `client_secret`)

---

## What Users Provide

| Field | Required | Notes |
|-------|----------|-------|
| MCP Server URL | ✅ | Already on the main form |
| Client ID | ✅ | Shown in static mode |
| Client Secret | optional | For confidential clients; omit for public clients (PKCE only) |

Auth/token endpoints, scopes — all auto-discovered. Users never see them.

---

## Architecture

### `StaticOAuthCredentials` interface (`lib/mcp-oauth.ts`)

```typescript
export interface StaticOAuthCredentials {
  clientId: string;
  clientSecret?: string;  // omit for public clients
}
```

### `performMcpOAuthFlow()` — unified flow

Both DCR and static call the same discovery steps. The `staticCredentials` parameter controls which client credential path is taken:

```
performMcpOAuthFlow(extensionId, resourceMetadataUrl, ..., staticCredentials?)
  ├── fetchResourceMetadata(resourceMetadataUrl)       ← shared
  ├── fetchOAuthServerMetadata(authServerUrl)          ← shared
  ├── if staticCredentials:
  │     clientId = staticCredentials.clientId          ← use provided
  │     clientSecret = staticCredentials.clientSecret
  │     saveMcpAuthMode("static")
  └── else (DCR):
        clientId = cached || register new client       ← register
        saveMcpAuthMode("dcr")
  └── AuthSession.AuthRequest + promptAsync            ← shared
  └── exchangeAndStore(code, ..., clientSecret?)       ← shared
```

### `handleSave()` static branch (`McpConnectorConfig.tsx`)

```
1. probeMcpServer(serverUrl) → 401 + resourceMetadataUrl
2. performMcpOAuthFlow(id, resourceMetadataUrl, ..., { clientId, clientSecret })
```

No separate probe needed for DCR — that already happens in the existing `result.statusCode === 401` branch.

---

## Storage

Per-extension secure storage (unchanged from DCR, just `auth_mode` differs):

```
MCP_TOKEN_PREFIX + id          → access/bearer token
MCP_CLIENT_ID_PREFIX + id      → client_id (static: provided; dcr: registered)
MCP_CLIENT_SECRET_PREFIX + id  → client_secret (static only; dcr: never stored)
MCP_REFRESH_TOKEN_PREFIX + id  → refresh token
MCP_TOKEN_ENDPOINT_PREFIX + id → discovered token endpoint
MCP_AUTH_MODE_PREFIX + id      → "static" | "dcr" | "bearer"
```

---

## Implementation Status

### Phase 1: Storage Layer ✅ Complete
- `MCP_CLIENT_SECRET_PREFIX` / `MCP_AUTH_MODE_PREFIX` constants added
- `McpExtensionRecord.authMode` field added
- `saveMcpClientSecret` / `getMcpClientSecret` / `deleteMcpClientSecret` implemented
- `saveMcpAuthMode` / `getMcpAuthMode` implemented
- `clearMcpAuthCredentials()` clears client secret and auth mode
- `clearAllStoredSecrets()` includes new keys

### Phase 2: OAuth Flow ✅ Complete
- `StaticOAuthCredentials` — only `clientId` + optional `clientSecret` (no endpoints)
- `performMcpOAuthFlow()` — unified function; both modes share discovery
- `exchangeAndStore()` — handles optional `clientSecret`
- `refreshMcpAccessToken()` — retrieves and uses stored client secret
- `completeMcpOAuthFromCallbackUrl()` — retrieves client secret for manual callback

### Phase 3: UI ✅ Complete
- **Static mode fields:** Client ID + Client Secret only (no endpoint/scope inputs)
- **Hint text:** "Endpoints are auto-discovered from the MCP server"
- `handleSave()` static branch: probes server first, then calls `performMcpOAuthFlow`
- `validateMcpConnectorForm()`: only requires `clientId` in static mode
- `buildStaticOAuthCredentials()`: builds `{ clientId, clientSecret? }` only
- Auth mode toggle: "Auto (DCR)" vs "Static Credentials"

---

## Test Scenarios

### Static Public Client (PKCE, no secret)
1. User enters: MCP server URL, Client ID
2. App probes server → discovers endpoints automatically
3. OAuth flow with PKCE (no client secret)
4. Token stored and connector works

### Static Confidential Client (with secret)
1. User enters: MCP server URL, Client ID, Client Secret
2. App probes server → discovers endpoints automatically
3. OAuth flow using `client_secret_post` (no PKCE)
4. Secret stored in keychain, used for refresh

### DCR Flow (regression)
- Unchanged from before: no static credentials provided
- Server must support `registration_endpoint`

### Edit existing static connector
- Re-opening shows Client ID and Client Secret pre-filled
- Saving re-runs OAuth with existing credentials

### Manual callback (browser dismissed)
- Works for both DCR and static; client secret retrieved from storage for token exchange

---

## Notes

- **PKCE strategy:** `usePKCE = !clientSecret` — public clients always use PKCE; confidential clients skip it (some servers don't support both simultaneously)
- **Scopes:** Not configurable by user; MCP servers advertise required scopes via the OAuth flow itself
- **Endpoint persistence:** Token endpoint is stored for refresh token use; auth endpoint is re-discovered each time the user re-authenticates (by probing the server)
