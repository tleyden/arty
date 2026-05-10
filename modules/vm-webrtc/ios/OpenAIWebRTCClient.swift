import AVFoundation
import Foundation
import WebRTC

final class OpenAIWebRTCClient: OpenAIWebRTCBase {

    enum Constants {
        static let idleTimeoutSeconds = WebRTCEventHandler.defaultIdleTimeout
    }

    // MARK: Subclass-provided endpoint constants

    override var defaultEndpoint: String { "https://api.openai.com/v1/realtime" }
    override var defaultModel: String { "gpt-realtime" }

    // MARK: Chat-specific stored properties

    var sessionInstructions: String
    private let defaultVoice = "cedar"
    var sessionVoice: String
    private var sessionAudioSpeed: Double
    var turnDetectionMode: TurnDetectionMode = .semantic
    private var maxConversationTurns: Int?
    var retentionRatio: Double?
    private let retentionRatioScale: Int = 2
    private var disableCompaction: Bool = false
    var transcriptionEnabled: Bool = false

    // Reference to the github connector tool delegate
    weak var githubConnectorDelegate: BaseTool?

    // Reference to the GDrive connector tool delegates
    weak var gdriveConnectorDelegate: BaseTool?
    weak var gpt5GDriveFixerDelegate: BaseTool?
    weak var gpt5WebSearchDelegate: BaseTool?

    // Reference to the Gen2 toolkit helper
    var toolkitHelper: ToolkitHelper?

    // Audio mix player for playing sounds during WebRTC session
    let audioMixPlayer = AudioMixPlayer()

    var toolDefinitions: [[String: Any]] = []
    lazy var eventHandler = WebRTCEventHandler()

    // MARK: Init / deinit

    override init() {
        self.sessionInstructions = ""
        self.sessionVoice = "cedar"
        self.sessionAudioSpeed = 1.0
        super.init()

        eventHandler.sendResponseCreateCallback = { [weak self] in
            guard let self else { return false }
            return self.sendEvent(["type": "response.create"])
        }

        audioMixPlayer.isAssistantAudioStreamingCheck = { [weak self] in
            guard let self else { return false }
            return self.eventHandler.checkAssistantAudioStreaming()
        }
    }

    deinit {
        eventHandler.stopIdleMonitoring(reason: "deinit")
    }

    // MARK: Virtual hook overrides

    override func dataChannelDidOpen() {
        sendInitialSessionConfiguration()
    }

    override func handleDataChannelMessage(_ event: [String: Any]) {
        handleTokenUsageEventIfNeeded(event)
        eventHandler.handle(event: event, context: makeEventHandlerContext())
    }

    override func recordRemoteSpeakingActivity() {
        eventHandler.recordRemoteSpeakingActivity()
    }

    // MARK: Tool context

    func makeEventHandlerContext() -> WebRTCEventHandler.ToolContext {
        WebRTCEventHandler.ToolContext(
            githubConnectorDelegate: githubConnectorDelegate,
            gdriveConnectorDelegate: gdriveConnectorDelegate,
            gpt5GDriveFixerDelegate: gpt5GDriveFixerDelegate,
            gpt5WebSearchDelegate: gpt5WebSearchDelegate,
            toolkitHelper: toolkitHelper,
            audioMixPlayer: audioMixPlayer,
            sendToolCallError: { [weak self] callId, error in
                guard let self else { return }
                self.sendToolCallError(callId: callId, error: error)
            },
            emitModuleEvent: { [weak self] name, payload in
                guard let self else { return }
                Task { @MainActor in self.emitModuleEvent(name, payload: payload) }
            },
            sendDataChannelMessage: { [weak self] event in
                guard let self else { return }
                self.sendDataChannelMessage(event)
            }
        )
    }

    // MARK: Delegate setters

    func setGithubConnectorDelegate(_ delegate: BaseTool) {
        self.githubConnectorDelegate = delegate
    }

    func setGDriveConnectorDelegate(_ delegate: BaseTool) {
        self.gdriveConnectorDelegate = delegate
    }

    func setGPT5GDriveFixerDelegate(_ delegate: BaseTool) {
        self.gpt5GDriveFixerDelegate = delegate
    }

    func setGPT5WebSearchDelegate(_ delegate: BaseTool) {
        self.gpt5WebSearchDelegate = delegate
    }

