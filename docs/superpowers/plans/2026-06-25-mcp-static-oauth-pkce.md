# MCP Static OAuth PKCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCP OAuth use PKCE by default for static client ID and client secret authorization-code flows.

**Architecture:** Keep OAuth flow ownership in `lib/mcp-oauth.ts`, where Expo AuthSession already creates the authorization request and stores the in-memory `codeVerifier` in `McpOAuthPendingState`. Change the static secret flow so the authorization request always enables PKCE, while token exchange and refresh still include the static client secret when one is configured.

**Tech Stack:** Expo AuthSession, Expo React Native, Bun test, TypeScript.

---

## File Structure

- Modify `lib/__tests__/mcp-oauth.test.ts`: update the current static-client test from "disables PKCE" to "requires PKCE", and add manual callback coverage that proves `code_verifier` is sent even when a static client secret is restored.
- Modify `lib/mcp-oauth.ts`: change the `AuthSession.AuthRequest` configuration so MCP OAuth always sets `usePKCE: true`.
- No UI files need to change. `components/settings/McpConnectorConfig.tsx` already passes static client credentials into `performMcpOAuthFlow`, and `pendingOAuth` is held in React state only.
- No storage migration is needed. The code verifier remains transient: it is generated per auth request, copied into `McpOAuthPendingState` for the active manual callback flow, and cleared by existing modal reset paths.

---

### Task 1: Update Static OAuth Tests For PKCE

**Files:**
- Modify: `lib/__tests__/mcp-oauth.test.ts`
- Test: `lib/__tests__/mcp-oauth.test.ts`

- [ ] **Step 1: Replace the static secret test with PKCE expectations**

In `lib/__tests__/mcp-oauth.test.ts`, replace the first `performMcpOAuthFlow` test with this version:

```ts
  test("uses PKCE for static client secrets and still sends the secret during token exchange", async () => {
    const result = await (oauthModule.performMcpOAuthFlow as any)(
      "extension-1",
      "https://resource.example.com/.well-known/oauth-protected-resource",
      "Static Connector",
      undefined,
      {
        clientId: "static-client-id",
        clientSecret: "static-client-secret",
      },
    );

    expect(result).toEqual({
      type: "success",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    });
    expect(authState.lastAuthRequestConfig).toMatchObject({
      clientId: "static-client-id",
      scopes: [],
      usePKCE: true,
      extraParams: { resource: "https://resource.example.com" },
    });
    expect(authState.exchangeCalls[0]).toMatchObject({
      code: "auth-code",
      clientId: "static-client-id",
      clientSecret: "static-client-secret",
      tokenEndpoint: "https://auth.example.com/token",
      extraParams: { code_verifier: "generated-code-verifier" },
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
```

- [ ] **Step 2: Update manual callback coverage to include the verifier**

In the `restores static client secrets for manual callback completion` test, change the pending state `codeVerifier` from an empty string to a real value:

```ts
        codeVerifier: "manual-code-verifier",
```

Then update the assertion to require `code_verifier` as well as `clientSecret`:

```ts
    expect(authState.exchangeCalls[0]).toMatchObject({
      code: "manual-code",
      clientId: "static-client-id",
      clientSecret: "stored-static-secret",
      extraParams: { code_verifier: "manual-code-verifier" },
    });
```

- [ ] **Step 3: Run the tests and verify the expected failure**

Run:

```bash
bun test lib/__tests__/mcp-oauth.test.ts
```

Expected before implementation:

```text
FAIL: expected usePKCE to be true
```

The exact Bun diff can vary, but the failure must show that static client secret auth is still building the request with `usePKCE: false`.

- [ ] **Step 4: Commit the failing test**

```bash
git add lib/__tests__/mcp-oauth.test.ts
git commit -m "test: require pkce for static mcp oauth"
```

---

### Task 2: Enable PKCE For All MCP OAuth Authorization Requests

**Files:**
- Modify: `lib/mcp-oauth.ts`
- Test: `lib/__tests__/mcp-oauth.test.ts`

