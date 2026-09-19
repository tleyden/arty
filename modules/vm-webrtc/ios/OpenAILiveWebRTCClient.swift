import Foundation
import WebRTC

/// Live owns turn-taking; this client only manages transport and delegated tools.
/// Mutable session state is accessed on MainActor, including native tool callbacks.
final class OpenAILiveWebRTCClient: OpenAIWebRTCBase, ToolCallResponder {
    static let backendModel = "gpt-5.6-terra"
    override var defaultEndpoint: String { "https://api.openai.com/v1/live/sessions" }
    override var defaultModel: String { "gpt-live-1" }

    var toolDelegates: [String: BaseTool] = [:]
    var toolkitHelper: ToolkitHelper?
    private var sessionId = ""
    private var greetingLanguage = "English"
    private var greetingEventId: String?
    private var started = false
    private var closing = false
    private var closed = false
    private var startupError: Error?
    private var startWaiter: CheckedContinuation<Void, Error>?
    private var startTimeout: Task<Void, Never>?
    private var closeWaiter: CheckedContinuation<Void, Never>?
    private var closeTimeout: Task<Void, Never>?
    private var closeTask: Task<String, Never>?

    private struct BackendResponse {
        var calls = Set<String>()
        var pending = Set<String>()
        var completed = false
        var continued = false
    }
    private var responses: [String: BackendResponse] = [:]
    private var delegationResponses: [String: String] = [:]
    private var callResponses: [String: String] = [:]
    private var billedResponses = Set<String>()

