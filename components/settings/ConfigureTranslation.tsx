import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";

import {
  DEFAULT_TRANSCRIPT_FONT_SIZE,
  DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED,
  DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_MODEL,
  DEFAULT_TRANSLATION_NOISE_REDUCTION,
  TRANSCRIPT_FONT_SIZE_OPTIONS,
  type NoiseReductionType,
  loadTranscriptFontSize,
  loadTranslationIdleTimeoutSeconds,
  loadTranslationInputTranscriptionEnabled,
  loadTranslationInputTranscriptionModel,
  loadTranslationNoiseReductionType,
  saveTranscriptFontSize,
  saveTranslationIdleTimeoutSeconds,
  saveTranslationInputTranscriptionEnabled,
  saveTranslationInputTranscriptionModel,
  saveTranslationNoiseReductionType,
} from "../../lib/translationSettings";
import { BottomSheet } from "../ui/BottomSheet";

const MIN_IDLE_TIMEOUT = 10;
const MAX_IDLE_TIMEOUT = 300;

const NOISE_REDUCTION_OPTIONS: {
  value: NoiseReductionType;
  label: string;
  description: string;
}[] = [
  {
    value: "disabled",
    label: "Disabled",
    description: "No noise processing applied (server default).",
  },
  {
    value: "near_field",
    label: "Near Field",
    description: "Optimized for headsets and close-talking microphones.",
  },
  {
    value: "far_field",
    label: "Far Field",
    description: "Optimized for laptops and conference room microphones.",
  },
];

interface ConfigureTranslationProps {
  visible: boolean;
  onClose: () => void;
  onFontSizeChange?: (size: number) => void;
}

