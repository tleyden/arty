import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  Platform,
  StyleSheet,
  View,
  type AppStateStatus,
} from "react-native";
import { AdvancedPanel } from "../components/realtime/AdvancedPanel";
import { LanguagePickerModal } from "../components/realtime/LanguagePickerModal";
import { LanguagePickerRow } from "../components/realtime/LanguagePickerRow";
import { SessionFooter } from "../components/realtime/SessionFooter";
import { TranscriptView } from "../components/realtime/TranscriptView";
import { log } from "../lib/logger";
import {
  DEFAULT_BIDIRECTIONAL_ENABLED,
  DEFAULT_BIDIRECTIONAL_LANGUAGE,
  DEFAULT_OUTPUT_LANGUAGE,
  DEFAULT_TRANSCRIPT_FONT_SIZE,
  DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  loadBidirectionalEnabled,
  loadBidirectionalLanguage,
  loadOutputLanguage,
  loadTranscriptFontSize,
  loadTranslationIdleTimeoutSeconds,
  loadTranslationInputTranscriptionEnabled,
  loadTranslationInputTranscriptionModel,
  loadTranslationNoiseReductionType,
  saveBidirectionalEnabled,
  saveOutputLanguage,
} from "../lib/translationSettings";
import type {
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

type RealtimeTranslationProps = {
  baseConnectionOptions: BaseOpenAIConnectionOptions | null;
  hasMicPermission: boolean;
  permissionError: string | null;
  transcriptFontSize?: number;
};

export function RealtimeTranslation({
  baseConnectionOptions,
  hasMicPermission,
  permissionError,
  transcriptFontSize: transcriptFontSizeProp,
}: RealtimeTranslationProps) {
  const [outputLanguage, setOutputLanguage] = useState(DEFAULT_OUTPUT_LANGUAGE);
  const [languageModalVisible, setLanguageModalVisible] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [audioOutput, setAudioOutput] = useState<AudioOutput>("handset");
  const [isMuted, setIsMuted] = useState(false);
  const [isBidirectional, setIsBidirectional] = useState(DEFAULT_BIDIRECTIONAL_ENABLED);
  const [bidirectionalLanguage, setBidirectionalLanguage] = useState(DEFAULT_BIDIRECTIONAL_LANGUAGE);
  const [statusText, setStatusText] = useState("Ready · speak in any language");
  const [inputTranscript, setInputTranscript] = useState("");
  const [outputTranscript, setOutputTranscript] = useState("");
  const [transcriptFontSizeLocal, setTranscriptFontSizeLocal] = useState(
    DEFAULT_TRANSCRIPT_FONT_SIZE,
  );
  const transcriptFontSize = transcriptFontSizeProp ?? transcriptFontSizeLocal;

  const idleTimeoutSecondsRef = useRef(
    DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  );
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadTranslationIdleTimeoutSeconds().then((seconds) => {
      idleTimeoutSecondsRef.current = seconds;
    });
    loadTranscriptFontSize().then(setTranscriptFontSizeLocal);
    loadOutputLanguage().then(setOutputLanguage);
    loadBidirectionalEnabled().then(setIsBidirectional);
    loadBidirectionalLanguage().then(setBidirectionalLanguage);
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
        log.debug("🎤 → 📝 Source transcript delta", {}, { delta: payload.delta });
        setInputTranscript((prev) => {
          const sep =
            prev && !prev.endsWith(" ") && !payload.delta.startsWith(" ")
              ? " "
              : "";
          return prev + sep + payload.delta;
        });
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
        log.debug("🌐 → 📝 Translation transcript delta", {}, { delta: payload.delta });
        setOutputTranscript((prev) => {
          const sep =
            prev && !prev.endsWith(" ") && !payload.delta.startsWith(" ")
              ? " "
              : "";
          return prev + sep + payload.delta;
        });
        resetIdleTimer();
      },
    );
    return () => sub.remove?.();
  }, [resetIdleTimer]);

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
    }
  }, [isSessionActive, isStopping]);

  const handleToggleSpeakerphone = useCallback((nextValue: boolean) => {
    setAudioOutput(nextValue ? "speakerphone" : "handset");
  }, []);

  const handleToggleMute = useCallback((nextValue: boolean) => {
    setIsMuted(nextValue);
    try {
      muteUnmuteOutgoingAudio(nextValue);
    } catch (e) {
      log.warn("[RealtimeTranslation] muteUnmuteOutgoingAudio unavailable", {}, { error: e });
    }
  }, []);

  const handleToggleBidirectional = useCallback((nextValue: boolean) => {
    setIsBidirectional(nextValue);
    void saveBidirectionalEnabled(nextValue);
  }, []);

  const handleSelectLanguage = useCallback((code: string) => {
    setOutputLanguage(code);
    saveOutputLanguage(code);
  }, []);

  const isSpeakerphone = audioOutput === "speakerphone";

  return (
    <View style={styles.content}>
      <LanguagePickerRow
        outputLanguage={outputLanguage}
        isSessionActive={isSessionActive}
        onSelectLanguage={handleSelectLanguage}
        onOpenModal={() => setLanguageModalVisible(true)}
      />

      <LanguagePickerModal
        visible={languageModalVisible}
        outputLanguage={outputLanguage}
        onClose={() => setLanguageModalVisible(false)}
        onSelectLanguage={handleSelectLanguage}
      />

      <View style={styles.middleSection}>
        <AdvancedPanel
          isSpeakerphone={isSpeakerphone}
          isMuted={isMuted}
          isBidirectional={isBidirectional}
          bidirectionalLanguage={bidirectionalLanguage}
          onToggleSpeakerphone={handleToggleSpeakerphone}
          onToggleMute={handleToggleMute}
          onToggleBidirectional={handleToggleBidirectional}
        />

        <TranscriptView
          inputTranscript={inputTranscript}
          outputTranscript={outputTranscript}
          transcriptFontSize={transcriptFontSize}
        />
      </View>

      <SessionFooter
        isSessionActive={isSessionActive}
        isStopping={isStopping}
        isConnecting={isConnecting}
        hasMicPermission={hasMicPermission}
        permissionError={permissionError}
        statusText={statusText}
        onStart={handleStart}
        onStop={handleStop}
      />
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
  middleSection: {
    flex: 1,
    width: "100%",
    paddingTop: 8,
  },
});
