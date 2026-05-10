import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { TRANSLATION_OUTPUT_LANGUAGES } from "../../lib/translationLanguages";
import { MuteToggle } from "../MuteToggle";
import { SpeakerModeToggle } from "../SpeakerModeToggle";

type Props = {
  isSpeakerphone: boolean;
  isMuted: boolean;
  isBidirectional: boolean;
  bidirectionalLanguage: string;
  onToggleSpeakerphone: (value: boolean) => void;
  onToggleMute: (value: boolean) => void;
  onToggleBidirectional: (value: boolean) => void;
};

export function AdvancedPanel({
  isSpeakerphone,
  isMuted,
  isBidirectional,
  bidirectionalLanguage,
  onToggleSpeakerphone,
  onToggleMute,
  onToggleBidirectional,
}: Props) {
  const [isExpanded, setIsExpanded] = useState(false);

  const biLang = TRANSLATION_OUTPUT_LANGUAGES.find(
    (l) => l.code === bidirectionalLanguage,
  );

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
          <View style={styles.biRow}>
            <View style={styles.biCopy}>
              <Text style={styles.biLabel}>Bidirectional</Text>
              {isBidirectional && biLang ? (
                <Text style={styles.biSub}>
                  {biLang.flag} {biLang.name} · change in Configure
                </Text>
              ) : null}
            </View>
            <Switch
              value={isBidirectional}
              onValueChange={onToggleBidirectional}
              trackColor={{ false: "#D1D1D6", true: "#34C759" }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#D1D1D6"
            />
          </View>
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
  biRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  biCopy: {
    flex: 1,
    marginRight: 12,
  },
  biLabel: {
    fontSize: 15,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  biSub: {
    fontSize: 12,
    color: "#636366",
    marginTop: 2,
  },
});
