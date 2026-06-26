# Plan: Use Refresh Token to Avoid Re-Auth

## Root Cause

`initializeSecureStorageCache()` in `lib/secure-storage.ts` pre-loads only 7
hardcoded global keys at app startup. It does **not** pre-load per-extension MCP
keys (bearer token, refresh token, client ID, client secret, token endpoint, auth
mode). These are dynamically named `${PREFIX}${extensionId}`.

The in-memory cache is the only way to read SecureStore during WebRTC/background
states — the code comment says:

> SecureStore is not accessible when the device screen is locked or during certain
> app lifecycle states (background, WebRTC event handlers, etc.)

**Sequence that causes re-auth today:**

1. App restarts (or hasn't seen this extension yet this session).
2. A tool call is made → server returns 401.
3. `ToolkitManager` calls `refreshTokenSingleFlight` → `refreshMcpAccessToken`.
4. `getMcpRefreshToken(extensionId)` → `getCachedValue(MCP_REFRESH_TOKEN_PREFIX + id)`
   → **cache miss** (key was never loaded at startup).
5. Falls back to `SecureStore.getItemAsync()` — but the call originates from a
   WebRTC/background handler → SecureStore throws or returns null.
6. `getCachedValue` writes `null` into the cache (poisoning the entry), returns `null`.
7. `refreshMcpAccessToken` returns `null` → `MCP_REAUTH_REQUIRED_EVENT` emitted
   → user prompted to sign in again.

The cache-poison problem (step 6) also means that even if SecureStore becomes
accessible later in the session, the null is served from cache and the refresh
token is never picked up without an app restart.

## What Already Works

- `refreshMcpAccessToken` (`lib/mcp-oauth.ts`) is fully implemented: reads refresh
  token + token endpoint + client ID + client secret, calls
  `AuthSession.refreshAsync`, saves the new access token and the rotated refresh
  token.
- `ToolkitManager.ts` already has the 401 → refresh → retry loop for both tool
  calls and tool discovery. Single-flight deduplication is in place.
- `saveMcpRefreshToken` is called during the initial `exchangeAndStore` and after
  each successful refresh. Brain3 rotates refresh tokens (confirmed by
  `refresh_rotates_refresh_token_and_replaces_old_access_token` test), and the
  save logic handles this correctly.
- The factory-reset function already iterates extensions and pushes all 6
  per-extension MCP keys — the pattern is established.

## Fix

**File: `lib/secure-storage.ts`**

Extend `initializeSecureStorageCache()` to also pre-load per-extension MCP keys,
following the same pattern used in the factory-reset function (line ~1049):

```typescript
export async function initializeSecureStorageCache(): Promise<void> {
  const keys = [
    OPENAI_API_KEY,
    GITHUB_TOKEN_KEY,
    GDRIVE_CLIENT_ID_OVERRIDE_KEY,
    GDRIVE_ACCESS_TOKEN_KEY,
    GDRIVE_REFRESH_TOKEN_KEY,
    LOGFIRE_API_KEY,
    CONTEXT7_API_KEY,
  ];

  // Pre-load per-extension MCP keys so they are available during
  // WebRTC/background states where SecureStore is inaccessible.
  const mcpExtensions = await getMcpExtensions().catch(() => [] as McpExtensionRecord[]);
  for (const ext of mcpExtensions) {
    keys.push(
      `${MCP_TOKEN_PREFIX}${ext.id}`,
      `${MCP_CLIENT_ID_PREFIX}${ext.id}`,
      `${MCP_CLIENT_SECRET_PREFIX}${ext.id}`,
      `${MCP_REFRESH_TOKEN_PREFIX}${ext.id}`,
      `${MCP_TOKEN_ENDPOINT_PREFIX}${ext.id}`,
      `${MCP_AUTH_MODE_PREFIX}${ext.id}`,
    );
  }

  // ... rest of the function unchanged (Promise.allSettled load, logging, etc.)
}
```

`initializeSecureStorageCache()` is called in `app/_layout.tsx` at app startup
while the app is foregrounded — exactly when SecureStore is guaranteed accessible.
After this change, all refresh tokens are in cache before any tool calls, and the
401 → refresh → retry loop in `ToolkitManager` will succeed without prompting the
user to re-authenticate.

## Files Changed

| File | Change |
|------|--------|
| `lib/secure-storage.ts` | Pre-load per-extension MCP keys in `initializeSecureStorageCache()` |

## No Other Changes Needed

The refresh flow, token rotation save, and 401-retry loop are all already
correct. This one cache pre-population fix is all that's needed.
