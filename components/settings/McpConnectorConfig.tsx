import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { probeMcpServer } from "../../modules/vm-webrtc/src/mcp_client/extensions";
import {
  addMcpExtension,
  clearMcpAuthCredentials,
  deleteMcpClientSecret,
  deleteMcpBearerToken,
  getMcpAuthMode,
  getMcpBearerToken,
  getMcpClientId,
  getMcpClientSecret,
  getMcpExtensions,
  getMcpRefreshToken,
  saveMcpAuthMode,
  saveMcpBearerToken,
  toNormalizedName,
  uniqueNormalizedName,
  type McpExtensionRecord,
} from "../../lib/secure-storage";
import {
  completeMcpOAuthFromCallbackUrl,
  performMcpOAuthFlow,
  type McpOAuthPendingState,
  type StaticOAuthCredentials,
} from "../../lib/mcp-oauth";
import { CONNECTOR_SETTINGS_CHANGED_EVENT } from "../../modules/vm-webrtc/src/ToolkitManager";
import { log } from "../../lib/logger";
import {
  buildStaticOAuthCredentials,
  deriveMcpConnectorAuthState,
  sanitizeMcpConnectorForm,
  validateMcpConnectorForm,
  type McpConnectorAuthMethod,
  type McpStoredAuthMode,
} from "./mcpConnectorAuthConfig";

export interface McpConnectorConfigProps {
  visible: boolean;
  onClose: () => void;
  existingExtension?: McpExtensionRecord;
  onSave?: (updated?: McpExtensionRecord) => void;
  onBeforeBrowserOpen?: () => void;
  onNeedsManualCallback?: () => void;
}

