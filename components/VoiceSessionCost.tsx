import { StyleSheet, Text, View } from "react-native";

export type LiveSessionCost = {
  seconds: number;
  voice: number;
  backend: number;
  backendPriced: boolean;
};

export function VoiceSessionCost({ totalUSD, live }: {
  totalUSD: number;
  live: LiveSessionCost | null;
}) {
  const formattedTotal = (Math.ceil(totalUSD * 100) / 100).toFixed(2);
  return (
    <View pointerEvents="none" style={styles.container}>
      <Text style={styles.total}>{`💵 ${live ? "~" : ""}$${formattedTotal}`}</Text>
      {live && (
        <Text style={styles.detail}>
          {`${Math.ceil(live.seconds)}s voice: $${live.voice.toFixed(3)} · ${
            live.backendPriced ? `Backend: $${live.backend.toFixed(4)}` : "Voice only; backend unpriced"
          }`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 4,
  },
  total: { fontSize: 24, fontWeight: "600", color: "#1C1C1E", textAlign: "center" },
  detail: { fontSize: 13, color: "#636366", textAlign: "center" },
});
