import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  REALTIME_MODEL_OPTIONS,
  type RealtimeModel,
  type RealtimeModelOption,
} from "../../lib/realtimeModelPreference";
import { BottomSheet } from "../ui/BottomSheet";

interface ConfigureRealtimeModelProps {
  visible: boolean;
  selectedModel: RealtimeModel;
  onSelectModel: (model: RealtimeModel) => void;
  onClose: () => void;
  models?: RealtimeModelOption[];
}

export const ConfigureRealtimeModel: React.FC<ConfigureRealtimeModelProps> = ({
  visible,
  selectedModel,
  onSelectModel,
  onClose,
  models = REALTIME_MODEL_OPTIONS,
}) => {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Choose Model">
      <ScrollView
        contentContainerStyle={styles.body}
        style={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lead}>
          Choose which realtime voice model powers new iOS voice sessions.
        </Text>
        <View style={styles.optionList}>
          {models.map((model) => {
            const isSelected = model.value === selectedModel;

            return (
              <Pressable
                key={model.value}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => onSelectModel(model.value)}
                style={({ pressed }) => [
                  styles.optionCard,
                  isSelected && styles.optionCardSelected,
                  pressed && styles.optionCardPressed,
                ]}
              >
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{model.title}</Text>
                  <Text style={styles.optionSubtitle}>{model.description}</Text>
                </View>
                <Text
                  style={[
                    styles.optionCheckmark,
                    isSelected ? styles.optionCheckmarkActive : null,
                  ]}
                >
                  {isSelected ? "●" : "○"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.helperText}>
          This only affects voice assistant sessions. Translation continues to
          use its dedicated translation model.
        </Text>
      </ScrollView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  scrollContainer: {
    maxHeight: 420,
  },
  body: {
    gap: 16,
    paddingBottom: 12,
  },
  lead: {
    fontSize: 16,
    color: "#3A3A3C",
  },
  optionList: {
    gap: 12,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D1D1D6",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  optionCardSelected: {
    borderColor: "#0A84FF",
    backgroundColor: "#F0F6FF",
  },
  optionCardPressed: {
    backgroundColor: "#E5F1FF",
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
  optionCheckmark: {
    fontSize: 20,
    color: "#AEAEB2",
  },
  optionCheckmarkActive: {
    color: "#0A84FF",
  },
  helperText: {
    fontSize: 12,
    color: "#8E8E93",
  },
});
