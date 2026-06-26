# Plan: Fix `invalid_client` Refresh Failure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## RCA Validation

**What the incident RCA claimed:** `client_id` was missing from the token refresh POST body.

**What the code actually does:** `refreshMcpAccessToken` (lib/mcp-oauth.ts:296-306) _does_ include `clientId` in `refreshConfig.clientId` before calling `AuthSession.refreshAsync`. The guard at line 283 (`if (!refreshToken || !tokenEndpoint || !clientId) return null`) ensures the server is never contacted without a `clientId`. The POST body is correct per OAuth 2.1 `client_secret_post`.

**Confirmed gap in the RCA:** The "Refreshing access token" log (line 287-292) records `has_client_secret` but not `has_client_id`. The field `extension_id` logged there is arty's internal UUID — not the OAuth `client_id`. These are different values; the RCA author conflated them. This logging gap made it look like `client_id` was absent when it was not.

**Actual root cause:** The stored OAuth client credentials were valid (non-null, passed the early-return guard) but the Brain3 auth server rejected them with `invalid_client`. This means the credentials are stale or mismatched — most likely one of:

- **DCR expiry**: Brain3 allowed the DCR client registration to expire. The stored `clientId` is no longer recognized.
- **Secret rotation**: The `clientSecret` on Brain3's server was rotated and the stored copy is stale.

**Secondary bug not fixed by this plan:** `initializeSecureStorageCache` does not pre-load MCP per-extension keys, so in WebRTC/background contexts the refresh token returns null without even reaching the server. That scenario is documented and fixed separately in `2026-06-25-refresh-oauth-token.md`.

## Problem

When `AuthSession.refreshAsync` receives an `invalid_client` OAuth error back from Brain3:

1. The catch block in `refreshMcpAccessToken` logs only `error.message` (not the OAuth error code) and returns `null`.
2. `refreshTokenSingleFlight` propagates `null` to `ToolkitManager`.
3. `ToolkitManager` emits `MCP_REAUTH_REQUIRED_EVENT` and throws "needs to sign in again".
4. The user opens the browser and logs in manually.
5. For **DCR mode** — `performMcpOAuthFlow` checks `getMcpClientId(extensionId)` and reuses the same stale `clientId` (line 85-87), so the next refresh will fail with `invalid_client` again.
6. For **static mode** — re-auth saves the user-configured `clientId`/`clientSecret` from the form again, which does reset correct values, so re-auth genuinely fixes it for static connectors.

## Fix

### 1. Log `has_client_id` and the OAuth error code

**File: `lib/mcp-oauth.ts`**

In `refreshMcpAccessToken`, add `has_client_id` to the pre-refresh log so future incidents reveal whether the lookup returned a value. Also log the OAuth `error` field from the caught error when available.

Change the pre-refresh log block:

```typescript
log.info(
  "[mcp_oauth] Refreshing access token",
  {},
  {
    extension_id: extensionId,
    connector_name: connectorName,
    has_client_id: !!clientId,
    has_client_secret: !!clientSecret,
  },
);
```

Change the catch block to extract the OAuth error code when present:

```typescript
} catch (err) {
  const oauthCode =
    (err as any)?.code ??
    (err as any)?.error ??
    (typeof (err as any)?.message === "string" && (err as any).message.match(/\b(invalid_\w+|unauthorized_client|access_denied)\b/)?.[0]) ??
    undefined;
  log.warn(
    "[mcp_oauth] Token refresh failed",
    {},
    {
      connector_name: connectorName,
      error: err instanceof Error ? err.message : String(err),
      oauth_error_code: oauthCode,
    },
  );
  return null;
}
```

### 2. Clear stale DCR `clientId` on `invalid_client` so re-registration fires

**File: `lib/mcp-oauth.ts`**

When the refresh failure is `invalid_client` _and_ the extension is in DCR mode, the stored `clientId` is the expired registration. The next full OAuth flow (triggered by `MCP_REAUTH_REQUIRED_EVENT`) will call `performMcpOAuthFlow`, which checks `getMcpClientId(extensionId)` — if the stale ID is still there, it reuses it. Clear it so `registerOAuthClient` is called fresh.

Import `getMcpAuthMode` and `deleteCachedValue` (or use the already-imported `getMcpClientId`/`saveMcpClientId` pattern — use `deleteMcpClientId` described below).

Add a `deleteMcpClientId` helper in `lib/secure-storage.ts` (next to `deleteMcpClientSecret`):

