import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MiniVisualizer } from "../AudioVisualizer";
import type { AudioMetricsEventPayload } from "../../modules/vm-webrtc";
import VmWebrtcTranslatorModule from "../../modules/vm-webrtc/src/VmWebrtcTranslatorModule";

type Props = {
  isSessionActive: boolean;
  isStopping: boolean;
  isConnecting: boolean;
  hasMicPermission: boolean;
  permissionError: string | null;
  statusText: string;
  onStart: () => void;
  onStop: () => void;
};

export function SessionFooter({
  isSessionActive,
  isStopping,
  isConnecting,
  hasMicPermission,
  permissionError,
  statusText,
  onStart,
  onStop,
}: Props) {
  const [frequencyBins, setFrequencyBins] = useState<number[]>([]);

  useEffect(() => {
    if (!VmWebrtcTranslatorModule?.addListener) return undefined;
    const sub = VmWebrtcTranslatorModule.addListener(
      "onAudioMetrics",
      (payload: AudioMetricsEventPayload) => {
        if (Array.isArray(payload.fftBins)) {
          const normalized = (payload.fftBins as number[]).map((db) => {
            const clamped = Math.max(-120, Math.min(30, db));
            return Math.pow((clamped + 120) / 150, 1.5);
          });
          setFrequencyBins(normalized);
        }
      },
    );
    return () => sub.remove?.();
  }, []);

  useEffect(() => {
    if (!isSessionActive) {
      setFrequencyBins([]);
    }
  }, [isSessionActive]);

  const isButtonDisabled = isSessionActive
    ? isStopping
    : isConnecting || !hasMicPermission;

  const buttonLabel = isStopping
    ? "Stopping…"
    : isConnecting
      ? "Connecting…"
      : isSessionActive
        ? "⏹️ Stop Translating"
        : "🎙️🌐 Start Translating";

  return (
    <View style={styles.bottomSection}>
      <MiniVisualizer
        active={isSessionActive || frequencyBins.length > 0}
        mode="user"
        barCount={8}
        height={56}
        mirror={false}
        gap={6}
        radius={4}
        smooth={0.75}
        samples={frequencyBins}
      />
      <Text style={styles.statusText}>{statusText}</Text>
      {!hasMicPermission && permissionError ? (
        <Text style={styles.permissionWarning}>{permissionError}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isSessionActive ? "Stop translating" : "Start translating"
        }
        style={({ pressed }) => {
          const base: object[] = [styles.buttonBase];
          base.push(isSessionActive ? styles.stopButton : styles.startButton);
          if (isButtonDisabled) {
            base.push(styles.disabledButton);
          } else {
            base.push(styles.buttonShadow);
            if (pressed) {
              base.push(
                isSessionActive
                  ? styles.stopButtonPressed
                  : styles.startButtonPressed,
              );
            }
          }
          return base;
        }}
        onPress={isSessionActive ? onStop : onStart}
        disabled={isButtonDisabled}
      >
        <Text
          style={[
            styles.buttonText,
            isSessionActive ? styles.stopButtonText : styles.startButtonText,
            isButtonDisabled && styles.disabledButtonText,
          ]}
        >
          {buttonLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bottomSection: {
    width: "100%",
    alignItems: "center",
    paddingBottom: 16,
    gap: 8,
  },
  buttonBase: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    minWidth: 220,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
  },
  buttonShadow: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  startButton: {
    backgroundColor: "#E8F5E8",
    borderColor: "#4CAF50",
    paddingVertical: 18,
    paddingHorizontal: 30,
    minWidth: 275,
    minHeight: 55,
  },
  startButtonPressed: {
    backgroundColor: "#DDEFD9",
    borderColor: "#4CAF50",
  },
  stopButton: {
    backgroundColor: "#FFE8E8",
    borderColor: "#FF6B6B",
  },
  stopButtonPressed: {
    backgroundColor: "#F9DADA",
    borderColor: "#FF6B6B",
  },
  disabledButton: {
    backgroundColor: "#F5F5F5",
    borderColor: "#CCCCCC",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "600",
  },
  startButtonText: {
    color: "#2E7D32",
    fontWeight: "700",
  },
  stopButtonText: {
    color: "#D32F2F",
  },
  disabledButtonText: {
    color: "#8E8E93",
  },
  statusText: {
    fontSize: 14,
    color: "#8E8E93",
    textAlign: "center",
  },
  permissionWarning: {
    marginTop: 12,
    color: "#D0021B",
    fontSize: 14,
    textAlign: "center",
  },
});
