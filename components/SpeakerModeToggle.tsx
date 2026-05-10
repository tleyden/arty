import { StyleSheet, Switch, Text, View } from "react-native";

type Props = {
  value: boolean;
  onValueChange: (v: boolean) => void;
};

export function SpeakerModeToggle({ value, onValueChange }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>Speaker Mode</Text>
      <View style={styles.control}>
        <Text style={styles.icon}>{value ? "🔊" : "🔈"}</Text>
        <Switch
          accessibilityLabel="Toggle speakerphone output"
          value={value}
          onValueChange={onValueChange}
          ios_backgroundColor="#D1D1D6"
          trackColor={{ false: "#D1D1D6", true: "#34C759" }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "stretch",
    gap: 16,
  },
  label: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  control: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    fontSize: 20,
  },
});