export const McpConnectorConfig: React.FC<McpConnectorConfigProps> = ({
  visible,
  onClose,
  existingExtension,
  onSave,
  onBeforeBrowserOpen,
  onNeedsManualCallback,
}) => {
  const isEditing = !!existingExtension;

  const [name, setName] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [bearerToken, setBearerToken] = useState("");
  const [normalizedNamePreview, setNormalizedNamePreview] = useState("");
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingLabel, setConnectingLabel] = useState("Connecting…");
  const [tokenVisible, setTokenVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [hasOAuthToken, setHasOAuthToken] = useState(false);
  const [authMethod, setAuthMethod] = useState<McpConnectorAuthMethod>("auto");
  const [staticClientId, setStaticClientId] = useState("");
  const [staticClientSecret, setStaticClientSecret] = useState("");
  const [staticSecretVisible, setStaticSecretVisible] = useState(false);
  const [pendingOAuth, setPendingOAuth] = useState<McpOAuthPendingState | null>(null);
  const [pendingExtensionId, setPendingExtensionId] = useState<string | null>(null);
  const [pendingAuthMode, setPendingAuthMode] = useState<McpStoredAuthMode>(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [callbackError, setCallbackError] = useState("");
  const [keyboardPadding, setKeyboardPadding] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (visible && existingExtension) {
      setName(existingExtension.name);
      setServerUrl(existingExtension.serverUrl);
      setNormalizedNamePreview(existingExtension.normalizedName ?? toNormalizedName(existingExtension.name));
      setStaticSecretVisible(false);
      setPendingOAuth(null);
      setPendingExtensionId(null);
      setPendingAuthMode(null);
      setCallbackUrl("");
      setCallbackError("");
      Promise.all([
        getMcpBearerToken(existingExtension.id),
        getMcpRefreshToken(existingExtension.id),
        getMcpAuthMode(existingExtension.id),
        getMcpClientId(existingExtension.id),
        getMcpClientSecret(existingExtension.id),
      ]).then(([token, refreshToken, storedAuthMode, clientId, clientSecret]) => {
        if (cancelled) {
          return;
        }
        const derived = deriveMcpConnectorAuthState({
          token,
          refreshToken,
          authMode: (storedAuthMode ?? existingExtension.authMode ?? null) as McpStoredAuthMode,
          clientId,
          clientSecret,
        });
        setHasOAuthToken(derived.hasOAuthToken);
        setAuthMethod(derived.authMethod);
        setAdvancedExpanded(derived.advancedExpanded);
        setBearerToken(derived.bearerToken);
        setStaticClientId(derived.staticClientId);
        setStaticClientSecret(derived.staticClientSecret);
      });
    } else if (visible) {
      setName("");
      setServerUrl("");
      setBearerToken("");
      setNormalizedNamePreview("");
      setHasOAuthToken(false);
      setAdvancedExpanded(false);
      setAuthMethod("auto");
      setStaticClientId("");
      setStaticClientSecret("");
      setStaticSecretVisible(false);
      setPendingOAuth(null);
      setPendingExtensionId(null);
      setPendingAuthMode(null);
      setCallbackUrl("");
      setCallbackError("");
    }
    return () => {
      cancelled = true;
    };
  }, [visible, existingExtension]);

  useEffect(() => {
    log.info("[mcp_connector] mounted");
    return () => { log.info("[mcp_connector] UNMOUNTED"); };
  }, []);

  useEffect(() => {
    log.info("[mcp_connector] visible changed", {}, { visible });
  }, [visible]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setKeyboardPadding(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardPadding(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const sanitizeToken = (value: string) => value.replace(/[\r\n\t ]+/g, "");

  const handleTokenChange = (value: string) => {
    setBearerToken(sanitizeToken(value));
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setBearerToken(sanitizeToken(text));
  };

  const handleCopy = async () => {
    if (!bearerToken) return;
    await Clipboard.setStringAsync(bearerToken);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  };

  const persistExtension = async (
    id: string,
    sanitizedForm: {
      name: string;
      serverUrl: string;
    },
    manualToken?: string,
    options?: {
      preserveExistingToken?: boolean;
      authMode?: "dcr" | "static" | "bearer";
    },
  ) => {
    log.info(
      "[mcp_connector] persistExtension start",
      {},
      {
        id,
        isEditing,
        hasManualToken: !!manualToken,
        preserveExistingToken: options?.preserveExistingToken,
        authMode: options?.authMode,
      },
    );
    const allExtensions = await getMcpExtensions();
    const normalizedName = uniqueNormalizedName(
      toNormalizedName(sanitizedForm.name),
      allExtensions,
      existingExtension?.id,
    );
    const record: McpExtensionRecord = {
      id,
      name: sanitizedForm.name,
      normalizedName,
      serverUrl: sanitizedForm.serverUrl,
      authMode: options?.authMode,
    };
    await addMcpExtension(record);

    if (options?.authMode === "bearer" && manualToken) {
      await saveMcpBearerToken(id, manualToken);
      await clearMcpAuthCredentials(id);
      await saveMcpAuthMode(id, "bearer");
    } else if (options?.authMode === "dcr") {
      if (!options.preserveExistingToken) {
        await deleteMcpBearerToken(id);
      }
      await deleteMcpClientSecret(id);
      await saveMcpAuthMode(id, "dcr");
    } else if (options?.authMode === "static") {
      if (!options.preserveExistingToken) {
        await deleteMcpBearerToken(id);
      }
      await saveMcpAuthMode(id, "static");
    } else {
      await deleteMcpBearerToken(id);
      await clearMcpAuthCredentials(id);
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

  const handleSave = async () => {
    setIsConnecting(true);
    setConnectingLabel("Connecting…");
    try {
      const sanitizedForm = sanitizeMcpConnectorForm({
        name,
        serverUrl,
        bearerToken,
        staticClientId,
        staticClientSecret,
      });
      const validationError = validateMcpConnectorForm({
        name: sanitizedForm.name,
        serverUrl: sanitizedForm.serverUrl,
        authMethod,
        staticClientId: sanitizedForm.staticClientId,
      });
      if (validationError) {
        Alert.alert("Missing Field", validationError, [{ text: "OK" }]);
        return;
      }

      if (authMethod === "static") {
        const id = existingExtension?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Probe the server to discover OAuth endpoints, same as the auto/DCR flow.
        const probeResult = await probeMcpServer(
          sanitizedForm.serverUrl,
          undefined,
          sanitizedForm.name,
        );
        if (probeResult.statusCode !== 401 || !probeResult.resourceMetadataUrl) {
          const detail = probeResult.error ?? `Server returned ${probeResult.statusCode}`;
          Alert.alert("Connection Failed", detail, [{ text: "OK" }]);
          return;
        }

        setConnectingLabel("Opening sign-in…");
        const staticCredentials: StaticOAuthCredentials = buildStaticOAuthCredentials({
          clientId: sanitizedForm.staticClientId,
          clientSecret: sanitizedForm.staticClientSecret,
        });

        try {
          onBeforeBrowserOpen?.();
          const oauthResult = await performMcpOAuthFlow(
            id,
            probeResult.resourceMetadataUrl,
            sanitizedForm.name,
            undefined,
            staticCredentials,
          );
          log.info("[mcp_connector] Static OAuth flow returned", {}, { oauthResult_type: oauthResult.type });
          if (oauthResult.type === "success") {
            await persistExtension(id, sanitizedForm, undefined, {
              preserveExistingToken: true,
              authMode: "static",
            });
          } else {
            setPendingOAuth(oauthResult.pendingState);
            setPendingExtensionId(id);
            setPendingAuthMode("static");
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

      const token = sanitizedForm.bearerToken || undefined;
      const result = await probeMcpServer(sanitizedForm.serverUrl, token, sanitizedForm.name);

      if (result.success) {
        const id = existingExtension?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await persistExtension(id, sanitizedForm, token, { authMode: token ? "bearer" : undefined });
      } else if (result.statusCode === 401 && result.resourceMetadataUrl) {
        const id = existingExtension?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setConnectingLabel("Opening sign-in…");
        const allExtensions = await getMcpExtensions();
        const normalizedName = uniqueNormalizedName(
          toNormalizedName(sanitizedForm.name),
          allExtensions,
          existingExtension?.id,
        );
        log.info(
          "[mcp_connector] entering OAuth branch",
          {},
          {
            id,
            serverUrl: sanitizedForm.serverUrl,
            normalizedName,
            resourceMetadataUrl: result.resourceMetadataUrl,
          },
        );
        try {
          onBeforeBrowserOpen?.();
          const oauthResult = await performMcpOAuthFlow(
            id,
            result.resourceMetadataUrl,
            sanitizedForm.name,
            {
              serverUrl: sanitizedForm.serverUrl,
              normalizedName,
            },
          );
          log.info("[mcp_connector] OAuth flow returned", {}, { oauthResult_type: oauthResult.type });
          if (oauthResult.type === "success") {
            await persistExtension(id, sanitizedForm, undefined, {
              preserveExistingToken: true,
              authMode: "dcr",
            });
          } else {
            setPendingOAuth(oauthResult.pendingState);
            setPendingExtensionId(id);
            setPendingAuthMode("dcr");
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

  const handleCompleteOAuth = async () => {
    if (!pendingOAuth || !pendingExtensionId) return;
    setCallbackError("");
    setIsConnecting(true);
    setConnectingLabel("Completing sign-in…");
    try {
      const sanitizedForm = sanitizeMcpConnectorForm({
        name,
        serverUrl,
        bearerToken,
        staticClientId,
        staticClientSecret,
      });
      await completeMcpOAuthFromCallbackUrl(callbackUrl.trim(), pendingOAuth);
      await persistExtension(pendingExtensionId, sanitizedForm, undefined, {
        preserveExistingToken: true,
        authMode: pendingAuthMode === "static" || pendingAuthMode === "dcr" ? pendingAuthMode : undefined,
      });
    } catch (err: any) {
      setCallbackError(err?.message ?? "Failed to complete sign-in. Check the URL and try again.");
    } finally {
      setIsConnecting(false);
      setConnectingLabel("Connecting…");
    }
  };

  const resetAndClose = () => {
    log.info("[mcp_connector] resetAndClose");
    setName("");
    setServerUrl("");
    setBearerToken("");
    setNormalizedNamePreview("");
    setAdvancedExpanded(false);
    setTokenVisible(false);
    setHasOAuthToken(false);
    setAuthMethod("auto");
    setStaticClientId("");
    setStaticClientSecret("");
    setStaticSecretVisible(false);
    setPendingOAuth(null);
    setPendingExtensionId(null);
    setPendingAuthMode(null);
    setCallbackUrl("");
    setCallbackError("");
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      presentationStyle="formSheet"
      visible={visible}
      onRequestClose={resetAndClose}
    >
      <View style={[styles.container, { paddingBottom: keyboardPadding }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {isEditing ? "Edit MCP Extension" : "Add MCP Extension"}
          </Text>
          <Text style={styles.headerWarning}>⚠️ MCP auth is still experimental with known bugs</Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {pendingOAuth ? (
            <View style={styles.callbackSection}>
              <Text style={styles.callbackTitle}>Complete Sign-in</Text>
              <Text style={styles.callbackBody}>
                The browser closed before the redirect was received. Copy the callback URL shown in the browser (it starts with{" "}
                <Text style={styles.hintMono}>vibemachine://mcp-oauth-callback</Text>
                ) and paste it below.
              </Text>
              <TextInput
                style={[styles.input, styles.callbackInput]}
                value={callbackUrl}
                onChangeText={(v) => {
                  setCallbackUrl(v);
                  setCallbackError("");
                }}
                placeholder="vibemachine://mcp-oauth-callback?code=…"
                placeholderTextColor="#AEAEB2"
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              {callbackError ? (
                <Text style={styles.callbackError}>{callbackError}</Text>
              ) : null}
              <Pressable
                style={({ pressed }) => [
                  styles.tryAgainButton,
                  pressed && styles.tryAgainButtonPressed,
                ]}
                onPress={() => {
                  setPendingOAuth(null);
                  setPendingExtensionId(null);
                  setCallbackUrl("");
                  setCallbackError("");
                }}
              >
                <Text style={styles.tryAgainText}>Open sign-in browser again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    setNormalizedNamePreview(toNormalizedName(v));
                  }}
                  placeholder="Enter extension name..."
                  placeholderTextColor="#AEAEB2"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {normalizedNamePreview ? (
                  <Text style={styles.hint}>
                    ID: <Text style={styles.hintMono}>{normalizedNamePreview}</Text>
                  </Text>
                ) : null}
              </View>

              <View style={styles.section}>
                <Text style={styles.label}>MCP Server URL</Text>
                <TextInput
                  style={styles.input}
                  value={serverUrl}
                  onChangeText={setServerUrl}
                  placeholder="https://..."
                  placeholderTextColor="#AEAEB2"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={styles.hint}>
                  Streamable HTTP endpoint for the MCP server
                </Text>
              </View>

              {hasOAuthToken && (
                <View style={styles.oauthBadge}>
                  <Text style={styles.oauthBadgeText}>Authenticated via OAuth</Text>
                  <Text style={styles.oauthBadgeHint}>
                    Tap {isEditing ? "Save" : "Add"} to re-authenticate
                  </Text>
                </View>
              )}

              <Pressable
                style={styles.advancedToggle}
                onPress={() => setAdvancedExpanded((v) => !v)}
              >
                <Text style={styles.advancedToggleText}>Advanced</Text>
                <Text style={styles.advancedChevron}>
                  {advancedExpanded ? "▲" : "▼"}
                </Text>
              </Pressable>

              {advancedExpanded && (
                <View style={styles.advancedSection}>
                  <View style={styles.section}>
                    <Text style={styles.label}>OAuth Method</Text>
                    <View style={styles.segmentControl}>
                      <Pressable
                        style={[
                          styles.segment,
                          authMethod === "auto" && styles.segmentActive,
                        ]}
                        onPress={() => {
                          setAuthMethod("auto");
                          setAdvancedExpanded(true);
                        }}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            authMethod === "auto" && styles.segmentTextActive,
                          ]}
                        >
                          Auto (DCR)
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.segment,
                          authMethod === "static" && styles.segmentActive,
                        ]}
                        onPress={() => {
                          setAuthMethod("static");
                          setAdvancedExpanded(true);
                        }}
                      >
                        <Text
                          style={[
                            styles.segmentText,
                            authMethod === "static" && styles.segmentTextActive,
                          ]}
                        >
                          Static Credentials
                        </Text>
                      </Pressable>
                    </View>
                    <Text style={styles.hint}>
                      {authMethod === "auto"
                        ? "Automatically discover OAuth endpoints and register a public client."
                        : "Use an existing OAuth client ID and optional client secret. Endpoints are auto-discovered from the MCP server."}
                    </Text>
                  </View>

                  {authMethod === "static" ? (
                    <>
                      <View style={styles.section}>
                        <Text style={styles.label}>Client ID *</Text>
                        <TextInput
                          style={styles.input}
                          value={staticClientId}
                          onChangeText={setStaticClientId}
                          placeholder="your-client-id"
                          placeholderTextColor="#AEAEB2"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />
                      </View>

                      <View style={styles.section}>
                        <Text style={styles.label}>Client Secret</Text>
                        <View style={styles.passwordContainer}>
                          <TextInput
                            style={[styles.input, styles.passwordInput]}
                            value={staticClientSecret}
                            onChangeText={setStaticClientSecret}
                            placeholder="Optional for confidential clients"
                            placeholderTextColor="#AEAEB2"
                            autoCapitalize="none"
                            autoCorrect={false}
                            secureTextEntry={!staticSecretVisible}
                          />
                          <Pressable
                            style={({ pressed }) => [
                              styles.inlineActionButton,
                              pressed && styles.inlineActionButtonPressed,
                            ]}
                            onPress={() => setStaticSecretVisible((value) => !value)}
                          >
                            <Text style={styles.inlineActionText}>
                              {staticSecretVisible ? "Hide" : "Show"}
                            </Text>
                          </Pressable>
                        </View>
                        <Text style={styles.hint}>
                          Leave blank for public clients. Add a secret for confidential clients using `client_secret_post`.
                        </Text>
                      </View>

                    </>
                  ) : (
                    <>
                      <Text style={styles.label}>Bearer Token</Text>

                      <View style={styles.tokenInputRow}>
                        <TextInput
                          style={[styles.input, styles.tokenInput]}
                          value={bearerToken}
                          onChangeText={handleTokenChange}
                          placeholder="Optional JWT or access token..."
                          placeholderTextColor="#AEAEB2"
                          autoCapitalize="none"
                          autoCorrect={false}
                          secureTextEntry={!tokenVisible}
                          multiline={false}
                        />
                        <Pressable
                          style={({ pressed }) => [
                            styles.tokenIconButton,
                            pressed && styles.tokenIconButtonPressed,
                          ]}
                          onPress={() => setTokenVisible((v) => !v)}
                        >
                          <Text style={styles.tokenIconText}>
                            {tokenVisible ? "🙈" : "👁️"}
                          </Text>
                        </Pressable>
                      </View>

                      <View style={styles.tokenActions}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.tokenActionButton,
                            pressed && styles.tokenActionButtonPressed,
                          ]}
                          onPress={handlePaste}
                        >
                          <Text style={styles.tokenActionText}>Paste</Text>
                        </Pressable>
                        <Pressable
                          style={({ pressed }) => [
                            styles.tokenActionButton,
                            !bearerToken && styles.tokenActionButtonDisabled,
                            pressed && styles.tokenActionButtonPressed,
                          ]}
                          onPress={handleCopy}
                          disabled={!bearerToken}
                        >
                          <Text style={styles.tokenActionText}>
                            {copyFeedback ? "Copied!" : "Copy"}
                          </Text>
                        </Pressable>
                      </View>

                      <Text style={styles.hint}>
                        Sent as{" "}
                        <Text style={styles.hintMono}>Authorization: Bearer ...</Text> on
                        every request. Newlines are stripped automatically.
                      </Text>
                    </>
                  )}
                </View>
              )}
            </>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.cancelButton,
              pressed && styles.cancelButtonPressed,
            ]}
            onPress={resetAndClose}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>

          {pendingOAuth ? (
            <Pressable
              style={({ pressed }) => [
                styles.connectButton,
                (!callbackUrl.trim() || isConnecting) && styles.connectButtonDisabled,
                pressed && styles.connectButtonPressed,
              ]}
              onPress={handleCompleteOAuth}
              disabled={!callbackUrl.trim() || isConnecting}
            >
              {isConnecting ? (
                <View style={styles.connectingRow}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.connectingLabel}>{connectingLabel}</Text>
                </View>
              ) : (
                <Text style={styles.connectButtonText}>Complete Sign-in</Text>
              )}
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [
                styles.connectButton,
                (!name.trim() || !serverUrl.trim() || isConnecting) && styles.connectButtonDisabled,
                pressed && styles.connectButtonPressed,
              ]}
              onPress={handleSave}
              disabled={!name.trim() || !serverUrl.trim() || isConnecting}
            >
              {isConnecting ? (
                <View style={styles.connectingRow}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                  <Text style={styles.connectingLabel}>{connectingLabel}</Text>
                </View>
              ) : (
                <Text style={styles.connectButtonText}>{isEditing ? "Save" : "Add"}</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F5F7",
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  headerWarning: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#1C1C1E",
  },
  hint: {
    fontSize: 12,
    color: "#8E8E93",
    marginTop: 6,
    lineHeight: 17,
  },
  hintMono: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
  },
  advancedToggleText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#636366",
  },
  advancedChevron: {
    fontSize: 11,
    color: "#AEAEB2",
  },
  advancedSection: {
    marginBottom: 24,
  },
  segmentControl: {
    flexDirection: "row",
    backgroundColor: "#EAEAEE",
    borderRadius: 12,
    padding: 4,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#636366",
  },
  segmentTextActive: {
    color: "#1C1C1E",
  },
  passwordContainer: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 76,
  },
  inlineActionButton: {
    position: "absolute",
    right: 10,
    top: 8,
    bottom: 8,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  inlineActionButtonPressed: {
    opacity: 0.6,
  },
  inlineActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0A84FF",
  },
  tokenInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  tokenInput: {
    flex: 1,
  },
  tokenIconButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    alignItems: "center",
    justifyContent: "center",
  },
  tokenIconButtonPressed: {
    opacity: 0.6,
  },
  tokenIconText: {
    fontSize: 18,
  },
  tokenActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  tokenActionButton: {
    paddingVertical: 7,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  tokenActionButtonDisabled: {
    opacity: 0.4,
  },
  tokenActionButtonPressed: {
    opacity: 0.6,
  },
  tokenActionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#0A84FF",
  },
  footer: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: "#E5E5EA",
    backgroundColor: "#F5F5F7",
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E5EA",
  },
  cancelButtonPressed: {
    opacity: 0.7,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#636366",
  },
  connectButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#1C1C1E",
  },
  connectButtonDisabled: {
    backgroundColor: "#AEAEB2",
  },
  connectButtonPressed: {
    opacity: 0.85,
  },
  connectButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  connectingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  connectingLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  oauthBadge: {
    backgroundColor: "#E8F5E9",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  oauthBadgeText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2E7D32",
  },
  oauthBadgeHint: {
    fontSize: 12,
    color: "#4CAF50",
    marginTop: 2,
  },
  callbackSection: {
    gap: 14,
  },
  callbackTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1C1C1E",
  },
  callbackBody: {
    fontSize: 14,
    color: "#636366",
    lineHeight: 20,
  },
  callbackInput: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: 12,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 13,
  },
  callbackError: {
    fontSize: 13,
    color: "#FF3B30",
    lineHeight: 18,
  },
  tryAgainButton: {
    alignSelf: "flex-start",
    paddingVertical: 6,
  },
  tryAgainButtonPressed: {
    opacity: 0.5,
  },
  tryAgainText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0A84FF",
  },
});
