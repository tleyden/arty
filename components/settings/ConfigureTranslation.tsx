import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  loadTranslationIdleTimeoutSeconds,
  saveTranslationIdleTimeoutSeconds,
} from "../../lib/translationSettings";
import { BottomSheet } from "../ui/BottomSheet";

const MIN_IDLE_TIMEOUT = 10;
const MAX_IDLE_TIMEOUT = 300;

interface ConfigureTranslationProps {
  visible: boolean;
  onClose: () => void;
}

export const ConfigureTranslation: React.FC<ConfigureTranslationProps> = ({
  visible,
  onClose,
}) => {
  const [idleTimeout, setIdleTimeout] = useState(
    DEFAULT_TRANSLATION_IDLE_TIMEOUT_SECONDS,
  );

  useEffect(() => {
    if (visible) {
      loadTranslationIdleTimeoutSeconds().then(setIdleTimeout);
    }
  }, [visible]);

  const adjust = (delta: number) => {
    const next = Math.min(MAX_IDLE_TIMEOUT, Math.max(MIN_IDLE_TIMEOUT, idleTimeout + delta));
    if (next !== idleTimeout) {
      setIdleTimeout(next);
      void saveTranslationIdleTimeoutSeconds(next);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Configure Translation">
      <View style={styles.body}>
        <Text style={styles.lead}>
          Configure options for real-time translation sessions.
        </Text>
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
              onPress={() => adjust(-10)}
              disabled={idleTimeout <= MIN_IDLE_TIMEOUT}
              style={({ pressed }) => [
                styles.stepperButton,
                idleTimeout <= MIN_IDLE_TIMEOUT && styles.stepperButtonDisabled,
                pressed && idleTimeout > MIN_IDLE_TIMEOUT && styles.stepperButtonPressed,
              ]}
            >
              <Text style={styles.stepperButtonText}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{idleTimeout}s</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase idle timeout"
              onPress={() => adjust(10)}
              disabled={idleTimeout >= MAX_IDLE_TIMEOUT}
              style={({ pressed }) => [
                styles.stepperButton,
                idleTimeout >= MAX_IDLE_TIMEOUT && styles.stepperButtonDisabled,
                pressed && idleTimeout < MAX_IDLE_TIMEOUT && styles.stepperButtonPressed,
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
    gap: 16,
    paddingBottom: 16,
  },
  lead: {
    fontSize: 15,
    lineHeight: 20,
    color: "#3A3A3C",
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
});
