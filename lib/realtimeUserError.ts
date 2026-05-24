const DEFAULT_MESSAGES = {
  voice: "The voice session could not be started.",
  translation: "The translation session could not be started.",
} as const;

type RealtimeUserErrorContext = keyof typeof DEFAULT_MESSAGES;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const firstLine = (value: string) => value.split(/\r?\n/, 1)[0]?.trim() ?? "";

export function getUserFacingRealtimeErrorMessage(
  error: unknown,
  context: RealtimeUserErrorContext = "voice",
): string {
  const fallback = DEFAULT_MESSAGES[context];
  const rawMessage = (() => {
    if (error instanceof Error) {
      return error.message;
    }
    if (isNonEmptyString(error)) {
      return error;
    }
    return fallback;
  })();

  const message = rawMessage.trim();
  if (!message) {
    return fallback;
  }

  if (message.includes("OpenAI Realtime endpoint rejected")) {
    return "OpenAI rejected the realtime connection setup.";
  }

  if (message.includes("Timed out waiting for the WebRTC connection")) {
    return "Timed out while establishing the realtime connection.";
  }

  if (message.includes("WebRTC connection failed with state:")) {
    return "The realtime connection failed before the session was ready.";
  }

  if (
    message.includes("An OpenAI API key must be set") ||
    message.includes("Missing OpenAI API key")
  ) {
    return "An OpenAI API key is required to start this session.";
  }

  if (message.includes("Failed to build the OpenAI Realtime endpoint URL")) {
    return "The configured OpenAI endpoint is invalid.";
  }

  if (message.includes("The local WebRTC session description is missing")) {
    return "The device could not prepare the realtime connection offer.";
  }

  if (message.includes("Could not decode the SDP answer returned by OpenAI")) {
    return "OpenAI returned an invalid realtime connection response.";
  }

  if (
    message.startsWith("{") ||
    message.startsWith("[") ||
    message.includes("Response body:")
  ) {
    return fallback;
  }

  const summary = firstLine(message);
  if (!summary) {
    return fallback;
  }

  return summary.length > 140 ? `${summary.slice(0, 139).trimEnd()}…` : summary;
}
