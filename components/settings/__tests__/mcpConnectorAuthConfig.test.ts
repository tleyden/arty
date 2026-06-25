import { describe, expect, test } from "bun:test";

import {
  buildStaticOAuthCredentials,
  deriveMcpConnectorAuthState,
  validateMcpConnectorForm,
} from "../mcpConnectorAuthConfig";

describe("deriveMcpConnectorAuthState", () => {
  test("hydrates static auth fields from stored static credentials", () => {
    expect(
      deriveMcpConnectorAuthState({
        token: null,
        refreshToken: "refresh-token",
        authMode: "static",
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).toEqual({
      authMethod: "static",
      advancedExpanded: true,
      bearerToken: "",
      hasOAuthToken: true,
      staticClientId: "client-id",
      staticClientSecret: "client-secret",
    });
  });

  test("keeps bearer token mode in advanced section for manual tokens", () => {
    expect(
      deriveMcpConnectorAuthState({
        token: "bearer-token",
        refreshToken: null,
        authMode: "bearer",
        clientId: null,
        clientSecret: null,
      }),
    ).toEqual({
      authMethod: "auto",
      advancedExpanded: true,
      bearerToken: "bearer-token",
      hasOAuthToken: false,
      staticClientId: "",
      staticClientSecret: "",
    });
  });
});

describe("buildStaticOAuthCredentials", () => {
  test("trims endpoints and splits comma separated scopes", () => {
    expect(
      buildStaticOAuthCredentials({
        clientId: "  client-id  ",
        clientSecret: "   ",
        authorizationEndpoint: " https://provider.example.com/authorize ",
        tokenEndpoint: " https://provider.example.com/token ",
        scopes: "openid, profile , email",
      }),
    ).toEqual({
      clientId: "client-id",
      authorizationEndpoint: "https://provider.example.com/authorize",
      tokenEndpoint: "https://provider.example.com/token",
      scopes: ["openid", "profile", "email"],
    });
  });
});

describe("validateMcpConnectorForm", () => {
  test("requires full static OAuth inputs in static mode", () => {
    expect(
      validateMcpConnectorForm({
        name: "Static Connector",
        serverUrl: "https://mcp.example.com",
        authMethod: "static",
        staticClientId: "",
        staticAuthorizationEndpoint: "",
        staticTokenEndpoint: "",
      }),
    ).toBe("Client ID is required for static OAuth.");
  });
});
