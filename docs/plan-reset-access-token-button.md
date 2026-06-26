# Plan: "Reset Access Token" button in MCP detail screen

## Goal

Add a "Reset Access Token" button next to "Reset Auth" in `McpExtensionDetailScreen`. It drops only the bearer token so the next MCP call uses the refresh token — without wiping credentials or forcing re-auth.

---

## File touched

`components/settings/McpExtensionDetailScreen.tsx` only.  
`deleteMcpBearerToken(id)` already exists in `lib/secure-storage.ts:874`.

---

## Step 1 — New handler `handleResetAccessToken`

Insert after `handleResetAuth` (~line 163):

```ts
const handleResetAccessToken = () => {
  const doReset = async () => {
    await deleteMcpBearerToken(currentExtension.id);
    DeviceEventEmitter.emit(CONNECTOR_SETTINGS_CHANGED_EVENT);
  };

  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Reset access token for "${currentExtension.name}"?`,
        message: "The access token will be dropped. The app will use the refresh token on the next MCP call.",
        options: ["Cancel", "Reset Access Token"],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 0,
      },
      (buttonIndex) => {
        if (buttonIndex === 1) doReset();
      }
    );
  } else {
    Alert.alert(
      "Reset Access Token",
      `Drop the access token for "${currentExtension.name}"? The app will use the refresh token on the next MCP call.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Reset Access Token", style: "destructive", onPress: doReset },
      ]
    );
  }
};
```

**Key differences from `handleResetAuth`:**
- Only calls `deleteMcpBearerToken` — does **not** touch client ID, client secret, refresh token, token endpoint, or auth mode
- Does **not** open the configure dialog afterward

---

## Step 2 — Footer layout

Currently the footer is a single `flexDirection: "row"` with three `flex: 1` buttons:

```
[ Configure ]  [ Reset Auth ]  [ Remove ]
```

Adding a 4th long-label button inline would be cramped. Restructure into **two rows**:

```
[ Configure ]  [ Reset Auth ]  [ Remove ]
[        Reset Access Token        ]
```

The outer `View` becomes a column container; the existing three buttons move into an inner `View` with `flexDirection: "row"`.

---

## Step 3 — New styles

```ts
resetAccessTokenButton: {
  paddingVertical: 14,
  borderRadius: 12,
  alignItems: "center",
  backgroundColor: "#FFFFFF",
  borderWidth: 1,
  borderColor: "#0A84FF",   // blue = less destructive than orange Reset Auth
},
resetAccessTokenButtonPressed: {
  backgroundColor: "#F0F6FF",
},
resetAccessTokenButtonText: {
  fontSize: 16,
  fontWeight: "600",
  color: "#0A84FF",
},
```

---

## No other files change

`deleteMcpBearerToken(id)` in `lib/secure-storage.ts:874` already handles deleting the bearer token key from SecureStore and the in-memory cache.