```typescript
export async function deleteMcpClientId(id: string): Promise<void> {
  try {
    await deleteCachedValue(`${MCP_CLIENT_ID_PREFIX}${id}`);
  } catch {
    // may not exist
  }
}
```

Import `getMcpAuthMode` and `deleteMcpClientId` in `lib/mcp-oauth.ts`. In the catch block of `refreshMcpAccessToken`, after extracting `oauthCode`, add:

```typescript
if (oauthCode === "invalid_client") {
  const mode = await getMcpAuthMode(extensionId).catch(() => null);
  if (mode === "dcr") {
    await deleteMcpClientId(extensionId).catch(() => {});
    log.info(
      "[mcp_oauth] Cleared stale DCR client_id after invalid_client",
      {},
      { extension_id: extensionId },
    );
  }
}
```

This is safe for static mode because `oauthCode === "invalid_client"` in static mode means the user's configured credentials are wrong — clearing the DCR `clientId` is a no-op for static mode since `getMcpAuthMode` returns `"static"` and the branch is skipped.

## Files Changed

| File | Change |
|------|--------|
| `lib/mcp-oauth.ts` | Add `has_client_id` to pre-refresh log; parse OAuth error code in catch; clear stale DCR `clientId` on `invalid_client` |
| `lib/secure-storage.ts` | Add `deleteMcpClientId` helper |
| `lib/__tests__/mcp-oauth.test.ts` | Add test: refresh with `invalid_client` error clears DCR `clientId`; static mode does not clear |

---

## Tasks

### Task 1: Add `deleteMcpClientId` to secure-storage

**Files:**
- Modify: `lib/secure-storage.ts`

- [ ] **Step 1: Add `deleteMcpClientId` after `deleteMcpClientSecret`**

In `lib/secure-storage.ts`, directly after the `deleteMcpClientSecret` function (around line 906), add:

```typescript
export async function deleteMcpClientId(id: string): Promise<void> {
  try {
    await deleteCachedValue(`${MCP_CLIENT_ID_PREFIX}${id}`);
  } catch {
    // may not exist
  }
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit --pretty false
```

Expected: exits 0, no errors.

---

### Task 2: Improve refresh logging and add `invalid_client` DCR recovery

**Files:**
- Modify: `lib/mcp-oauth.ts`

- [ ] **Step 1: Add `getMcpAuthMode` and `deleteMcpClientId` to imports from `./secure-storage`**

In the import block at the top of `lib/mcp-oauth.ts`, add `getMcpAuthMode` and `deleteMcpClientId`:

```typescript
import {
  deleteMcpClientSecret,
  deleteMcpClientId,
  getMcpAuthMode,
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
```

- [ ] **Step 2: Add `has_client_id` to the pre-refresh log**

In `refreshMcpAccessToken`, find the `log.info("[mcp_oauth] Refreshing access token", ...)` call and update it:

```typescript
log.info(
  "[mcp_oauth] Refreshing access token",
  {},
  {
    extension_id: extensionId,
    connector_name: connectorName,
    has_client_id: !!clientId,
    has_client_secret: !!clientSecret,
  },
);
```

- [ ] **Step 3: Update the catch block to extract and act on the OAuth error code**

Replace the existing catch block in `refreshMcpAccessToken`:

```typescript
  } catch (err) {
    const oauthCode =
      (err as any)?.code ??
      (err as any)?.error ??
      (typeof (err as any)?.message === "string"
        ? (err as any).message.match(/\b(invalid_\w+|unauthorized_client|access_denied)\b/)?.[0]
        : undefined) ??
      undefined;
    log.warn(
      "[mcp_oauth] Token refresh failed",
      {},
      {
        connector_name: connectorName,
        error: err instanceof Error ? err.message : String(err),
        oauth_error_code: oauthCode,
      },
    );
    if (oauthCode === "invalid_client") {
      const mode = await getMcpAuthMode(extensionId).catch(() => null);
      if (mode === "dcr") {
        await deleteMcpClientId(extensionId).catch(() => {});
        log.info(
          "[mcp_oauth] Cleared stale DCR client_id after invalid_client",
          {},
          { extension_id: extensionId },
        );
      }
    }
    return null;
  }
```