    func setToolkitHelper(_ helper: ToolkitHelper) {
        self.toolkitHelper = helper
    }

    func setToolDefinitions(_ definitions: [[String: Any]]) {
        self.toolDefinitions = definitions
        self.logger.log(
            "[VmWebrtc] Configured tool definitions from JavaScript",
            attributes: logAttributes(for: .debug, metadata: ["definitions": definitions]))
    }

    func quantizedRetentionRatio(_ ratio: Double) -> NSNumber {
        var decimalValue = Decimal(ratio)
        var roundedValue = Decimal()
        NSDecimalRound(&roundedValue, &decimalValue, retentionRatioScale, .plain)
        return NSDecimalNumber(decimal: roundedValue)
    }

    private func convertLogLevel(_ levelString: String) -> NativeLogLevel {
        switch levelString.lowercased() {
        case "trace": return .trace
        case "debug": return .debug
        case "info": return .info
        case "warn": return .warn
        case "error": return .error
        default: return .debug
        }
    }

    // MARK: Connection lifecycle

    @MainActor
    func openConnection(
        model: String?,
        baseURL: String?,
        audioOutput: AudioOutputPreference,
        instructions: String,
        voice: String?,
        vadMode: String?,
        audioSpeed: Double?,
        maxConversationTurns: Int?,
        retentionRatio: Double?,
        disableCompaction: Bool?,
        transcriptionEnabled: Bool
    ) async throws -> String {
        let sanitizedInstructions = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sanitizedInstructions.isEmpty else {
            self.logger.log(
                "[VmWebrtc] Received empty instructions for OpenAI session",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.missingInstructions
        }
        sessionInstructions = sanitizedInstructions

        guard let resolvedApiKey = self.apiKey, !resolvedApiKey.isEmpty else {
            self.logger.log(
                "[VmWebrtc] Missing OpenAI API key before starting connection",
                attributes: logAttributes(for: .error, metadata: ["reason": "api_key_not_set"]))
            throw OpenAIWebRTCError.missingAPIKey
        }

        let sanitizedVoice = voice?.trimmingCharacters(in: .whitespacesAndNewlines)
        sessionVoice = (sanitizedVoice?.isEmpty == false) ? sanitizedVoice! : defaultVoice

        if let mode = vadMode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
            let resolvedMode = TurnDetectionMode(rawValue: mode)
        {
            turnDetectionMode = resolvedMode
        } else {
            turnDetectionMode = .semantic
        }

        if let audioSpeed, audioSpeed.isFinite {
            sessionAudioSpeed = min(max(audioSpeed, 0.25), 4.0)
        } else {
            sessionAudioSpeed = 1.0
        }

        self.maxConversationTurns = maxConversationTurns
        self.retentionRatio = retentionRatio
        self.disableCompaction = disableCompaction ?? false
        self.transcriptionEnabled = transcriptionEnabled

        eventHandler.configureConversationTurnLimit(maxTurns: maxConversationTurns)
        eventHandler.configureDisableCompaction(disabled: self.disableCompaction)
        eventHandler.resetConversationTracking()
        eventHandler.setApiKey(resolvedApiKey)
        eventHandler.stopIdleMonitoring(reason: "starting_new_connection")

        emitModuleEvent("onVoiceSessionStatus", payload: ["status_update": "Connecting to OpenAI..."])

        self.logger.log(
            "[VmWebrtc] Starting OpenAI WebRTC connection",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "hasModel": (model?.isEmpty == false),
                    "hasBaseURL": (baseURL?.isEmpty == false),
                    "audioOutput": audioOutput.rawValue,
                    "voice": sessionVoice,
                ]))

        let endpointURL = try buildEndpointURL(baseURL: baseURL, model: model)
        self.logger.log(
            "[VmWebrtc] Resolved OpenAI endpoint",
            attributes: logAttributes(for: .debug, metadata: ["endpoint": endpointURL.absoluteString])
        )

        try configureAudioSession(for: audioOutput)
        self.logger.log(
            "[VmWebrtc] Configured AVAudioSession for voice chat",
            attributes: logAttributes(
                for: .debug, metadata: ["requestedOutput": audioOutput.rawValue]))

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Setting up audio session..."])

