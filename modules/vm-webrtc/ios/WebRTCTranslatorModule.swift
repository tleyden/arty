import ExpoModulesCore
import Foundation

struct TranslationConnectionOptions: Record {
    @Field
    var apiKey: String

    @Field
    var baseUrl: String?

    @Field
    var audioOutput: String?

    @Field
    var outputLanguage: String
}

public class WebRTCTranslatorModule: Module {
    private lazy var translatorClient = OpenAIWebRTCTranslatorClient()

    public func definition() -> ModuleDefinition {
        Name("VmWebrtcTranslator")

        Events(
            "onVoiceSessionStatus",
            "onRealtimeError",
            "onAudioMetrics",
            "onTranslationOutputTranscript",
            "onTranslationInputTranscript"
        )

        OnCreate {
            self.translatorClient.setEventEmitter { [weak self] name, payload in
                guard let self else { return }
                self.sendEvent(name, payload)
            }
        }

        AsyncFunction("openTranslationConnectionAsync") { (options: TranslationConnectionOptions) -> String in
            await MainActor.run { self.translatorClient.setAPIKey(options.apiKey) }
            let pref = AudioOutputPreference(rawValue: options.audioOutput ?? "handset") ?? .handset
            return try await self.translatorClient.openConnection(
                baseURL: options.baseUrl,
                audioOutput: pref,
                outputLanguage: options.outputLanguage
            )
        }

        AsyncFunction("closeTranslationConnectionAsync") { () -> String in
            return await MainActor.run { self.translatorClient.closeConnection() }
        }

        Function("muteUnmuteOutgoingAudio") { (shouldMute: Bool) in
            Task { @MainActor in self.translatorClient.setOutgoingAudioMuted(shouldMute) }
        }
    }
}
