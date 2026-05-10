import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from "react-native";
import { MiniVisualizer } from "../components/AudioVisualizer";
import { MuteToggle } from "../components/MuteToggle";
import { SpeakerModeToggle } from "../components/SpeakerModeToggle";
import { log } from "../lib/logger";
import {
  DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  loadTranslationIdleTimeoutSeconds,
  loadTranslationInputTranscriptionEnabled,
  loadTranslationInputTranscriptionModel,
  loadTranslationNoiseReductionType,
} from "../lib/translationSettings";
import type {
  AudioMetricsEventPayload,
  BaseOpenAIConnectionOptions,
  OpenAIConnectionState,
  RealtimeErrorEventPayload,
  VoiceSessionStatusEventPayload,
} from "../modules/vm-webrtc";
import VmWebrtcTranslatorModule, {
  closeTranslationConnectionAsync,
  muteUnmuteOutgoingAudio,
  openTranslationConnectionAsync,
  type TranslationTranscriptEventPayload,
} from "../modules/vm-webrtc/src/VmWebrtcTranslatorModule";

type AudioOutput = "handset" | "speakerphone";

type TranslationLanguage = {
  code: string;
  name: string;
  flag: string;
};

const TRANSLATION_OUTPUT_LANGUAGES: TranslationLanguage[] = [
  { code: "en", name: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", flag: "🇪🇸" },
  { code: "de", name: "German", flag: "🇩🇪" },
  { code: "pt", name: "Portuguese", flag: "🇧🇷" },
  { code: "fr", name: "French", flag: "🇫🇷" },
  { code: "ja", name: "Japanese", flag: "🇯🇵" },
  { code: "ru", name: "Russian", flag: "🇷🇺" },
  { code: "zh", name: "Chinese", flag: "🇨🇳" },
  { code: "ko", name: "Korean", flag: "🇰🇷" },
  { code: "hi", name: "Hindi", flag: "🇮🇳" },
  { code: "id", name: "Indonesian", flag: "🇮🇩" },
  { code: "vi", name: "Vietnamese", flag: "🇻🇳" },
  { code: "it", name: "Italian", flag: "🇮🇹" },
];

const FEATURED_LANGUAGE_CODES = ["de", "en", "es"];
const featuredLanguages = TRANSLATION_OUTPUT_LANGUAGES.filter((l) =>
  FEATURED_LANGUAGE_CODES.includes(l.code),
);
const moreLanguages = TRANSLATION_OUTPUT_LANGUAGES.filter(
  (l) => !FEATURED_LANGUAGE_CODES.includes(l.code),
);

type RealtimeTranslationProps = {
  baseConnectionOptions: BaseOpenAIConnectionOptions | null;
  hasMicPermission: boolean;
  permissionError: string | null;
};

export function RealtimeTranslation({
  baseConnectionOptions,
  hasMicPermission,
  permissionError,
}: RealtimeTranslationProps) {
  const [outputLanguage, setOutputLanguage] = useState("de");
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [audioOutput, setAudioOutput] = useState<AudioOutput>("handset");
  const [isMuted, setIsMuted] = useState(false);
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  const [frequencyBins, setFrequencyBins] = useState<number[]>([]);
  const [statusText, setStatusText] = useState("Ready · speak in any language");
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");

  const idleTimeoutSecondsRef = useRef(
    DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  );
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadTranslationIdleTimeoutSeconds().then((seconds) => {
      idleTimeoutSecondsRef.current = seconds;
    });
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(async () => {
      log.warn("Translation session ended due to inactivity", {});
      try {
        await closeTranslationConnectionAsync();
      } catch {
        // ignore close errors during idle timeout
      }
      setIsSessionActive(false);
      setIsStopping(false);
      setIsConnecting(false);
      setFrequencyBins([]);
      Alert.alert("Session Ended", "Disconnected due to inactivity.");
    }, idleTimeoutSecondsRef.current * 1000);
  }, []);

  useEffect(() => {
    if (isSessionActive) {
      resetIdleTimer();
    } else {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }
    return () => {
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [isSessionActive, resetIdleTimer]);

  useEffect(() => {
    if (!VmWebrtcTranslatorModule?.addListener) return undefined;
    const sub = VmWebrtcTranslatorModule.addListener(
      "onVoiceSessionStatus",
      (payload: VoiceSessionStatusEventPayload) => {
        setStatusText(payload.status_update);
      },
    );
    return () => sub.remove?.();
  }, []);

  useEffect(() => {
    if (!VmWebrtcTranslatorModule?.addListener) return undefined;
    const sub = VmWebrtcTranslatorModule.addListener(
      "onTranslationInputTranscript",
      (payload: TranslationTranscriptEventPayload) => {
        log.debug("Translation input delta", {}, { delta: payload.delta });
        setInputTranscript((prev) => prev + payload.delta);
        resetIdleTimer();
      },
    );
    return () => sub.remove?.();
  }, [resetIdleTimer]);

  useEffect(() => {
    if (!VmWebrtcTranslatorModule?.addListener) return undefined;
    const sub = VmWebrtcTranslatorModule.addListener(
      "onTranslationOutputTranscript",
      (payload: TranslationTranscriptEventPayload) => {
        log.debug("Translation output delta", {}, { delta: payload.delta });
        setOutputTranscript((prev) => prev + payload.delta);
        resetIdleTimer();
      },
    );
    return () => sub.remove?.();
  }, [resetIdleTimer]);

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
    if (!VmWebrtcTranslatorModule?.addListener) return undefined;
    const sub = VmWebrtcTranslatorModule.addListener(
      "onRealtimeError",
      (payload: RealtimeErrorEventPayload) => {
        log.error(
          "Translation session error",
          {},
          {
            errorType: payload?.error?.type,
            errorCode: payload?.error?.code,
            errorMessage: payload?.error?.message,
          },
        );
      },
    );
    return () => sub.remove?.();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        log.info(
          "App state changed during translation session",
          {},
          { newState: nextAppState, isSessionActive },
        );
      },
    );
    return () => sub.remove();
  }, [isSessionActive]);

  const handleStart = useCallback(async () => {
    if (isSessionActive || isConnecting) return;

    if (Platform.OS !== "ios") {
      Alert.alert(
        "Translation",
        "Voice sessions are currently limited to iOS.",
      );
      return;
    }
    if (!hasMicPermission) {
      Alert.alert(
        "Translation",
        "Please enable microphone access to start a session.",
      );
      return;
    }
    if (!baseConnectionOptions) {
      Alert.alert(
        "Translation",
        "Missing EXPO_PUBLIC_OPENAI_API_KEY environment variable.",
      );
      return;
    }

    setIsConnecting(true);
    setIsSessionActive(false);
    setInputTranscript("");
    setOutputTranscript("");

    try {
      const [noiseReductionType, transcriptionEnabled, transcriptionModel] =
        await Promise.all([
          loadTranslationNoiseReductionType(),
          loadTranslationInputTranscriptionEnabled(),
          loadTranslationInputTranscriptionModel(),
        ]);

      log.info(
        "Starting translation session",
        {},
        {
          outputLanguage,
          audioOutput,
          noiseReductionType,
          transcriptionEnabled,
          transcriptionModel,
        },
      );
      const state: OpenAIConnectionState = await openTranslationConnectionAsync(
        {
          apiKey: baseConnectionOptions.apiKey,
          baseUrl: baseConnectionOptions.baseUrl,
          audioOutput,
          outputLanguage,
          ...(noiseReductionType !== "disabled" && { noiseReductionType }),
          ...(transcriptionEnabled && {
            inputTranscriptionModel: transcriptionModel,
          }),
        },
      );
      log.info("Translation session resolved", {}, { state });
      const connected = state === "connected" || state === "completed";
      setIsSessionActive(connected);
      if (!connected) setFrequencyBins([]);
    } catch (error) {
      log.error(
        "Failed to start translation session",
        {},
        {
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        error,
      );
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      Alert.alert("Translation", message);
      setIsSessionActive(false);
      setFrequencyBins([]);
    } finally {
      setIsConnecting(false);
    }
  }, [
    audioOutput,
    baseConnectionOptions,
    hasMicPermission,
    isConnecting,
    isSessionActive,
    outputLanguage,
  ]);

  const handleStop = useCallback(async () => {
    if (!isSessionActive || isStopping) return;
    setIsStopping(true);
    try {
      const state: OpenAIConnectionState =
        await closeTranslationConnectionAsync();
      log.info("Translation session closed", {}, { state });
    } catch (error) {
      log.error(
        "Failed to stop translation session",
        {},
        {
          errorMessage: error instanceof Error ? error.message : String(error),
        },
        error,
      );
      const message =
        error instanceof Error ? error.message : "Unexpected error";
      Alert.alert("Translation", message);
    } finally {
      setIsStopping(false);
      setIsSessionActive(false);
      setIsConnecting(false);
      setFrequencyBins([]);
    }
  }, [isSessionActive, isStopping]);

  const handleToggleSpeakerphone = useCallback((nextValue: boolean) => {
    setAudioOutput(nextValue ? "speakerphone" : "handset");
  }, []);

  const handleToggleMute = useCallback((nextValue: boolean) => {
    setIsMuted(nextValue);
    muteUnmuteOutgoingAudio(nextValue);
  }, []);

  const isSpeakerphone = audioOutput === "speakerphone";
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

  const showTranscripts =
    inputTranscript.length > 0 || outputTranscript.length > 0;

  return (
    <View style={styles.content}>
      {/* TOP: language picker — fixed, always visible */}
      <View style={styles.topSection}>
        <Text style={styles.languagePickerLabel}>
          Translate from your native tongue to
        </Text>
        <View style={styles.languagePickerRow}>
          {featuredLanguages.map((lang) => {
            const isSelected = outputLanguage === lang.code;
            return (
              <Pressable
                key={lang.code}
                onPress={() => !isSessionActive && setOutputLanguage(lang.code)}
                style={[
                  styles.langChip,
                  isSelected && styles.langChipSelected,
                  isSessionActive && styles.langChipDisabled,
                ]}
              >
                <Text style={styles.langFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.langName,
                    isSelected && styles.langNameSelected,
                  ]}
                >
                  {lang.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => !isSessionActive && setLanguageModalVisible(true)}
            style={[
              styles.langChip,
              styles.langChipMore,
              isSessionActive && styles.langChipDisabled,
              !FEATURED_LANGUAGE_CODES.includes(outputLanguage) &&
                styles.langChipSelected,
            ]}
          >
            {(() => {
              const selected = !FEATURED_LANGUAGE_CODES.includes(outputLanguage)
                ? TRANSLATION_OUTPUT_LANGUAGES.find(
                    (l) => l.code === outputLanguage,
                  )
                : null;
              return (
                <>
                  <Text style={styles.langFlag}>
                    {selected ? selected.flag : "🌐"}
                  </Text>
                  <Text
                    style={[
                      styles.langName,
                      selected && styles.langNameSelected,
                    ]}
                    numberOfLines={1}
                  >
                    {selected ? selected.name : "More…"}
                  </Text>
                </>
              );
            })()}
          </Pressable>
        </View>
      </View>

      <Modal
        visible={languageModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setLanguageModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setLanguageModalVisible(false)}
        >
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Choose Language</Text>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {moreLanguages.map((lang) => {
                const isSelected = outputLanguage === lang.code;
                return (
                  <Pressable
                    key={lang.code}
                    onPress={() => {
                      setOutputLanguage(lang.code);
                      setLanguageModalVisible(false);
                    }}
                    style={({ pressed }) => [
                      styles.modalLangRow,
                      isSelected && styles.modalLangRowSelected,
                      pressed && styles.modalLangRowPressed,
                    ]}
                  >
                    <Text style={styles.modalLangFlag}>{lang.flag}</Text>
                    <Text
                      style={[
                        styles.modalLangName,
                        isSelected && styles.modalLangNameSelected,
                      ]}
                    >
                      {lang.name}
                    </Text>
                    {isSelected && <Text style={styles.modalCheckmark}>✓</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* MIDDLE: flexible area shared by Advanced and Translation */}
      <View style={styles.middleSection}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Toggle advanced customization"
          onPress={() => setIsAdvancedExpanded((p) => !p)}
          style={({ pressed }) => [
            styles.advancedToggle,
            pressed && styles.advancedTogglePressed,
          ]}
        >
          <Text style={styles.advancedToggleText}>Advanced</Text>
          <Text style={styles.advancedToggleChevron}>
            {isAdvancedExpanded ? "⌃" : "⌄"}
          </Text>
        </Pressable>

        {isAdvancedExpanded ? (
          <View style={styles.advancedPanel}>
            <SpeakerModeToggle
              value={isSpeakerphone}
              onValueChange={handleToggleSpeakerphone}
            />
            <MuteToggle value={isMuted} onValueChange={handleToggleMute} />
          </View>
        ) : null}

        {showTranscripts ? (
          <ScrollView
            style={styles.translationScroll}
            contentContainerStyle={styles.transcriptContent}
          >
            {inputTranscript ? (
              <View style={styles.transcriptBlock}>
                <Text style={styles.transcriptLabel}>You said</Text>
                <Text style={styles.transcriptText}>{inputTranscript}</Text>
              </View>
            ) : null}
            {outputTranscript ? (
              <View style={styles.transcriptBlock}>
                <Text style={styles.transcriptLabel}>Translation</Text>
                <Text style={styles.transcriptText}>{outputTranscript}</Text>
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </View>

      {/* BOTTOM: status + button — fixed, always visible */}
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
            const base: any[] = [styles.buttonBase];
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
          onPress={isSessionActive ? handleStop : handleStart}
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
    </View>
  );
}

export default RealtimeTranslation;

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  topSection: {
    width: "100%",
    marginBottom: 4,
  },
  middleSection: {
    flex: 1,
    width: "100%",
    paddingTop: 8,
  },
  translationScroll: {
    flex: 1,
    width: "100%",
    marginTop: 12,
  },
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
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5EA",
    backgroundColor: "#F8F8F8",
  },
  advancedTogglePressed: {
    backgroundColor: "#EFEFF4",
  },
  advancedToggleText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#1C1C1E",
    opacity: 0.7,
  },
  advancedToggleChevron: {
    fontSize: 18,
    color: "#8E8E93",
  },
  advancedPanel: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#E5E5EA",
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
    backgroundColor: "#FFFFFF",
    gap: 16,
    alignItems: "flex-start",
  },
  permissionWarning: {
    marginTop: 12,
    color: "#D0021B",
    fontSize: 14,
    textAlign: "center",
  },
  transcriptContent: {
    gap: 16,
    paddingHorizontal: 4,
  },
  transcriptBlock: {
    gap: 4,
  },
  transcriptLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  transcriptText: {
    fontSize: 15,
    color: "#1C1C1E",
    lineHeight: 22,
  },
  statusText: {
    fontSize: 14,
    color: "#8E8E93",
    textAlign: "center",
  },
  languagePickerLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  languagePickerRow: {
    flexDirection: "row",
    gap: 6,
  },
  langChip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#F2F2F7",
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#E5E5EA",
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 3,
  },
  langChipSelected: {
    backgroundColor: "#E8F5E8",
    borderColor: "#4CAF50",
  },
  langChipMore: {
    backgroundColor: "#F2F2F7",
  },
  langChipDisabled: {
    opacity: 0.45,
  },
  langFlag: {
    fontSize: 18,
  },
  langName: {
    fontSize: 9,
    fontWeight: "600",
    color: "#3C3C43",
    textAlign: "center",
  },
  langNameSelected: {
    color: "#2E7D32",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: "60%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C7C7CC",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  modalScroll: {
    paddingHorizontal: 20,
  },
  modalScrollContent: {
    gap: 8,
    paddingBottom: 8,
  },
  modalLangRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E5EA",
    backgroundColor: "#FAFAFA",
  },
  modalLangRowSelected: {
    borderColor: "#4CAF50",
    backgroundColor: "#E8F5E8",
  },
  modalLangRowPressed: {
    backgroundColor: "#F0F0F5",
  },
  modalLangFlag: {
    fontSize: 24,
  },
  modalLangName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  modalLangNameSelected: {
    color: "#2E7D32",
    fontWeight: "600",
  },
  modalCheckmark: {
    fontSize: 16,
    color: "#4CAF50",
  },
});
