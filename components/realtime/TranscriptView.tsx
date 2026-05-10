import { useEffect, useRef } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

type Props = {
  inputTranscript: string;
  outputTranscript: string;
  transcriptFontSize: number;
};

const SCROLL_BOTTOM_THRESHOLD = 20;

export function TranscriptView({
  inputTranscript,
  outputTranscript,
  transcriptFontSize,
}: Props) {
  const scrollViewRef = useRef<ScrollView>(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current) {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }
  }, [inputTranscript, outputTranscript]);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - layoutMeasurement.height - contentOffset.y;
    autoScrollRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
  };

  if (!inputTranscript && !outputTranscript) return null;

  return (
    <ScrollView
      ref={scrollViewRef}
      style={styles.translationScroll}
      contentContainerStyle={styles.transcriptContent}
      onScroll={handleScroll}
      scrollEventThrottle={16}
      onScrollBeginDrag={() => {
        autoScrollRef.current = false;
      }}
    >
      {inputTranscript ? (
        <View style={styles.transcriptBlock}>
          <Text style={styles.transcriptLabel}>You said</Text>
          <Text
            style={[
              styles.transcriptText,
              {
                fontSize: transcriptFontSize,
                lineHeight: Math.round(transcriptFontSize * 1.47),
              },
            ]}
          >
            {inputTranscript}
          </Text>
        </View>
      ) : null}
      {outputTranscript ? (
        <View style={styles.transcriptBlock}>
          <Text style={styles.transcriptLabel}>Translation</Text>
          <Text
            style={[
              styles.transcriptText,
              {
                fontSize: transcriptFontSize,
                lineHeight: Math.round(transcriptFontSize * 1.47),
              },
            ]}
          >
            {outputTranscript}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  translationScroll: {
    flex: 1,
    width: "100%",
    marginTop: 12,
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
});
