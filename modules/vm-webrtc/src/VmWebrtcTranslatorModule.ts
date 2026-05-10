import { NativeModule, requireOptionalNativeModule } from "expo";

import { log } from "../../../lib/logger";
import type {
  AudioMetricsEventPayload,
  OpenAIConnectionState,
  RealtimeErrorEventPayload,
  VoiceSessionStatusEventPayload,
} from "./VmWebrtc.types";

const MODULE_NAME = "VmWebrtcTranslator";

export type TranslationConnectionOptions = {
  apiKey: string;
  baseUrl?: string;
  audioOutput?: "handset" | "speakerphone";
  outputLanguage: string;
};

export type TranslationTranscriptEventPayload = {
  delta: string;
};

type TranslatorModuleEvents = {
  onVoiceSessionStatus: (params: VoiceSessionStatusEventPayload) => void;
  onRealtimeError: (params: RealtimeErrorEventPayload) => void;
  onAudioMetrics: (params: AudioMetricsEventPayload) => void;
  onTranslationInputTranscript: (params: TranslationTranscriptEventPayload) => void;
  onTranslationOutputTranscript: (params: TranslationTranscriptEventPayload) => void;
};

declare class VmWebrtcTranslatorModule extends NativeModule<TranslatorModuleEvents> {
  openTranslationConnectionAsync(
    options: TranslationConnectionOptions,
  ): Promise<OpenAIConnectionState>;
  closeTranslationConnectionAsync(): Promise<OpenAIConnectionState>;
  muteUnmuteOutgoingAudio(shouldMute: boolean): void;
}

const makeUnavailableError = () =>
  new Error(
    `Native module ${MODULE_NAME} is unavailable. Rebuild the iOS app to load native code.`,
  );

const module = requireOptionalNativeModule<VmWebrtcTranslatorModule>(MODULE_NAME);

if (!module) {
  log.warn(
    `[${MODULE_NAME}] Native module not found. Did you rebuild the iOS app?`,
  );
}

export const openTranslationConnectionAsync = async (
  options: TranslationConnectionOptions,
): Promise<OpenAIConnectionState> => {
  if (!module) throw makeUnavailableError();
  log.debug(
    `[${MODULE_NAME}] openTranslationConnectionAsync`,
    {},
    { outputLanguage: options.outputLanguage, audioOutput: options.audioOutput ?? "handset" },
  );
  return module.openTranslationConnectionAsync(options);
};

export const closeTranslationConnectionAsync =
  async (): Promise<OpenAIConnectionState> => {
    if (!module) throw makeUnavailableError();
    log.debug(`[${MODULE_NAME}] closeTranslationConnectionAsync`);
    return module.closeTranslationConnectionAsync();
  };

export const muteUnmuteOutgoingAudio = (shouldMute: boolean): void => {
  if (!module) throw makeUnavailableError();
  log.debug(`[${MODULE_NAME}] muteUnmuteOutgoingAudio`, {}, { shouldMute });
  module.muteUnmuteOutgoingAudio(shouldMute);
};

export default module ?? ({} as VmWebrtcTranslatorModule);