        let connection = try makePeerConnection()
        firstCandidateTimestamp = nil
        self.logger.log(
            "[VmWebrtc] Peer connection prepared",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "hasAudioTrack": audioTrack != nil,
                    "hasDataChannel": dataChannel != nil,
                ]))

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Establishing peer connection..."])

        let offer = try await createOffer(connection: connection)
        self.logger.log(
            "[VmWebrtc] Created local SDP offer",
            attributes: logAttributes(for: .debug, metadata: ["hasSDP": !offer.sdp.isEmpty]))
        try await setLocalDescription(offer, for: connection)
        self.logger.log("[VmWebrtc] Local description applied", attributes: logAttributes(for: .debug))

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Gathering network candidates..."])

        let iceWait = try await waitForIceGathering(on: connection, timeout: iceGatheringGracePeriod)
        self.logger.log(
            "[VmWebrtc] Continuing after ICE wait",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "state": connection.iceGatheringState.rawValue,
                    "elapsedSeconds": iceWait,
                    "timedOut": connection.iceGatheringState != .complete,
                ]))

        guard let localSDP = connection.localDescription?.sdp else {
            self.logger.log(
                "[VmWebrtc] Local description missing after ICE gathering",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.missingLocalDescription
        }

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Connecting to OpenAI endpoint..."])

        let answerSDP = try await exchangeSDPWithOpenAI(
            apiKey: resolvedApiKey, endpointURL: endpointURL, offerSDP: localSDP)
        let remoteDescription = RTCSessionDescription(type: .answer, sdp: answerSDP)
        try await setRemoteDescription(remoteDescription, for: connection)
        self.logger.log(
            "[VmWebrtc] Remote description applied", attributes: logAttributes(for: .debug))

        emitModuleEvent(
            "onVoiceSessionStatus", payload: ["status_update": "Finalizing connection..."])

        let state = try await waitForConnection(toReach: connection, timeout: 15)
        self.logger.log(
            "[VmWebrtc] OpenAI WebRTC connection flow finished",
            attributes: logAttributes(for: .info, metadata: ["state": state]))

        if state == "connected" || state == "completed" {
            emitModuleEvent("onVoiceSessionStatus", payload: ["status_update": "Connected"])

            eventHandler.startIdleMonitoring(timeout: Constants.idleTimeoutSeconds) { [weak self] in
                guard let self else { return }
                Task { @MainActor in self.handleIdleTimeoutTriggered() }
            }
        }

        return state
    }

    @MainActor
    override func closeConnection() -> String {
        self.logger.log(
            "[VmWebrtc] Closing OpenAI WebRTC connection",
            attributes: logAttributes(for: .info))

        eventHandler.stopIdleMonitoring(reason: "connection_closed")
        eventHandler.resetConversationTracking()
        eventHandler.resetAudioStreamingState()
        eventHandler.resetFunctionCallState()
        eventHandler.shadowObserve_reset(reason: "connection_closed")

        return super.closeConnection()
    }

    // MARK: Session configuration (sent once data channel opens)

    func sendInitialSessionConfiguration() {
        guard !hasSentInitialSessionConfig else { return }

        guard let dataChannel, dataChannel.readyState == .open else {
            self.logger.log(
                "[VmWebrtc] Data channel not ready for initial session configuration",
                attributes: logAttributes(for: .warn, metadata: ["hasChannel": dataChannel != nil]))
            return
        }

        let tools = buildTools()

        if tools.isEmpty && !toolDefinitions.isEmpty {
            self.logger.log(
                "[VmWebrtc] Tool definitions provided but none matched configured delegates",
                attributes: logAttributes(
                    for: .warn, metadata: ["definitionCount": toolDefinitions.count]))
        }

        var session: [String: Any] = [
            "instructions": sessionInstructions,
            "voice": sessionVoice,
            "tools": tools,
        ]

        switch turnDetectionMode {
        case .semantic:
            session["turn_detection"] = [
                "type": "semantic_vad",
                "create_response": true,
                "eagerness": "low",
            ]
        case .server:
            session["turn_detection"] = [
                "type": "server_vad",
                "create_response": true,
            ]
        }

        if let ratio = retentionRatio {
            session["truncation"] = [
                "type": "retention_ratio",
                "retention_ratio": quantizedRetentionRatio(ratio),
            ]
        }

        if transcriptionEnabled {
            session["input_audio_transcription"] = ["model": "whisper-1"]
        }

        if let prettyData = try? JSONSerialization.data(
            withJSONObject: session, options: [.prettyPrinted]),
            let prettyString = String(data: prettyData, encoding: .utf8)
        {
            self.logger.log(
                "📑 [VmWebrtc] Sending session.update payload",
                attributes: logAttributes(for: .debug, metadata: ["session": prettyString]))
        } else {
            self.logger.log(
                "📑 [VmWebrtc] Sending session.update payload (fallback formatting)",
                attributes: logAttributes(for: .debug, metadata: ["session": session]))
        }

        _ = sendEvent(["type": "session.update", "session": session])

        Task { @MainActor in
            self.emitModuleEvent(
                "onVoiceSessionStatus", payload: ["status_update": "Started Voice Session"])
        }

        hasSentInitialSessionConfig = true

        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(300)) { [weak self] in
            guard let strongSelf = self else { return }
            let trigger = "session_init"
            if strongSelf.eventHandler.checkResponseInProgress() {
                strongSelf.eventHandler.queueResponseCreate(trigger: trigger)
            } else {
                let sent = strongSelf.sendEvent(["type": "response.create"])
                if sent { strongSelf.eventHandler.didSendResponseCreate(trigger: trigger) }
            }
        }
    }

    private func buildTools() -> [[String: Any]] {
        let definitionsByName: [String: [String: Any]] = Dictionary(
            uniqueKeysWithValues: toolDefinitions.compactMap { definition in
                guard let name = definition["name"] as? String, !name.isEmpty else {
                    self.logger.log(
                        "[VmWebrtc] Encountered tool definition without a valid name. Skipping.",
                        attributes: logAttributes(for: .warn))
                    return nil
                }
                return (name, definition)
            }
        )

        let legacyDelegates: [BaseTool?] = [
            githubConnectorDelegate,
            gdriveConnectorDelegate,
            gpt5GDriveFixerDelegate,
            gpt5WebSearchDelegate,
        ]

        let legacyTools = legacyDelegates.compactMap { delegate -> [String: Any]? in
            guard let delegate else { return nil }
            let toolName = delegate.toolName
            if let definition = definitionsByName[toolName] { return definition }
            self.logger.log(
                "[VmWebrtc] No JavaScript-provided definition found for tool",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "toolName": toolName,
                        "availableDefinitions": Array(definitionsByName.keys),
                    ]))
            return nil
        }

        let legacyToolNames = Set(legacyDelegates.compactMap { $0?.toolName })
        let gen2Tools = definitionsByName
            .filter { !legacyToolNames.contains($0.key) }
            .map { $0.value }

        if !gen2Tools.isEmpty {
            self.logger.log(
                "[VmWebrtc] Found Gen2 toolkit tools",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "count": gen2Tools.count,
                        "toolNames": gen2Tools.compactMap { $0["name"] as? String },
                    ]))
        }

        return legacyTools + gen2Tools
    }

    // MARK: Token usage helper

    private func handleTokenUsageEventIfNeeded(_ eventDict: [String: Any]) {
        guard let type = eventDict["type"] as? String, type == "response.token_usage",
            let usage = eventDict["usage"] as? [String: Any]
        else { return }

        var payload: [String: Any] = [:]

        if let v = numberValue(from: usage["input_text_tokens"]) ?? numberValue(from: usage["inputText"]) { payload["inputText"] = v }
        if let v = numberValue(from: usage["input_audio_tokens"]) ?? numberValue(from: usage["inputAudio"]) { payload["inputAudio"] = v }
        if let v = numberValue(from: usage["output_text_tokens"]) ?? numberValue(from: usage["outputText"]) { payload["outputText"] = v }
        if let v = numberValue(from: usage["output_audio_tokens"]) ?? numberValue(from: usage["outputAudio"]) { payload["outputAudio"] = v }
        if let v = numberValue(from: usage["cached_input_tokens"]) ?? numberValue(from: usage["cachedInput"]) { payload["cachedInput"] = v }

        guard !payload.isEmpty else {
            self.logger.log(
                "[VmWebrtc] 💵 Token usage event received without recognized counters",
                attributes: logAttributes(for: .debug, metadata: ["usageKeys": Array(usage.keys)]))
            return
        }

        if let responseId = eventDict["response_id"] as? String {
            payload["responseId"] = responseId
        }
        payload["timestampMs"] = Int(Date().timeIntervalSince1970 * 1000)

        self.logger.log(
            "[VmWebrtc] Forwarding token usage event to JavaScript",
            attributes: logAttributes(for: .debug, metadata: payload))

        Task { @MainActor in emitModuleEvent("onTokenUsage", payload: payload) }
    }

    private func numberValue(from value: Any?) -> Int? {
        switch value {
        case let i as Int: return i
        case let d as Double: return Int(d)
        case let n as NSNumber: return n.intValue
        case let s as String: return Int(s)
        default: return nil
        }
    }
}