- [ ] **Step 4: Run TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit --pretty false
```

Expected: exits 0, no errors.

---

### Task 3: Add tests for the new behaviour

**Files:**
- Modify: `lib/__tests__/mcp-oauth.test.ts`

- [ ] **Step 1: Add an `invalid_client` refresh test for DCR mode**

In `mcp-oauth.test.ts`, inside the `describe("refreshMcpAccessToken", ...)` block, add two new tests after the existing one:

```typescript
  test("clears DCR client_id when refresh fails with invalid_client", async () => {
    secureState.clientId = "dcr-client-id";
    secureState.clientSecret = null;
    secureState.refreshToken = "stored-refresh-token";
    secureState.tokenEndpoint = "https://provider.example.com/token";

    // Patch refreshAsync to throw with invalid_client
    const { refreshAsync: _orig } = await import("expo-auth-session");
    const authSessionMod = await import("expo-auth-session");
    const origRefresh = authSessionMod.refreshAsync;
    (authSessionMod as any).refreshAsync = async () => {
      const err: any = new Error("invalid_client");
      err.error = "invalid_client";
      throw err;
    };

    // Patch getMcpAuthMode to return "dcr"
    const storageMod = await import("../secure-storage");
    const origAuthMode = storageMod.getMcpAuthMode;
    (storageMod as any).getMcpAuthMode = async () => "dcr";
    let deletedId: string | null = null;
    const origDeleteClientId = storageMod.deleteMcpClientId;
    (storageMod as any).deleteMcpClientId = async (id: string) => { deletedId = id; };

    const token = await oauthModule.refreshMcpAccessToken("extension-dcr", "DCR Connector");

    expect(token).toBeNull();
    expect(deletedId).toBe("extension-dcr");

    // Restore
    (authSessionMod as any).refreshAsync = origRefresh;
    (storageMod as any).getMcpAuthMode = origAuthMode;
    (storageMod as any).deleteMcpClientId = origDeleteClientId;
  });

  test("does not clear client_id for static mode on invalid_client", async () => {
    secureState.clientId = "static-client-id";
    secureState.clientSecret = "stored-static-secret";
    secureState.refreshToken = "stored-refresh-token";
    secureState.tokenEndpoint = "https://provider.example.com/token";

    const authSessionMod = await import("expo-auth-session");
    const origRefresh = authSessionMod.refreshAsync;
    (authSessionMod as any).refreshAsync = async () => {
      const err: any = new Error("invalid_client");
      err.error = "invalid_client";
      throw err;
    };

    const storageMod = await import("../secure-storage");
    const origAuthMode = storageMod.getMcpAuthMode;
    (storageMod as any).getMcpAuthMode = async () => "static";
    let deletedId: string | null = null;
    const origDeleteClientId = storageMod.deleteMcpClientId;
    (storageMod as any).deleteMcpClientId = async (id: string) => { deletedId = id; };

    const token = await oauthModule.refreshMcpAccessToken("extension-static", "Static Connector");

    expect(token).toBeNull();
    expect(deletedId).toBeNull(); // must NOT clear for static mode

    // Restore
    (authSessionMod as any).refreshAsync = origRefresh;
    (storageMod as any).getMcpAuthMode = origAuthMode;
    (storageMod as any).deleteMcpClientId = origDeleteClientId;
  });
```

- [ ] **Step 2: Run all OAuth tests**

```bash
bun test lib/__tests__/mcp-oauth.test.ts
```

Expected:

```text
5 pass
0 fail
```

- [ ] **Step 3: Run TypeScript check**

```bash
./node_modules/.bin/tsc --noEmit --pretty false
```

Expected: exits 0, no errors.

---

## Manual QA

- [ ] Configure a Brain3 MCP connector in static OAuth mode.
- [ ] Manually corrupt the stored `client_secret` (via factory reset and re-save with wrong value) so the next refresh fails with `invalid_client`.
- [ ] Trigger a tool call that returns 401 to exercise the refresh path.
- [ ] Confirm Logfire shows `oauth_error_code: "invalid_client"` in the "Token refresh failed" log entry.
- [ ] Confirm `has_client_id: true` appears in the "Refreshing access token" log entry.
- [ ] For a DCR connector: confirm after `invalid_client` that `getMcpClientId` returns null (stale entry cleared) and re-auth triggers fresh DCR registration.

---

## Self-Review

- Spec coverage: logging gap (has_client_id), error code extraction, DCR stale-registration recovery, static-mode guard.
- No behaviour change for the happy path (successful refresh).
- `deleteMcpClientId` mirrors the existing `deleteMcpClientSecret` pattern exactly.
- The `invalid_client` check is gated on `mode === "dcr"` so static connectors are unaffected.
- Tests cover both DCR-clears and static-does-not-clear branches.
