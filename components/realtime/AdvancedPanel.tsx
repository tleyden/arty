import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MuteToggle } from "../MuteToggle";
import { SpeakerModeToggle } from "../SpeakerModeToggle";

type Props = {
  isSpeakerphone: boolean;
  isMuted: boolean;
  onToggleSpeakerphone: (value: boolean) => void;
  onToggleMute: (value: boolean) => void;
};

export function AdvancedPanel({
  isSpeakerphone,
  isMuted,
  onToggleSpeakerphone,
  onToggleMute,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle advanced customization"
        onPress={() => setIsExpanded((p) => !p)}
        style={({ pressed }) => [
          styles.advancedToggle,
          pressed && styles.advancedTogglePressed,
        ]}
      >
        <Text style={styles.advancedToggleText}>Advanced</Text>
        <Text style={styles.advancedToggleChevron}>
          {isExpanded ? "⌃" : "⌄"}
        </Text>
      </Pressable>

      {isExpanded ? (
        <View style={styles.advancedPanel}>
          <SpeakerModeToggle
            value={isSpeakerphone}
            onValueChange={onToggleSpeakerphone}
          />
          <MuteToggle value={isMuted} onValueChange={onToggleMute} />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
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
});