// MARK: - ToolCallResponder

extension OpenAIWebRTCClient: ToolCallResponder {
    func sendToolCallResult(callId: String, result: String) {
        let itemId = UUID().uuidString.replacingOccurrences(of: "-", with: "")

        eventHandler.shadowObserve_willSendToolResult(callId: callId)

        self.logger.log(
            "🔧 [TOOL_OUTPUT_START] Preparing to send tool call result",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "callId": callId, "itemId": itemId, "resultLength": result.count,
                    "result": result,
                    "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                    "peerConnectionState": peerConnection?.connectionState.rawValue ?? -1,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ]))

        let outputDict: [String: Any] = [
            "type": "conversation.item.create",
            "item": [
                "id": itemId,
                "type": "function_call_output",
                "call_id": callId,
                "output": result,
            ],
        ]

        eventHandler.saveConversationItem(
            itemId: itemId, role: "system", type: "function_call_output", fullContent: result)

        let didSend = sendEvent(outputDict)

        if didSend {
            self.logger.log(
                "✅ [TOOL_OUTPUT_SENT] Tool call result successfully sent via data channel",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "callId": callId, "itemId": itemId, "resultLength": result.count,
                        "result": result,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ]))
            eventHandler.recordExternalActivity(reason: "tool_call_result")

            let trigger = "tool_call_result:\(callId)"
            let responseInProgress = eventHandler.checkResponseInProgress()
            let audioStreaming = eventHandler.checkAssistantAudioStreaming()
            let currentRespId = eventHandler.getCurrentResponseId()
            let shortCurrentRespId =
                currentRespId.map { id in id.count > 12 ? "\(id.prefix(12))..." : id } ?? "nil"

            self.logger.log(
                "🔍 [RESPONSE_CREATE_CHECK] Checking state (currentResp=\(shortCurrentRespId), inProgress=\(responseInProgress))",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "trigger": "tool_call_result", "callId": callId,
                        "responseInProgress": responseInProgress,
                        "currentResponseId": currentRespId as Any,
                        "audioStreaming": audioStreaming,
                        "raceConditionNote":
                            "If OpenAI returns conversation_already_has_active_response, compare blocking ID with currentResponseId",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                        "threadId": Thread.current.description,
                    ]))

            if responseInProgress {
                self.logger.log(
                    "⚠️ Already have a response in progress (\(shortCurrentRespId)); queuing response.create",
                    attributes: logAttributes(
                        for: .warn,
                        metadata: [
                            "trigger": "tool_call_result", "callId": callId,
                            "responseInProgress": responseInProgress,
                            "currentResponseId": currentRespId as Any,
                            "audioStreaming": audioStreaming,
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                        ]))
                eventHandler.queueResponseCreate(trigger: trigger)
                eventHandler.shadowObserve_willSendResponseCreate(trigger: trigger)
            } else {
                self.logger.log(
                    "📤 [RESPONSE_CREATE] Sending response.create (localState=idle, lastResp=\(shortCurrentRespId))",
                    attributes: logAttributes(
                        for: .info,
                        metadata: [
                            "trigger": "tool_call_result", "callId": callId,
                            "responseInProgress": responseInProgress,
                            "currentResponseId": currentRespId as Any,
                            "audioStreaming": audioStreaming,
                            "warning":
                                "If error occurs, OpenAI may have started a new response we didn't see",
                            "timestamp": ISO8601DateFormatter().string(from: Date()),
                            "threadId": Thread.current.description,
                        ]))
                eventHandler.shadowObserve_willSendResponseCreate(trigger: trigger)
                let responseCreateSent = sendEvent(["type": "response.create"])
                if responseCreateSent {
                    eventHandler.didSendResponseCreate(trigger: trigger)
                    eventHandler.shadowObserve_didCompleteToolCall(callId: callId)
                } else {
                    self.logger.log(
                        "❌ [RESPONSE_CREATE_FAILED] Failed to send response.create",
                        attributes: logAttributes(
                            for: .error,
                            metadata: [
                                "callId": callId,
                                "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                                "timestamp": ISO8601DateFormatter().string(from: Date()),
                            ]))
                }
            }
        } else {
            self.logger.log(
                "❌ [TOOL_OUTPUT_FAILED] Failed to send conversation.item.create for tool result",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "callId": callId, "itemId": itemId, "resultLength": result.count,
                        "result": result,
                        "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                        "peerConnectionState": peerConnection?.connectionState.rawValue ?? -1,
                        "likelyReason":
                            "call_id may not exist in conversation (could have been pruned)",
                        "recommendation": "Check if conversation pruning deleted this call_id",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ]))
        }
    }

    func sendToolCallError(callId: String, error: String) {
        let itemId = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let errorOutput = "{\"error\": \"\(error)\"}"

        self.logger.log(
            "⚠️ [TOOL_ERROR] Sending tool call error response",
            attributes: logAttributes(
                for: .warn,
                metadata: [
                    "callId": callId, "itemId": itemId, "error": error, "errorOutput": errorOutput,
                    "dataChannelState": dataChannel?.readyState.rawValue ?? -1,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ]))

        let outputDict: [String: Any] = [
            "type": "conversation.item.create",
            "item": [
                "id": itemId,
                "type": "function_call_output",
                "call_id": callId,
                "output": errorOutput,
            ],
        ]

        eventHandler.saveConversationItem(
            itemId: itemId, role: "system", type: "function_call_output", fullContent: errorOutput)

        let didSend = sendEvent(outputDict)

        if !didSend {
            self.logger.log(
                "❌ [TOOL_ERROR_SEND_FAILED] Failed to send tool error response",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "callId": callId, "itemId": itemId, "error": error, "errorOutput": errorOutput,
                        "likelyReason":
                            "call_id may not exist in conversation (could have been pruned)",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ]))
            return
        }

        let trigger = "tool_call_error:\(callId)"
        let responseInProgress = eventHandler.checkResponseInProgress()
        let audioStreaming = eventHandler.checkAssistantAudioStreaming()
        let currentRespIdErr = eventHandler.getCurrentResponseId()
        let shortCurrentRespIdErr =
            currentRespIdErr.map { id in id.count > 12 ? "\(id.prefix(12))..." : id } ?? "nil"

        self.logger.log(
            "🔍 [RESPONSE_CREATE_CHECK] Checking state after tool error (currentResp=\(shortCurrentRespIdErr), inProgress=\(responseInProgress))",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "trigger": "tool_call_error", "callId": callId,
                    "responseInProgress": responseInProgress,
                    "currentResponseId": currentRespIdErr as Any,
                    "audioStreaming": audioStreaming,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                    "threadId": Thread.current.description,
                ]))

        if responseInProgress {
            self.logger.log(
                "⚠️ Already have a response in progress (\(shortCurrentRespIdErr)); queuing response.create after tool error",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "trigger": "tool_call_error", "callId": callId,
                        "responseInProgress": responseInProgress,
                        "currentResponseId": currentRespIdErr as Any,
                        "audioStreaming": audioStreaming,
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                    ]))
            eventHandler.queueResponseCreate(trigger: trigger)
        } else {
            self.logger.log(
                "📤 [RESPONSE_CREATE] Sending response.create after tool error (localState=idle, lastResp=\(shortCurrentRespIdErr))",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "trigger": "tool_call_error", "callId": callId,
                        "responseInProgress": responseInProgress,
                        "currentResponseId": currentRespIdErr as Any,
                        "audioStreaming": audioStreaming,
                        "warning":
                            "If error occurs, OpenAI may have started a new response we didn't see",
                        "timestamp": ISO8601DateFormatter().string(from: Date()),
                        "threadId": Thread.current.description,
                    ]))
            let responseCreateSent = sendEvent(["type": "response.create"])
            if responseCreateSent { eventHandler.didSendResponseCreate(trigger: trigger) }
        }
        eventHandler.recordExternalActivity(reason: "tool_call_error")
    }
}
