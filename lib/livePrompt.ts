import { composePrompt } from "./promptStorage";

export const composeLivePrompts = (addition: string, language: string) => {
  const languageInstruction = `Respond in ${language || "English"} unless the user explicitly requests otherwise.`;
  return {
    voiceInstructions: [
      "You are Arty, a friendly, helpful voice assistant. Speak naturally and concisely.",
      languageInstruction,
      "Delegate tasks, tool use, and requests for external information to your backend. Report results only after the backend confirms them.",
      "Follow the user's speaking style and persona preferences in the following custom instructions:",
      addition.trim(),
    ].join("\n"),
    backendInstructions: composePrompt([
      "You are Arty's backend assistant. Use the provided tools to carry out the user's requests.",
      "Return accurate results to the voice assistant. Mention the tool name when reporting tool results so the user knows their source.",
      languageInstruction,
    ].join("\n"), addition),
  };
};
