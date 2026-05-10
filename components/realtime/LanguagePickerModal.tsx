import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { moreLanguages } from "../../lib/translationLanguages";

type Props = {
  visible: boolean;
  outputLanguage: string;
  onClose: () => void;
  onSelectLanguage: (code: string) => void;
};

export function LanguagePickerModal({
  visible,
  outputLanguage,
  onClose,
  onSelectLanguage,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalSheet} onPress={() => {}}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Choose Language</Text>
          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            showsVerticalScrollIndicator={false}
          >
            {moreLanguages.map((lang) => {
              const isSelected = outputLanguage === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => {
                    onSelectLanguage(lang.code);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.modalLangRow,
                    isSelected && styles.modalLangRowSelected,
                    pressed && styles.modalLangRowPressed,
                  ]}
                >
                  <Text style={styles.modalLangFlag}>{lang.flag}</Text>
                  <Text
                    style={[
                      styles.modalLangName,
                      isSelected && styles.modalLangNameSelected,
                    ]}
                  >
                    {lang.name}
                  </Text>
                  {isSelected && (
                    <Text style={styles.modalCheckmark}>✓</Text>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: "60%",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#C7C7CC",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  modalScroll: {
    paddingHorizontal: 20,
  },
  modalScrollContent: {
    gap: 8,
    paddingBottom: 8,
  },
  modalLangRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E5EA",
    backgroundColor: "#FAFAFA",
  },
  modalLangRowSelected: {
    borderColor: "#4CAF50",
    backgroundColor: "#E8F5E8",
  },
  modalLangRowPressed: {
    backgroundColor: "#F0F0F5",
  },
  modalLangFlag: {
    fontSize: 24,
  },
  modalLangName: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    color: "#1C1C1E",
  },
  modalLangNameSelected: {
    color: "#2E7D32",
    fontWeight: "600",
  },
  modalCheckmark: {
    fontSize: 16,
    color: "#4CAF50",
  },
});
