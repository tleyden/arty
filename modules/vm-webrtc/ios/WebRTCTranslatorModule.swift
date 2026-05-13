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

    @Field
    var noiseReductionType: String?

    @Field
    var inputTranscriptionModel: String?

    @Field
    var bidirectionalLanguage: String?
}

public class WebRTCTranslatorModule: Module {
    // Primary session: translates into outputLanguage (e.g. en → es).
    private lazy var primaryClient = OpenAIWebRTCTranslatorClient()
    // Reverse session: translates into bidirectionalLanguage (e.g. es → en).
    // Only opened when bidirectionalLanguage is provided.
    private lazy var reverseClient: OpenAIWebRTCTranslatorClient = {
        let client = OpenAIWebRTCTranslatorClient()
        client.role = "reverse"
        // The primary client owns the shared AVAudioSession lifecycle.
        client.skipAudioSession = true
        return client
    }()

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
            self.primaryClient.setEventEmitter { [weak self] name, payload in
                guard let self else { return }
                self.sendEvent(name, payload)
            }
            self.reverseClient.setEventEmitter { [weak self] name, payload in
                guard let self else { return }
                self.sendEvent(name, payload)
            }
        }

        AsyncFunction("openTranslationConnectionAsync") { (options: TranslationConnectionOptions) -> String in
            let apiKey = options.apiKey
            let baseUrl = options.baseUrl
            let pref = AudioOutputPreference(rawValue: options.audioOutput ?? "handset") ?? .handset
            let noiseReductionType = options.noiseReductionType
            let inputTranscriptionModel = options.inputTranscriptionModel
            let bidirectionalLanguage = options.bidirectionalLanguage?.trimmingCharacters(in: .whitespacesAndNewlines)

            await MainActor.run { self.primaryClient.setAPIKey(apiKey) }

            // Open primary session.
            let primaryState = try await self.primaryClient.openConnection(
                baseURL: baseUrl,
                audioOutput: pref,
                outputLanguage: options.outputLanguage,
                noiseReductionType: noiseReductionType,
                inputTranscriptionModel: inputTranscriptionModel
            )

            // Open reverse session if bidirectionalLanguage is provided.
            if let reverseLanguage = bidirectionalLanguage, !reverseLanguage.isEmpty {
                await MainActor.run { self.reverseClient.setAPIKey(apiKey) }
                do {
                    let reverseState = try await self.reverseClient.openConnection(
                        baseURL: baseUrl,
                        audioOutput: pref,
                        outputLanguage: reverseLanguage,
                        noiseReductionType: noiseReductionType,
                        inputTranscriptionModel: inputTranscriptionModel
                    )
                    VmWebrtcLogging.logger.log(
                        "[VmWebrtc][Translator] Reverse session opened",
                        attributes: logAttributes(for: .info, metadata: [
                            "reverseLanguage": reverseLanguage,
                            "reverseState": reverseState,
                        ])
                    )
                } catch {
                    VmWebrtcLogging.logger.log(
                        "[VmWebrtc][Translator] Reverse session failed to open — continuing with primary only",
                        attributes: logAttributes(for: .warn, metadata: [
                            "reverseLanguage": reverseLanguage,
                            "error": error.localizedDescription,
                        ])
                    )
                }
            }

            return primaryState
        }

        AsyncFunction("closeTranslationConnectionAsync") { () -> String in
            return await MainActor.run {
                // Close reverse first (it skips audio session deactivation),
                // then close primary which deactivates the shared audio session.
                self.reverseClient.closeConnection()
                return self.primaryClient.closeConnection()
            }
        }

        Function("muteUnmuteOutgoingAudio") { (shouldMute: Bool) in
            Task { @MainActor in
                self.primaryClient.setOutgoingAudioMuted(shouldMute)
                self.reverseClient.setOutgoingAudioMuted(shouldMute)
            }
        }

        Function("updateOutputLanguage") { (language: String) in
            Task { @MainActor in
                self.primaryClient.updateOutputLanguage(language)
            }
        }
    }
}