    @MainActor
    func openConnection(options: OpenAIConnectionOptions) async throws -> String {
        guard let apiKey, !apiKey.isEmpty else { throw OpenAIWebRTCError.missingAPIKey }
        // The JS bridge supplies the family default from DEFAULT_LIVE_VOICE.
        guard let voice = options.voice, !voice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw OpenAIWebRTCError.connectionFailed("A Live voice must be selected")
        }
        greetingLanguage = options.greetingLanguage ?? "English"
        let tools = (options.toolDefinitions ?? []).filter { $0["type"] as? String == "function" }
            .map { definition -> [String: Any] in
                var tool = definition
                // Preserve optional parameters in the existing toolkit schemas.
                tool["strict"] = false
                return tool
            }
        let session: [String: Any] = [
            "model": defaultModel,
            "instructions": options.instructions,
            "audio": ["output": ["voice": voice]],
            "delegation": [
                "type": "responses",
                "responses": [
                    "model": Self.backendModel,
                    "instructions": options.backendInstructions ?? options.instructions,
                    "tools": tools,
                    "tool_choice": "auto",
                    "parallel_tool_calls": false,
                ],
            ],
        ]
        do {
            emitModuleEvent("onVoiceSessionStatus", payload: ["status_update": "Connecting to GPT-Live..."])
            try configureAudioSession(
                for: AudioOutputPreference(rawValue: options.audioOutput ?? "handset") ?? .handset)
            let connection = try makePeerConnection()
            let offer = try await createOffer(connection: connection)
            try await setLocalDescription(offer, for: connection)
            _ = try await waitForIceGathering(on: connection, timeout: iceGatheringGracePeriod)
            guard !closed else { throw OpenAIWebRTCError.connectionFailed("closed") }
            guard let localSDP = connection.localDescription?.sdp else {
                throw OpenAIWebRTCError.missingLocalDescription
            }
            let endpoint = try buildEndpointURL(baseURL: nil, model: nil, appendModelQuery: false)
            let answer = try await exchangeSDPWithLive(
                apiKey: apiKey, endpointURL: endpoint, offerSDP: localSDP, session: session)
            sessionId = answer.sessionId
            guard !closed else { throw OpenAIWebRTCError.connectionFailed("closed") }
            try await setRemoteDescription(
                RTCSessionDescription(type: .answer, sdp: answer.answerSDP), for: connection)
            _ = try await waitForConnection(toReach: connection, timeout: 15)
            try await waitForSessionStart()
            emitModuleEvent("onVoiceSessionStatus", payload: ["status_update": "Connected"])
            return "connected"
        } catch {
            _ = await closeGracefully()
            throw error
        }
    }

    @MainActor
    private func waitForSessionStart() async throws {
        if let startupError { throw startupError }
        guard !closed else { throw OpenAIWebRTCError.connectionFailed("closed") }
        if started { return }
        try await withCheckedThrowingContinuation { continuation in
            startWaiter = continuation
            startTimeout = Task { @MainActor [weak self] in
                do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { return }
                self?.finishStart(
                    error: OpenAIWebRTCError.connectionFailed("GPT-Live session.started timed out"))
            }
        }
    }

    @MainActor
    private func finishStart(error: Error? = nil) {
        startTimeout?.cancel()
        startTimeout = nil
        let waiter = startWaiter
        startWaiter = nil
        if let error {
            startupError = error
            waiter?.resume(throwing: error)
        } else {
            waiter?.resume()
        }
    }

    @MainActor
    func closeGracefully() async -> String {
        if let closeTask { return await closeTask.value }
        if closed { return "closed" }
        closing = true
        let task = Task { @MainActor in
            if self.dataChannel?.readyState == .open {
                await withCheckedContinuation { continuation in
                    // Register before sending: the server can respond immediately.
                    self.closeWaiter = continuation
                    self.closeTimeout = Task { @MainActor [weak self] in
                        do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
                        self?.finishCloseWait()
                    }
                    if !self.sendEvent(["type": "session.close", "event_id": UUID().uuidString]) {
                        self.finishCloseWait()
                    }
                }
            }
            return self.closeConnection()
        }
        closeTask = task
        let result = await task.value
        closeTask = nil
        return result
    }

    @MainActor
    private func finishCloseWait() {
        closeTimeout?.cancel()
        closeTimeout = nil
        let waiter = closeWaiter
        closeWaiter = nil
        waiter?.resume()
    }

    @MainActor
    override func closeConnection() -> String {
        closed = true
        closing = true
        finishStart(error: OpenAIWebRTCError.connectionFailed("closed"))
        finishCloseWait()
        responses.removeAll()
        callResponses.removeAll()
        delegationResponses.removeAll()
        return super.closeConnection()
    }

    override func handleDataChannelMessage(_ event: [String: Any]) {
        DispatchQueue.main.async { [weak self] in self?.handleLiveEvent(event) }
    }

    @MainActor
    override func connectionStateDidChange(_ state: RTCIceConnectionState) {
        guard started, !closing, !closed, state == .failed || state == .closed else { return }
        emitModuleEvent("onRealtimeError", payload: ["error": ["message": "The GPT-Live connection was lost."]])
        _ = closeConnection()
        emitModuleEvent("onVoiceSessionClosed", payload: ["reason": "connection_lost"])
    }

    @MainActor
    private func handleLiveEvent(_ event: [String: Any]) {
        guard !closed, let type = event["type"] as? String else { return }
        logger.log("[Live] Event", attributes: logAttributes(for: .debug, metadata: event))
        switch type {
        case "session.started":
            started = true
            finishStart()
            guard !closing, greetingEventId == nil else { return }
            let eventId = "greeting_\(sessionId)"
            greetingEventId = eventId
            if !sendEvent([
                "type": "session.instructions.append", "event_id": eventId,
                "delegation_id": NSNull(),
                "content":
                    "Greet the user in \(greetingLanguage) with a friendly tone, immediately, without waiting for them to speak. Then pause and listen.",
            ]) {
                logger.log("[Live] Greeting could not be sent; conversation remains available")
            }
        case "session.instructions.appended":
            if event["client_event_id"] as? String == greetingEventId {
                logger.log(
                    "[Live] Greeting acknowledged", attributes: logAttributes(for: .info, metadata: event))
            }
        case "session.usage.updated":
            emitVoiceUsage(event)
        case "session.closed":
            emitVoiceUsage(event)
            let wasClosing = closing
            finishCloseWait()
            if !wasClosing { _ = closeConnection() }
            emitModuleEvent("onVoiceSessionClosed", payload: ["reason": event["reason"] ?? "closed"])
        case "session.input_transcript.delta", "session.output_transcript.delta":
            emitModuleEvent(
                "onTranscript",
                payload: [
                    "type": "audio_transcript", "isDone": false,
                    "role": type == "session.input_transcript.delta" ? "user" : "assistant",
                    "delta": event["delta"] ?? "", "startMs": event["start_ms"] ?? NSNull(),
                    "endMs": event["end_ms"] ?? NSNull(), "timestampMs": Date().timeIntervalSince1970 * 1000,
                ])
        case "session.delegation.created":
            if let id = event["delegation_id"] as? String, let responseId = event["response_id"] as? String {
                delegationResponses[id] = responseId
            }
        case "response.event":
            if let inner = event["event"] as? [String: Any] {
                handleBackendEvent(inner, delegationId: event["delegation_id"] as? String)
            }
        case "error":
            let error = event["error"] as? [String: Any] ?? [:]
            let clientEventId = event["client_event_id"] as? String ?? error["client_event_id"] as? String
            if let greetingEventId, clientEventId == greetingEventId {
                logger.log(
                    "[Live] Greeting rejected; conversation remains available",
                    attributes: logAttributes(for: .warn, metadata: event))
            } else if !started {
                finishStart(
                    error: OpenAIWebRTCError.connectionFailed(
                        error["message"] as? String ?? "Live session error"))
            } else {
                emitModuleEvent("onRealtimeError", payload: event)
            }
        default: break
        }
    }

    @MainActor
    private func emitVoiceUsage(_ event: [String: Any]) {
        guard let usage = event["usage"] as? [String: Any], let seconds = usage["seconds"] as? NSNumber else {
            return
        }
        emitModuleEvent(
            "onTokenUsage",
            payload: ["liveSeconds": seconds, "timestampMs": Date().timeIntervalSince1970 * 1000])
    }

    @MainActor
    private func handleBackendEvent(_ event: [String: Any], delegationId: String?) {
        guard let type = event["type"] as? String else { return }
        let response = event["response"] as? [String: Any]
        guard
            let responseId = response?["id"] as? String ?? event["response_id"] as? String
                ?? delegationId.flatMap({ delegationResponses[$0] })
        else { return }
        if let delegationId { delegationResponses[delegationId] = responseId }
        switch type {
        case "response.created":
            if responses[responseId] == nil { responses[responseId] = BackendResponse() }
        case "response.output_item.done":
            guard !closing, let item = event["item"] as? [String: Any],
                item["type"] as? String == "function_call",
                let callId = item["call_id"] as? String, let name = item["name"] as? String,
                let arguments = item["arguments"] as? String, callResponses[callId] == nil
            else { return }
            callResponses[callId] = responseId
            responses[responseId, default: BackendResponse()].calls.insert(callId)
            responses[responseId]?.pending.insert(callId)
            emitModuleEvent("onVoiceSessionStatus", payload: ["status_update": "Tool called: \(name)"])
            if let delegate = toolDelegates[name] {
                delegate.handleToolCall(callId: callId, argumentsJSON: arguments)
            } else if name.contains("__"), let toolkitHelper {
                toolkitHelper.handleToolkitCall(callId: callId, toolName: name, argumentsJSON: arguments)
            } else {
                sendToolCallError(callId: callId, error: "Tool not configured: \(name)")
            }
        case "response.completed", "response.failed", "response.incomplete":
            if billedResponses.insert(responseId).inserted, let usage = response?["usage"] as? [String: Any] {
                let details = usage["input_tokens_details"] as? [String: Any] ?? [:]
                emitModuleEvent(
                    "onTokenUsage",
                    payload: [
                        "responseId": responseId, "timestampMs": Date().timeIntervalSince1970 * 1000,
                        "liveBackend": [
                            "model": response?["model"] as? String ?? Self.backendModel,
                            "inputTokens": usage["input_tokens"] ?? 0,
                            "cachedInputTokens": details["cached_tokens"] ?? 0,
                            "outputTokens": usage["output_tokens"] ?? 0,
                        ],
                    ])
            }
            // Terminal snapshots have empty output; retain the calls collected above.
            if type == "response.completed" {
                responses[responseId]?.completed = true
                continueBackendIfReady(responseId)
            } else {
                responses.removeValue(forKey: responseId)
                emitModuleEvent(
                    "onRealtimeError",
                    payload: [
                        "error": ["message": "GPT-Live's backend response did not complete."],
                        "response": response ?? [:],
                    ])
            }
        default: break
        }
    }

    func sendToolCallResult(callId: String, result: String) {
        Task { @MainActor [weak self] in
            guard let self, !self.closing, !self.closed,
                let responseId = self.callResponses[callId],
                self.responses[responseId]?.pending.contains(callId) == true
            else { return }
            guard
                self.sendEvent([
                    "type": "response.item.create", "event_id": UUID().uuidString,
                    "item": ["type": "function_call_output", "call_id": callId, "output": result],
                ])
            else {
                self.emitModuleEvent(
                    "onRealtimeError",
                    payload: ["error": ["message": "Could not send the tool result to GPT-Live."]])
                return
            }
            self.responses[responseId]?.pending.remove(callId)
            self.continueBackendIfReady(responseId)
        }
    }

    func sendToolCallError(callId: String, error: String) {
        let data = try? JSONSerialization.data(withJSONObject: ["error": error])
        sendToolCallResult(
            callId: callId, result: data.flatMap { String(data: $0, encoding: .utf8) } ?? "Tool failed")
    }

    @MainActor
    private func continueBackendIfReady(_ responseId: String) {
        guard !closing, !closed, let response = responses[responseId], response.completed,
            !response.calls.isEmpty, response.pending.isEmpty, !response.continued
        else { return }
        responses[responseId]?.continued = true
        if !sendEvent(["type": "response.create", "event_id": UUID().uuidString]) {
            emitModuleEvent(
                "onRealtimeError",
                payload: ["error": ["message": "Could not continue GPT-Live's backend response."]])
        }
    }
}
