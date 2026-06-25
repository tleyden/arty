import { describe, expect, test } from "bun:test";

import {
  buildStaticOAuthCredentials,
  deriveMcpConnectorAuthState,
  sanitizeMcpConnectorForm,
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
  test("trims client id and omits blank secret", () => {
    expect(
      buildStaticOAuthCredentials({
        clientId: "  client-id  ",
        clientSecret: "   ",
      }),
    ).toEqual({
      clientId: "client-id",
    });
  });

  test("includes client secret when provided", () => {
    expect(
      buildStaticOAuthCredentials({
        clientId: "client-id",
        clientSecret: "my-secret",
      }),
    ).toEqual({
      clientId: "client-id",
      clientSecret: "my-secret",
    });
  });
});

describe("validateMcpConnectorForm", () => {
  test("requires client ID in static mode", () => {
    expect(
      validateMcpConnectorForm({
        name: "Static Connector",
        serverUrl: "https://mcp.example.com",
        authMethod: "static",
        staticClientId: "",
      }),
    ).toBe("Client ID is required for static OAuth.");
  });

  test("passes with only client ID in static mode", () => {
    expect(
      validateMcpConnectorForm({
        name: "Static Connector",
        serverUrl: "https://mcp.example.com",
        authMethod: "static",
        staticClientId: "my-client-id",
      }),
    ).toBeNull();
  });
});

describe("sanitizeMcpConnectorForm", () => {
  test("trims leading and trailing whitespace from connector fields", () => {
    expect(
      sanitizeMcpConnectorForm({
        name: "  Brain3  ",
        serverUrl: " https://mcp.example.com/path ",
        bearerToken: "  bearer-token  ",
        staticClientId: "  client-id  ",
        staticClientSecret: "  client-secret  ",
      }),
    ).toEqual({
      name: "Brain3",
      serverUrl: "https://mcp.example.com/path",
      bearerToken: "bearer-token",
      staticClientId: "client-id",
      staticClientSecret: "client-secret",
    });
  });
});