- [ ] **Step 1: Change the AuthRequest PKCE option**

In `lib/mcp-oauth.ts`, find the `new AuthSession.AuthRequest` call inside `performMcpOAuthFlow` and change `usePKCE` to `true`:

```ts
  const request = new AuthSession.AuthRequest({
    clientId,
    responseType: AuthSession.ResponseType.Code,
    redirectUri,
    scopes: [],
    usePKCE: true,
    extraParams: { resource: resourceMetadata.resource },
  });
```

This keeps Expo AuthSession responsible for generating `code_verifier`, deriving the S256 `code_challenge`, and adding `code_challenge_method=S256` to the authorization URL.

- [ ] **Step 2: Keep token exchange behavior unchanged**

Leave `exchangeAndStore` in `lib/mcp-oauth.ts` with both existing branches intact:

```ts
  if (clientSecret) {
    exchangeConfig.clientSecret = clientSecret;
  }
  if (codeVerifier) {
    exchangeConfig.extraParams = { code_verifier: codeVerifier };
  }
```

This is the required combination for static client ID plus secret plus PKCE: the static secret authenticates the client at the token endpoint, and the code verifier proves continuity with the authorization request.

- [ ] **Step 3: Run the focused OAuth tests**

Run:

```bash
bun test lib/__tests__/mcp-oauth.test.ts
```

Expected:

```text
3 pass
0 fail
```

- [ ] **Step 4: Commit the implementation**

```bash
git add lib/mcp-oauth.ts lib/__tests__/mcp-oauth.test.ts
git commit -m "fix: enable pkce for static mcp oauth"
```

---

### Task 3: Verify Connector Form Tests Still Pass

**Files:**
- Test: `components/settings/__tests__/mcpConnectorAuthConfig.test.ts`
- Test: `lib/__tests__/mcp-oauth.test.ts`

- [ ] **Step 1: Run MCP connector config tests**

Run:

```bash
bun test components/settings/__tests__/mcpConnectorAuthConfig.test.ts
```

Expected:

```text
7 pass
0 fail
```

- [ ] **Step 2: Run MCP OAuth tests again**

Run:

```bash
bun test lib/__tests__/mcp-oauth.test.ts
```

Expected:

```text
3 pass
0 fail
```

- [ ] **Step 3: Run TypeScript verification**

Run:

```bash
./node_modules/.bin/tsc --noEmit --pretty false
```

Expected: command exits with status `0` and prints no TypeScript errors.

- [ ] **Step 4: Confirm no verification artifacts changed**

Run:

```bash
git diff -- lib/mcp-oauth.ts lib/__tests__/mcp-oauth.test.ts components/settings/__tests__/mcpConnectorAuthConfig.test.ts
```

Expected: the diff contains only the intentional changes from Task 1 and Task 2. No snapshots, generated files, lockfiles, or formatting-only changes should appear.

---

## Manual QA

- [ ] Add or edit an MCP connector with static OAuth selected.
- [ ] Enter a static client ID and static client secret.
- [ ] Start sign-in.
- [ ] Confirm the authorization URL is accepted by the server and no longer returns `code_challenge required`.
- [ ] Complete the OAuth callback.
- [ ] Confirm the connector is saved and subsequent MCP probing uses the stored bearer token.
- [ ] Trigger a refresh-token path after the access token expires, if practical, and confirm refresh still succeeds with the stored static client secret.

---

## Self-Review

- Spec coverage: The plan covers PKCE generation, `code_challenge` transmission through Expo AuthSession, `code_verifier` token exchange, static client secret retention, manual callback completion, and refresh behavior.
- Placeholder scan: No `TBD`, `TODO`, "add appropriate", or unspecified test steps remain.
- Type consistency: The plan uses existing names from `lib/mcp-oauth.ts`: `performMcpOAuthFlow`, `completeMcpOAuthFromCallbackUrl`, `McpOAuthPendingState`, `exchangeAndStore`, `StaticOAuthCredentials`, and `clientSecret`.
