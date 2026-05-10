import AVFoundation
import Foundation
import WebRTC

// OpenAIWebRTCTranslatorClient connects to the OpenAI Realtime Translation API.
//
// Key differences from OpenAIWebRTCClient:
//   - Endpoint: /v1/realtime/translations/calls  (not /v1/realtime)
//   - Model:    gpt-realtime-translate
//   - No turn management, no response.create, no tools, no voice selection
//   - Session config specifies only output language; input language is auto-detected
//   - Continuous audio stream in → continuous translated audio stream out
//   - Transcript deltas emitted as onTranslationInputTranscript / onTranslationOutputTranscript

final class OpenAIWebRTCTranslatorClient: OpenAIWebRTCBase {

    // MARK: Subclass-provided endpoint constants

    override var defaultEndpoint: String { "https://api.openai.com/v1/realtime/translations/calls" }
    override var defaultModel: String { "gpt-realtime-translate" }

    // MARK: Translation-specific state

    private var outputLanguage: String = "en"
    private var inputTranscriptionModel: String? = nil
    private var noiseReductionType: String? = nil
    // "primary" or "reverse" — logged and included in transcript events so the JS layer
    // can distinguish which stream produced each delta.
    var role: String = "primary"

    // MARK: Connection lifecycle

    @MainActor
    func openConnection(
        baseURL: String?,
        audioOutput: AudioOutputPreference,
        outputLanguage: String,
        noiseReductionType: String? = nil,
        inputTranscriptionModel: String? = nil
    ) async throws -> String {
        guard let resolvedApiKey = self.apiKey, !resolvedApiKey.isEmpty else {
            logger.log(
                "[VmWebrtc][Translator] Missing API key before starting translation connection",
                attributes: logAttributes(for: .error, metadata: ["reason": "api_key_not_set"]))
            throw OpenAIWebRTCError.missingAPIKey
        }

        self.outputLanguage = outputLanguage.trimmingCharacters(in: .whitespacesAndNewlines)
        self.inputTranscriptionModel = inputTranscriptionModel
        self.noiseReductionType = noiseReductionType

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Connecting to OpenAI..."])

        logger.log(
            "[VmWebrtc][Translator] Starting translation connection",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "role": self.role,
                    "outputLanguage": self.outputLanguage,
                    "audioOutput": audioOutput.rawValue,
                    "noiseReductionType": self.noiseReductionType ?? "disabled",
                    "hasBaseURL": (baseURL?.isEmpty == false),
                ]))

        let endpointURL = try buildEndpointURL(baseURL: baseURL, model: nil)
        logger.log(
            "[VmWebrtc][Translator] Resolved endpoint",
            attributes: logAttributes(for: .debug, metadata: ["endpoint": endpointURL.absoluteString])
        )

        try configureAudioSession(for: audioOutput)

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Setting up audio session..."])

        let connection = try makePeerConnection()
        firstCandidateTimestamp = nil

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Establishing peer connection..."])

        let offer = try await createOffer(connection: connection)
        try await setLocalDescription(offer, for: connection)

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Gathering network candidates..."])

        _ = try await waitForIceGathering(on: connection, timeout: iceGatheringGracePeriod)

        guard let localSDP = connection.localDescription?.sdp else {
            logger.log(
                "[VmWebrtc][Translator] Local description missing after ICE gathering",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.missingLocalDescription
        }

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Connecting to OpenAI endpoint..."])

        let answerSDP = try await exchangeSDPWithOpenAI(
            apiKey: resolvedApiKey, endpointURL: endpointURL, offerSDP: localSDP)
        let remoteDescription = RTCSessionDescription(type: .answer, sdp: answerSDP)
        try await setRemoteDescription(remoteDescription, for: connection)

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Finalizing connection..."])

        let state = try await waitForConnection(toReach: connection, timeout: 15)

        logger.log(
            "[VmWebrtc][Translator] Translation connection established",
            attributes: logAttributes(for: .info, metadata: ["state": state]))

        if state == "connected" || state == "completed" {
            emitModuleEvent("onVoiceSessionStatus", payload: ["status_update": "Connected"])
        }

        return state
    }

    @MainActor
    override func closeConnection() -> String {
        logger.log(
            "[VmWebrtc][Translator] Closing translation connection",
            attributes: logAttributes(for: .info))
        let result = super.closeConnection()
        logger.log(
            "[VmWebrtc][Translator] Translation connection closed",
            attributes: logAttributes(for: .info, metadata: ["result": result]))
        return result
    }

    // MARK: Virtual hook overrides

    override func dataChannelDidOpen() {
        // Translation sessions need only output language; no instructions, voice, tools, or
        // turn detection. Input language is auto-detected by the model.
        var audio: [String: Any] = ["output": ["language": outputLanguage]]

        // Build input config: noise_reduction and/or transcription model if set.
        var inputConfig: [String: Any] = [:]
        if let nr = noiseReductionType {
            inputConfig["noise_reduction"] = ["type": nr]
        }
        if let model = inputTranscriptionModel {
            inputConfig["transcription"] = ["model": model]
        }
        if !inputConfig.isEmpty {
            audio["input"] = inputConfig
        }

        let session: [String: Any] = ["audio": audio]

        logger.log(
            "[VmWebrtc][Translator] Sending translation session config",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "role": role,
                    "outputLanguage": outputLanguage,
                    "noiseReductionType": noiseReductionType ?? "disabled",
                    "inputTranscriptionModel": inputTranscriptionModel ?? "disabled",
                ]))

        _ = sendEvent(["type": "session.update", "session": session])

        // No response.create — translation is continuous; no turn management needed.

        Task { @MainActor in
            self.emitModuleEvent(
                "onVoiceSessionStatus",
                payload: ["status_update": "Started Translation Session"])
        }

        hasSentInitialSessionConfig = true
    }

    override func handleDataChannelMessage(_ event: [String: Any]) {
        guard let type = event["type"] as? String else { return }

        switch type {
        case "session.output_transcript.delta":
            if let delta = event["delta"] as? String {
                Task { @MainActor in
                    self.emitModuleEvent(
                        "onTranslationOutputTranscript", payload: ["delta": delta, "role": self.role])
                }
            }

        case "session.input_transcript.delta":
            if let delta = event["delta"] as? String {
                Task { @MainActor in
                    self.emitModuleEvent(
                        "onTranslationInputTranscript", payload: ["delta": delta, "role": self.role])
                }
            }

        case "error":
            logger.log(
                "[VmWebrtc][Translator] Received error event",
                attributes: logAttributes(for: .error, metadata: ["event": event]))
            Task { @MainActor in
                self.emitModuleEvent("onRealtimeError", payload: event)
            }

        default:
            logger.log(
                "[VmWebrtc][Translator] Unhandled event type: \(type)",
                attributes: logAttributes(for: .debug, metadata: ["type": type]))
        }
    }
}
