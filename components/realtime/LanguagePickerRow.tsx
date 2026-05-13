import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  FEATURED_LANGUAGE_CODES,
  TRANSLATION_OUTPUT_LANGUAGES,
  featuredLanguages,
} from "../../lib/translationLanguages";

type Props = {
  outputLanguage: string;
  onSelectLanguage: (code: string) => void;
  onOpenModal: () => void;
};

export function LanguagePickerRow({
  outputLanguage,
  onSelectLanguage,
  onOpenModal,
}: Props) {
  return (
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
              onPress={() => onSelectLanguage(lang.code)}
              style={[
                styles.langChip,
                isSelected && styles.langChipSelected,
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
          onPress={() => onOpenModal()}
          style={[
            styles.langChip,
            styles.langChipMore,
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
  );
}

const styles = StyleSheet.create({
  topSection: {
    width: "100%",
    marginBottom: 4,
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
});
