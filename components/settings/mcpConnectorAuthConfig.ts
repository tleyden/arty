import type { StaticOAuthCredentials } from "../../lib/mcp-oauth";

export type McpConnectorAuthMethod = "auto" | "static";
export type McpStoredAuthMode = "dcr" | "static" | "bearer" | null;

type DerivedMcpConnectorAuthStateInput = {
  token: string | null;
  refreshToken: string | null;
  authMode: McpStoredAuthMode;
  clientId: string | null;
  clientSecret: string | null;
};

export type DerivedMcpConnectorAuthState = {
  authMethod: McpConnectorAuthMethod;
  advancedExpanded: boolean;
  bearerToken: string;
  hasOAuthToken: boolean;
  staticClientId: string;
  staticClientSecret: string;
};

type StaticOAuthCredentialInput = {
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string;
};

type ValidateMcpConnectorFormInput = {
  name: string;
  serverUrl: string;
  authMethod: McpConnectorAuthMethod;
  staticClientId: string;
  staticAuthorizationEndpoint: string;
  staticTokenEndpoint: string;
};

export function deriveMcpConnectorAuthState(
  input: DerivedMcpConnectorAuthStateInput,
): DerivedMcpConnectorAuthState {
  const isStatic = input.authMode === "static";
  const isOAuth = isStatic || input.authMode === "dcr" || (!!input.refreshToken && input.authMode !== "bearer");

  if (isStatic) {
    return {
      authMethod: "static",
      advancedExpanded: true,
      bearerToken: "",
      hasOAuthToken: !!(input.token || input.refreshToken || input.clientId),
      staticClientId: input.clientId ?? "",
      staticClientSecret: input.clientSecret ?? "",
    };
  }

  return {
    authMethod: "auto",
    advancedExpanded: !!input.token && !isOAuth,
    bearerToken: isOAuth ? "" : input.token ?? "",
    hasOAuthToken: isOAuth,
    staticClientId: "",
    staticClientSecret: "",
  };
}

export function buildStaticOAuthCredentials(
  input: StaticOAuthCredentialInput,
): StaticOAuthCredentials {
  const scopes = input.scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    clientId: input.clientId.trim(),
    clientSecret: input.clientSecret.trim() || undefined,
    authorizationEndpoint: input.authorizationEndpoint.trim(),
    tokenEndpoint: input.tokenEndpoint.trim(),
    scopes: scopes.length > 0 ? scopes : undefined,
  };
}

export function validateMcpConnectorForm(
  input: ValidateMcpConnectorFormInput,
): string | null {
  if (!input.name.trim()) {
    return "Name is required.";
  }
  if (!input.serverUrl.trim()) {
    return "MCP Server URL is required.";
  }
  if (input.authMethod !== "static") {
    return null;
  }
  if (!input.staticClientId.trim()) {
    return "Client ID is required for static OAuth.";
  }
  if (!input.staticAuthorizationEndpoint.trim() || !input.staticTokenEndpoint.trim()) {
    return "Authorization and Token endpoints are required.";
  }
  return null;
}