export const ConfigureTranslation: React.FC<ConfigureTranslationProps> = ({
  visible,
  onClose,
  onFontSizeChange,
}) => {
  const [idleTimeout, setIdleTimeout] = useState(
    DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  );
  const [noiseReduction, setNoiseReduction] = useState<NoiseReductionType>(
    DEFAULT_TRANSLATION_NOISE_REDUCTION,
  );
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(
    DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_ENABLED,
  );
  const [transcriptionModel] = useState(
    DEFAULT_TRANSLATION_INPUT_TRANSCRIPTION_MODEL,
  );
  const [transcriptFontSize, setTranscriptFontSize] = useState(
    DEFAULT_TRANSCRIPT_FONT_SIZE,
  );

  useEffect(() => {
    if (!visible) return;
    Promise.all([
      loadTranslationIdleTimeoutSeconds(),
      loadTranslationNoiseReductionType(),
      loadTranslationInputTranscriptionEnabled(),
      loadTranslationInputTranscriptionModel(),
      loadTranscriptFontSize(),
    ]).then(([timeout, noise, transcription, , fontSize]) => {
      setIdleTimeout(timeout);
      setNoiseReduction(noise);
      setTranscriptionEnabled(transcription);
      setTranscriptFontSize(fontSize);
    });
  }, [visible]);

  const adjustIdleTimeout = (delta: number) => {
    const next = Math.min(
      MAX_IDLE_TIMEOUT,
      Math.max(MIN_IDLE_TIMEOUT, idleTimeout + delta),
    );
    if (next !== idleTimeout) {
      setIdleTimeout(next);
      void saveTranslationIdleTimeoutSeconds(next);
    }
  };

  const handleNoiseReductionChange = (value: NoiseReductionType) => {
    setNoiseReduction(value);
    void saveTranslationNoiseReductionType(value);
  };

  const handleTranscriptionToggle = (enabled: boolean) => {
    setTranscriptionEnabled(enabled);
    void saveTranslationInputTranscriptionEnabled(enabled);
    if (enabled) {
      void saveTranslationInputTranscriptionModel(transcriptionModel);
    }
  };

  const adjustFontSize = (delta: number) => {
    const idx = TRANSCRIPT_FONT_SIZE_OPTIONS.indexOf(transcriptFontSize);
    const nextIdx = Math.min(
      TRANSCRIPT_FONT_SIZE_OPTIONS.length - 1,
      Math.max(0, idx + delta),
    );
    const next = TRANSCRIPT_FONT_SIZE_OPTIONS[nextIdx];
    if (next !== transcriptFontSize) {
      setTranscriptFontSize(next);
      void saveTranscriptFontSize(next);
      onFontSizeChange?.(next);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Configure Translation">
      <View style={styles.body}>
        <Text style={styles.lead}>
          Configure options for real-time translation sessions.
        </Text>

        {/* Idle Timeout */}
        <View style={styles.optionCard}>
          <View style={styles.optionCopy}>
            <Text style={styles.optionTitle}>Idle Timeout</Text>
            <Text style={styles.optionSubtitle}>
              Hang up if no speech is detected for this many seconds.
            </Text>
          </View>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease idle timeout"
              onPress={() => adjustIdleTimeout(-10)}
              disabled={idleTimeout <= MIN_IDLE_TIMEOUT}
              style={({ pressed }) => [
                styles.stepperButton,
                idleTimeout <= MIN_IDLE_TIMEOUT && styles.stepperButtonDisabled,
                pressed &&
                  idleTimeout > MIN_IDLE_TIMEOUT &&
                  styles.stepperButtonPressed,
              ]}
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{idleTimeout}s</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase idle timeout"
              onPress={() => adjustIdleTimeout(10)}
              disabled={idleTimeout >= MAX_IDLE_TIMEOUT}
              style={({ pressed }) => [
                styles.stepperButton,
                idleTimeout >= MAX_IDLE_TIMEOUT && styles.stepperButtonDisabled,
                pressed &&
                  idleTimeout < MAX_IDLE_TIMEOUT &&
                  styles.stepperButtonPressed,
              ]}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </Pressable>
          </View>
        </View>

        {/* Noise Reduction */}
        <Text style={styles.sectionLabel}>Noise Reduction</Text>
        <View style={styles.radioGroup}>
          {NOISE_REDUCTION_OPTIONS.map((opt) => {
            const isSelected = noiseReduction === opt.value;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                onPress={() => handleNoiseReductionChange(opt.value)}
                style={[styles.radioCard, isSelected && styles.radioCardSelected]}
              >
                <View
                  style={[
                    styles.radioOuter,
                    isSelected && styles.radioOuterSelected,
                  ]}
                >
                  {isSelected && <View style={styles.radioInner} />}
                </View>
                <View style={styles.radioCopy}>
                  <Text style={styles.radioLabel}>{opt.label}</Text>
                  <Text style={styles.radioDescription}>{opt.description}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Input Transcription */}
        <Text style={styles.sectionLabel}>Input Transcription</Text>
        <View style={styles.optionCard}>
          <View style={styles.optionCopy}>
            <Text style={styles.optionTitle}>Transcribe Source Audio</Text>
            <Text style={styles.optionSubtitle}>
              Receive source-language text transcripts of the speaker's audio.
              Language is detected automatically.
            </Text>
          </View>
          <Switch
            value={transcriptionEnabled}
            onValueChange={handleTranscriptionToggle}
            trackColor={{ false: "#D1D1D6", true: "#34C759" }}
            thumbColor="#FFFFFF"
            ios_backgroundColor="#D1D1D6"
          />
        </View>
        {transcriptionEnabled && (
          <View style={styles.modelRow}>
            <Text style={styles.modelLabel}>Model</Text>
            <Text style={styles.modelValue}>{transcriptionModel}</Text>
          </View>
        )}

        {/* Transcript Font Size */}
        <View style={styles.optionCard}>
          <View style={styles.optionCopy}>
            <Text style={styles.optionTitle}>Transcript Font Size</Text>
            <Text style={styles.optionSubtitle}>
              Size of the transcription text displayed during translation.
            </Text>
          </View>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease font size"
              onPress={() => adjustFontSize(-1)}
              disabled={transcriptFontSize <= TRANSCRIPT_FONT_SIZE_OPTIONS[0]}
              style={({ pressed }) => [
                styles.stepperButton,
                transcriptFontSize <= TRANSCRIPT_FONT_SIZE_OPTIONS[0] &&
                  styles.stepperButtonDisabled,
                pressed &&
                  transcriptFontSize > TRANSCRIPT_FONT_SIZE_OPTIONS[0] &&
                  styles.stepperButtonPressed,
              ]}
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{transcriptFontSize}pt</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase font size"
              onPress={() => adjustFontSize(1)}
              disabled={
                transcriptFontSize >=
                TRANSCRIPT_FONT_SIZE_OPTIONS[TRANSCRIPT_FONT_SIZE_OPTIONS.length - 1]
              }
              style={({ pressed }) => [
                styles.stepperButton,
                transcriptFontSize >=
                  TRANSCRIPT_FONT_SIZE_OPTIONS[
                    TRANSCRIPT_FONT_SIZE_OPTIONS.length - 1
                  ] && styles.stepperButtonDisabled,
                pressed &&
                  transcriptFontSize <
                    TRANSCRIPT_FONT_SIZE_OPTIONS[
                      TRANSCRIPT_FONT_SIZE_OPTIONS.length - 1
                    ] &&
                  styles.stepperButtonPressed,
              ]}
            >
              <Text style={styles.stepperButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: 12,
    paddingBottom: 16,
  },
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6E6E73",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 8,
    marginBottom: 2,
  },
  optionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  optionCopy: {
    flex: 1,
    marginRight: 12,
    gap: 4,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  optionSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: "#636366",
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#F2F2F7",
    alignItems: "center",
    justifyContent: "center",
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperButtonPressed: {
    backgroundColor: "#E5E5EA",
  },
  stepperButtonText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1C1C1E",
    lineHeight: 22,
  },
  stepperValue: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
    minWidth: 40,
    textAlign: "center",
  },
  radioGroup: {
    gap: 8,
  },
  radioCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  radioCardSelected: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F6FF",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#C7C7CC",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    flexShrink: 0,
  },
  radioOuterSelected: {
    borderColor: "#0A84FF",
  },
  radioInner: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: "#0A84FF",
  },
  radioCopy: {
    flex: 1,
    gap: 2,
  },
  radioLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  radioDescription: {
    fontSize: 13,
    lineHeight: 17,
    color: "#636366",
  },
  modelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#F2F2F7",
    borderRadius: 10,
  },
  modelLabel: {
    fontSize: 14,
    color: "#6E6E73",
  },
  modelValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#1C1C1E",
  },
});
