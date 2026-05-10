import AVFoundation
import Foundation
import WebRTC

extension OpenAIWebRTCBase {
    // MARK: - Helper Methods

    func buildEndpointURL(baseURL: String?, model: String?) throws -> URL {
        let endpoint = (baseURL?.isEmpty == false ? baseURL! : defaultEndpoint)
        self.logger.log(
            "[VmWebrtc] " + "Building OpenAI endpoint URL",
            attributes: logAttributes(for: .debug, metadata: ["base": endpoint]))
        guard var components = URLComponents(string: endpoint) else {
            self.logger.log(
                "[VmWebrtc] " + "Failed to parse OpenAI endpoint",
                attributes: logAttributes(for: .error, metadata: ["endpoint": endpoint]))
            throw OpenAIWebRTCError.invalidEndpoint
        }

        var items = components.queryItems ?? []
        if items.contains(where: { $0.name == "model" }) == false {
            items.append(
                URLQueryItem(
                    name: "model", value: (model?.isEmpty == false ? model! : defaultModel)))
        }
        components.queryItems = items

        guard let url = components.url else {
            self.logger.log(
                "[VmWebrtc] " + "Failed to build final OpenAI endpoint URL",
                attributes: logAttributes(for: .error, metadata: ["endpoint": endpoint]))
            throw OpenAIWebRTCError.invalidEndpoint
        }
        self.logger.log(
            "[VmWebrtc] " + "OpenAI endpoint URL ready",
            attributes: logAttributes(for: .debug, metadata: ["url": url.absoluteString]))
        return url
    }

    func configureAudioSession(for output: AudioOutputPreference) throws {
        guard !skipAudioSession else {
            logger.log(
                "[VmWebrtc] Skipping audio session configuration (secondary session)",
                attributes: logAttributes(for: .debug))
            return
        }
        let desiredRoute: OutputRoute = (output == .speakerphone) ? .speaker : .receiver
        let session = AVAudioSession.sharedInstance()
        self.logger.log(
            "[VmWebrtc] " + "Configuring AVAudioSession route",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "desiredRoute": desiredRoute == .speaker ? "speaker" : "receiver",
                    "currentCategory": session.category.rawValue,
                    "currentMode": session.mode.rawValue,
                    "categoryOptions": describeCategoryOptions(session.categoryOptions),
                    "currentOutputs": describeAudioOutputs(session.currentRoute),
                    "outputVolume": session.outputVolume,
                ]))
        configureWebRTCAudioSession(for: desiredRoute)
        setOutput(desiredRoute)
        startMonitoringAudioRouteChanges()
    }

    private func configureWebRTCAudioSession(for route: OutputRoute) {
        let configuration = RTCAudioSessionConfiguration.webRTC()
        configuration.mode = AVAudioSession.Mode.voiceChat.rawValue
        configuration.category = AVAudioSession.Category.playAndRecord.rawValue

        var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .mixWithOthers]
        if route == .speaker {
            options.insert(.defaultToSpeaker)
        }
        configuration.categoryOptions = options

        RTCAudioSessionConfiguration.setWebRTC(configuration)
        self.logger.log(
            "[VmWebrtc] " + "Applied WebRTC audio session defaults",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "route": route == .speaker ? "speaker" : "receiver",
                    "mode": configuration.mode,
                    "category": configuration.category,
                    "options": describeCategoryOptions(options),
                ]))
    }

    private func setOutput(_ route: OutputRoute) {
        let rtcSession = RTCAudioSession.sharedInstance()
        rtcSession.lockForConfiguration()
        defer { rtcSession.unlockForConfiguration() }

        let session = AVAudioSession.sharedInstance()

        do {
            self.logger.log(
                "[VmWebrtc] " + "Setting audio session category",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "route": route == .speaker ? "speaker" : "receiver",
                        "previousCategory": session.category.rawValue,
                        "previousMode": session.mode.rawValue,
                        "previousOptions": describeCategoryOptions(session.categoryOptions),
                        "previousOutputs": describeAudioOutputs(session.currentRoute),
                    ]))

            var options: AVAudioSession.CategoryOptions = [.allowBluetooth, .mixWithOthers]
            if route == .speaker {
                options.insert(.defaultToSpeaker)
            }

            try session.setCategory(.playAndRecord, mode: .voiceChat, options: options)
            try session.setActive(true)

            let overridePort: AVAudioSession.PortOverride = (route == .speaker) ? .speaker : .none
            try session.overrideOutputAudioPort(overridePort)

            self.logger.log(
                "[VmWebrtc] " + "Audio route updated",
                attributes: logAttributes(
                    for: .info,
                    metadata: [
                        "override": overridePort == .speaker ? "speaker" : "receiver",
                        "category": session.category.rawValue,
                        "mode": session.mode.rawValue,
                        "options": describeCategoryOptions(session.categoryOptions),
                        "currentOutputs": describeAudioOutputs(session.currentRoute),
                        "currentInputs": describeAudioInputs(session.currentRoute),
                        "outputVolume": session.outputVolume,
                    ]))
        } catch {
            self.logger.log(
                "[VmWebrtc] " + "Audio route switch failed",
                attributes: logAttributes(
                    for: .error,
                    metadata: [
                        "override": route == .speaker ? "speaker" : "receiver",
                        "error": error.localizedDescription,
                        "category": session.category.rawValue,
                        "mode": session.mode.rawValue,
                        "options": describeCategoryOptions(session.categoryOptions),
                        "currentOutputs": describeAudioOutputs(session.currentRoute),
                    ]))
        }
    }

    private func startMonitoringAudioRouteChanges() {
        guard !isMonitoringAudioRoute else { return }
        RTCAudioSession.sharedInstance().add(self)
        isMonitoringAudioRoute = true
        let session = AVAudioSession.sharedInstance()
        self.logger.log(
            "[VmWebrtc] " + "Started monitoring audio routes",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "category": session.category.rawValue,
                    "mode": session.mode.rawValue,
                    "options": describeCategoryOptions(session.categoryOptions),
                    "currentOutputs": describeAudioOutputs(session.currentRoute),
                    "outputVolume": session.outputVolume,
                ]))
    }

    func stopMonitoringAudioRouteChanges() {
        guard isMonitoringAudioRoute else { return }
        RTCAudioSession.sharedInstance().remove(self)
        isMonitoringAudioRoute = false
        let session = AVAudioSession.sharedInstance()
        self.logger.log(
            "[VmWebrtc] " + "Stopped monitoring audio routes",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "category": session.category.rawValue,
                    "mode": session.mode.rawValue,
                    "options": describeCategoryOptions(session.categoryOptions),
                    "currentOutputs": describeAudioOutputs(session.currentRoute),
                ]))
    }

    func deactivateAudioSession() {
        guard !skipAudioSession else {
            logger.log(
                "[VmWebrtc] Skipping audio session deactivation (secondary session)",
                attributes: logAttributes(for: .debug))
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(false, options: [.notifyOthersOnDeactivation])
            self.logger.log(
                "[VmWebrtc] " + "AVAudioSession deactivated",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "category": session.category.rawValue,
                        "mode": session.mode.rawValue,
                    ]))
        } catch {
            self.logger.log(
                "[VmWebrtc] " + "Failed to deactivate AVAudioSession",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "error": error.localizedDescription,
                        "category": session.category.rawValue,
                        "mode": session.mode.rawValue,
                    ]))
        }
    }

    private func describeAudioOutputs(_ route: AVAudioSessionRouteDescription) -> String {
        let outputs = route.outputs.map { "\($0.portType.rawValue)(\($0.portName))" }
        return outputs.isEmpty ? "none" : outputs.joined(separator: ", ")
    }

    private func describeAudioInputs(_ route: AVAudioSessionRouteDescription) -> String {
        let inputs = route.inputs.map { "\($0.portType.rawValue)(\($0.portName))" }
        return inputs.isEmpty ? "none" : inputs.joined(separator: ", ")
    }

    private func describeCategoryOptions(_ options: AVAudioSession.CategoryOptions) -> String {
        var flags: [String] = []
        if options.contains(.mixWithOthers) { flags.append("mixWithOthers") }
        if options.contains(.duckOthers) { flags.append("duckOthers") }
        if options.contains(.allowBluetooth) { flags.append("allowBluetooth") }
        if options.contains(.defaultToSpeaker) { flags.append("defaultToSpeaker") }
        if options.contains(.interruptSpokenAudioAndMixWithOthers) {
            flags.append("interruptSpokenAudioAndMixWithOthers")
        }
        if options.contains(.allowBluetoothA2DP) { flags.append("allowBluetoothA2DP") }
        if options.contains(.allowAirPlay) { flags.append("allowAirPlay") }
        return flags.isEmpty ? "none" : flags.joined(separator: ", ")
    }

    private func describeRouteChangeReason(_ reason: AVAudioSession.RouteChangeReason) -> String {
        switch reason {
        case .unknown: return "unknown"
        case .newDeviceAvailable: return "newDeviceAvailable"
        case .oldDeviceUnavailable: return "oldDeviceUnavailable"
        case .categoryChange: return "categoryChange"
        case .override: return "override"
        case .wakeFromSleep: return "wakeFromSleep"
        case .noSuitableRouteForCategory: return "noSuitableRouteForCategory"
        case .routeConfigurationChange: return "routeConfigurationChange"
        @unknown default: return "unknown(\(reason.rawValue))"
        }
    }

    private func startInboundAudioStatsMonitoring() {
        inboundAudioMonitor.start()
    }

    func stopInboundAudioStatsMonitoring() {
        inboundAudioMonitor.stop()
    }

    private func startOutboundAudioStatsMonitoring() {
        outboundAudioMonitor.start()
    }

    func stopOutboundAudioStatsMonitoring() {
        outboundAudioMonitor.stop()
    }

    func makePeerConnection() throws -> RTCPeerConnection {
        if let existingConnection = peerConnection {
            self.logger.log(
                "[VmWebrtc] " + "Disposing existing peer connection before creating a new one",
                attributes: logAttributes(for: .warn))
            stopInboundAudioStatsMonitoring()
            stopOutboundAudioStatsMonitoring()
            remoteAudioTrackId = nil
            existingConnection.close()
            peerConnection = nil
        }

        hasSentInitialSessionConfig = false

        iceGatheringTimeoutTask?.cancel()
        iceGatheringTimeoutTask = nil
        iceGatheringStartTimestamp = nil

        let configuration = RTCConfiguration()
        configuration.iceServers = [RTCIceServer(urlStrings: ["stun:stun.l.google.com:19302"])]
        configuration.iceCandidatePoolSize = 1
        configuration.continualGatheringPolicy = .gatherContinually

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": "true"]
        )

        guard
            let connection = factory.peerConnection(
                with: configuration,
                constraints: constraints,
                delegate: self
            )
        else {
            self.logger.log(
                "[VmWebrtc] " + "Failed to create RTCPeerConnection instance",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.connectionFailed("peerConnectionFactory returned nil")
        }

        self.logger.log(
            "[VmWebrtc] " + "Created RTCPeerConnection",
            attributes: logAttributes(
                for: .debug, metadata: ["iceServers": configuration.iceServers.count]))

        let audioConstraints = RTCMediaConstraints(
            mandatoryConstraints: [
                "googEchoCancellation": "true",
                "googAutoGainControl": "true",
                "googHighpassFilter": "true",
                "googNoiseSuppression": "true",
            ],
            optionalConstraints: nil
        )

        let audioSource = factory.audioSource(with: audioConstraints)
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")

        guard connection.add(audioTrack, streamIds: ["stream0"]) != nil else {
            self.logger.log(
                "[VmWebrtc] " + "Failed to attach audio track to peer connection",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.failedToAddAudioTrack
        }

        self.audioTrack = audioTrack
        audioTrack.isEnabled = !isOutgoingAudioMuted
        self.logger.log(
            "[VmWebrtc] " + "Attached audio track to peer connection",
            attributes: logAttributes(for: .debug))

        let dataChannelConfig = RTCDataChannelConfiguration()
        dataChannelConfig.channelId = 0
        dataChannelConfig.isOrdered = true
        dataChannel = connection.dataChannel(
            forLabel: "oai-events", configuration: dataChannelConfig)

        if let dataChannel {
            dataChannel.delegate = self
            self.logger.log(
                "[VmWebrtc] " + "Created data channel",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "label": dataChannel.label,
                        "isOrdered": dataChannelConfig.isOrdered,
                        "channelId": dataChannelConfig.channelId,
                    ]))
        } else {
            self.logger.log(
                "[VmWebrtc] " + "Failed to create data channel",
                attributes: logAttributes(for: .error))
        }

        peerConnection = connection

        return connection
    }

    func createOffer(connection: RTCPeerConnection) async throws -> RTCSessionDescription {
        let constraints = RTCMediaConstraints(
            mandatoryConstraints: ["OfferToReceiveAudio": "true"],
            optionalConstraints: ["OfferToReceiveVideo": "false"]
        )

        return try await withCheckedThrowingContinuation { continuation in
            connection.offer(for: constraints) { sdp, error in
                if let error = error {
                    self.logger.log(
                        "[VmWebrtc] " + "Failed to create local SDP offer",
                        attributes: logAttributes(
                            for: .error, metadata: ["error": error.localizedDescription]))
                    continuation.resume(throwing: error)
                    return
                }

                guard let sdp = sdp else {
                    self.logger.log(
                        "[VmWebrtc] " + "Peer connection returned an empty SDP offer",
                        attributes: logAttributes(for: .error))
                    continuation.resume(throwing: OpenAIWebRTCError.connectionFailed("failed"))
                    return
                }

                self.logger.log(
                    "[VmWebrtc] " + "Local SDP offer ready",
                    attributes: logAttributes(for: .debug, metadata: ["sdpLength": sdp.sdp.count]))
                continuation.resume(returning: sdp)
            }
        }
    }

    func setLocalDescription(
        _ description: RTCSessionDescription, for connection: RTCPeerConnection
    ) async throws {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            connection.setLocalDescription(description) { error in
                if let error = error {
                    self.logger.log(
                        "[VmWebrtc] " + "Failed to set local description",
                        attributes: logAttributes(
                            for: .error, metadata: ["error": error.localizedDescription]))
                    continuation.resume(throwing: error)
                } else {
                    self.logger.log(
                        "[VmWebrtc] " + "Local description successfully set",
                        attributes: logAttributes(for: .debug))
                    continuation.resume(returning: ())
                }
            }
        }
    }

    func setRemoteDescription(
        _ description: RTCSessionDescription, for connection: RTCPeerConnection
    ) async throws {
        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            connection.setRemoteDescription(description) { error in
                if let error = error {
                    self.logger.log(
                        "[VmWebrtc] " + "Failed to set remote description",
                        attributes: logAttributes(
                            for: .error, metadata: ["error": error.localizedDescription]))
                    continuation.resume(throwing: error)
                } else {
                    self.logger.log(
                        "[VmWebrtc] " + "Remote description successfully set",
                        attributes: logAttributes(for: .debug))
                    continuation.resume(returning: ())
                }
            }
        }
    }

    func waitForIceGathering(on connection: RTCPeerConnection, timeout: TimeInterval?) async throws
        -> TimeInterval
    {
        if connection.iceGatheringState == .complete {
            self.logger.log(
                "[VmWebrtc] " + "ICE gathering already complete",
                attributes: logAttributes(
                    for: .debug, metadata: ["state": connection.iceGatheringState.rawValue]))
            return 0
        }

        self.logger.log(
            "[VmWebrtc] " + "Waiting for ICE gathering to complete",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "state": connection.iceGatheringState.rawValue,
                    "timeoutSeconds": timeout ?? 0,
                ]))

        let start = Date()
        iceGatheringStartTimestamp = start

        defer {
            iceGatheringTimeoutTask?.cancel()
            iceGatheringTimeoutTask = nil
        }

        try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, Error>) in
            iceGatheringContinuation = continuation

            if let timeout, timeout > 0 {
                iceGatheringTimeoutTask?.cancel()
                iceGatheringTimeoutTask = Task { [weak self] in
                    let nanoseconds = UInt64(timeout * 1_000_000_000)
                    do {
                        try await Task.sleep(nanoseconds: nanoseconds)
                    } catch {
                        return
                    }

                    guard let self, !Task.isCancelled else { return }

                    await MainActor.run { [weak self] in
                        guard let self else { return }
                        guard let continuation = self.iceGatheringContinuation else { return }
                        self.logger.log(
                            "[VmWebrtc] "
                                + "ICE gathering timeout reached; sending offer with partial candidates",
                            attributes: logAttributes(
                                for: .warn,
                                metadata: [
                                    "timeoutSeconds": timeout,
                                    "currentState": connection.iceGatheringState.rawValue,
                                ]))
                        self.iceGatheringTimeoutTask = nil
                        self.iceGatheringContinuation = nil
                        continuation.resume(returning: ())
                    }
                }
            }
        }

        let elapsed = Date().timeIntervalSince(start)
        iceGatheringStartTimestamp = nil
        return elapsed
    }

    func exchangeSDPWithOpenAI(apiKey: String, endpointURL: URL, offerSDP: String) async throws
        -> String
    {
        self.logger.log(
            "[VmWebrtc] " + "Sending SDP offer to OpenAI",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "endpoint": endpointURL.absoluteString,
                    "sdpLength": offerSDP.count,
                ]))

        var request = URLRequest(url: endpointURL)
        request.httpMethod = "POST"
        request.httpBody = offerSDP.data(using: .utf8)
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            self.logger.log(
                "[VmWebrtc] " + "OpenAI response missing HTTP status",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.openAIResponseDecoding
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            self.logger.log(
                "[VmWebrtc] " + "OpenAI rejected SDP offer",
                attributes: logAttributes(
                    for: .error, metadata: ["status": httpResponse.statusCode]))
            throw OpenAIWebRTCError.openAIRejected(httpResponse.statusCode)
        }

        guard let answer = String(data: data, encoding: .utf8), !answer.isEmpty else {
            self.logger.log(
                "[VmWebrtc] " + "OpenAI returned an empty SDP answer",
                attributes: logAttributes(for: .error))
            throw OpenAIWebRTCError.openAIResponseDecoding
        }

        self.logger.log(
            "[VmWebrtc] " + "Received SDP answer from OpenAI",
            attributes: logAttributes(for: .debug, metadata: ["sdpLength": answer.count]))
        return answer
    }

    func waitForConnection(toReach connection: RTCPeerConnection, timeout: TimeInterval)
        async throws -> String
    {
        if connection.iceConnectionState == .connected
            || connection.iceConnectionState == .completed
        {
            let state = stringValue(for: connection.iceConnectionState)
            self.logger.log(
                "[VmWebrtc] " + "OpenAI WebRTC connection established",
                attributes: logAttributes(for: .info, metadata: ["state": state]))
            return state
        }

        self.logger.log(
            "[VmWebrtc] " + "Waiting for ICE connection state to reach connected",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "currentState": stringValue(for: connection.iceConnectionState),
                    "timeoutSeconds": timeout,
                ]))
        return try await withCheckedThrowingContinuation { continuation in
            connectionContinuation = continuation
            connectionTimeoutTask?.cancel()
            connectionTimeoutTask = Task { [weak self] in
                let nanoseconds = UInt64(timeout * 1_000_000_000)
                do {
                    try await Task.sleep(nanoseconds: nanoseconds)
                } catch {
                    return
                }

                guard let self, !Task.isCancelled else { return }

                self.logger.log(
                    "[VmWebrtc] " + "Timed out waiting for ICE connection state to reach connected",
                    attributes: logAttributes(
                        for: .error,
                        metadata: [
                            "lastState": stringValue(for: connection.iceConnectionState),
                            "timeoutSeconds": timeout,
                        ]))
                self.failPendingConnection(with: OpenAIWebRTCError.connectionTimeout)
            }
        }
    }

    private func failPendingConnection(with error: OpenAIWebRTCError) {
        self.logger.log(
            "[VmWebrtc] " + "Failing pending OpenAI WebRTC connection",
            attributes: logAttributes(for: .error, metadata: ["reason": error.localizedDescription])
        )
        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        connectionContinuation?.resume(throwing: error)
        connectionContinuation = nil
    }

    @MainActor
    func handleIdleTimeoutTriggered() {
        guard peerConnection != nil || dataChannel != nil else {
            self.logger.log(
                "[VmWebrtc] " + "[IdleTimer] Timeout fired without an active session; ignoring",
                attributes: logAttributes(for: .trace))
            return
        }

        self.logger.log(
            "[VmWebrtc] " + "[IdleTimer] Inactivity threshold reached, disconnecting session",
            attributes: logAttributes(for: .trace))

        let previousState = closeConnection()
        let timestampMs = Int(Date().timeIntervalSince1970 * 1000)

        emitModuleEvent(
            "onIdleTimeout",
            payload: [
                "reason": "idleTimeout",
                "previousState": previousState,
                "timestampMs": timestampMs,
            ])
    }

    @discardableResult
    func sendEvent(_ payload: [String: Any]) -> Bool {
        guard let dataChannel else {
            self.logger.log(
                "[VmWebrtc] " + "Attempted to send event without an active data channel",
                attributes: logAttributes(for: .error))
            return false
        }

        do {
            let data = try JSONSerialization.data(withJSONObject: payload, options: [])
            let buffer = RTCDataBuffer(data: data, isBinary: false)
            let success = dataChannel.sendData(buffer)
            let payloadPreview = String(data: data, encoding: .utf8) ?? "<non_utf8_payload>"
            self.logger.log(
                "[VmWebrtc] " + "Sent data channel event",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "bytes": data.count,
                        "success": success,
                        "eventType": payload["type"] as? String ?? "unknown",
                        "payloadKeys": Array(payload.keys),
                        "payloadPreview": String(payloadPreview.prefix(200)),
                        "payload": payload,
                    ]))
            return success
        } catch {
            self.logger.log(
                "[VmWebrtc] " + "Failed to encode event payload",
                attributes: logAttributes(
                    for: .error, metadata: ["error": error.localizedDescription]))
            return false
        }
    }

    func sendDataChannelMessage(_ event: [String: Any]) {
        guard let dataChannel = dataChannel, dataChannel.readyState == .open else {
            logger.log(
                "[VmWebrtc] Cannot send data channel message - channel not open",
                attributes: logAttributes(
                    for: .warn,
                    metadata: [
                        "channelState": dataChannel?.readyState.rawValue as Any,
                        "eventType": event["type"] as Any,
                    ])
            )
            return
        }

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: event, options: [])
            let buffer = RTCDataBuffer(data: jsonData, isBinary: false)
            let success = dataChannel.sendData(buffer)

            if success {
                var metadata: [String: Any] = [
                    "eventType": event["type"] as Any,
                    "dataSize": jsonData.count,
                ]
                if let eventId = event["event_id"] as? String { metadata["eventId"] = eventId }
                if let eventType = event["type"] as? String, eventType == "conversation.item.delete",
                    let itemId = event["item_id"] as? String
                {
                    metadata["itemId"] = itemId
                }
                logger.log(
                    "[VmWebrtc] Data channel message sent",
                    attributes: logAttributes(for: .debug, metadata: metadata))
            } else {
                logger.log(
                    "[VmWebrtc] Failed to send data channel message",
                    attributes: logAttributes(
                        for: .warn, metadata: ["eventType": event["type"] as Any]))
            }
        } catch {
            logger.log(
                "[VmWebrtc] Failed to serialize data channel message",
                attributes: logAttributes(
                    for: .error,
                    metadata: ["eventType": event["type"] as Any, "error": error.localizedDescription]
                ))
        }
    }

    private func stringValue(for state: RTCDataChannelState) -> String {
        switch state {
        case .connecting: return "connecting"
        case .open: return "open"
        case .closing: return "closing"
        case .closed: return "closed"
        @unknown default: return "unknown"
        }
    }
}

// MARK: - RTCAudioSessionDelegate

extension OpenAIWebRTCBase: RTCAudioSessionDelegate {
    func audioSessionDidStartPlayOrRecord(_ session: RTCAudioSession) {
        let avSession = AVAudioSession.sharedInstance()
        self.logger.log(
            "🔊🎧 [RTCAudioSession] WebRTC audio I/O started",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "category": avSession.category.rawValue,
                    "mode": avSession.mode.rawValue,
                    "currentOutputs": describeAudioOutputs(avSession.currentRoute),
                    "currentInputs": describeAudioInputs(avSession.currentRoute),
                    "outputVolume": avSession.outputVolume,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ]))
    }

    func audioSessionDidStopPlayOrRecord(_ session: RTCAudioSession) {
        let avSession = AVAudioSession.sharedInstance()
        self.logger.log(
            "🔇🎧 [RTCAudioSession] WebRTC audio I/O stopped",
            attributes: logAttributes(
                for: .info,
                metadata: [
                    "category": avSession.category.rawValue,
                    "mode": avSession.mode.rawValue,
                    "currentOutputs": describeAudioOutputs(avSession.currentRoute),
                    "currentInputs": describeAudioInputs(avSession.currentRoute),
                    "outputVolume": avSession.outputVolume,
                    "timestamp": ISO8601DateFormatter().string(from: Date()),
                ]))
    }

    func audioSession(_ audioSession: RTCAudioSession, didSetActive active: Bool) {
        let session = AVAudioSession.sharedInstance()
        self.logger.log(
            "[VmWebrtc] " + "RTCAudioSession didSetActive",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "active": active,
                    "category": session.category.rawValue,
                    "mode": session.mode.rawValue,
                    "currentOutputs": describeAudioOutputs(session.currentRoute),
                    "currentInputs": describeAudioInputs(session.currentRoute),
                    "outputVolume": session.outputVolume,
                ]))
    }

    func audioSession(
        _ audioSession: RTCAudioSession,
        didChange routeChangeReason: AVAudioSession.RouteChangeReason,
        previousRoute: AVAudioSessionRouteDescription
    ) {
        self.logger.log(
            "[VmWebrtc] " + "Audio route change detected",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "reason": describeRouteChangeReason(routeChangeReason),
                    "rawReason": routeChangeReason.rawValue,
                    "previousOutputs": describeAudioOutputs(previousRoute),
                    "previousInputs": describeAudioInputs(previousRoute),
                    "currentOutputs": describeAudioOutputs(
                        AVAudioSession.sharedInstance().currentRoute),
                    "currentInputs": describeAudioInputs(
                        AVAudioSession.sharedInstance().currentRoute),
                    "category": AVAudioSession.sharedInstance().category.rawValue,
                    "mode": AVAudioSession.sharedInstance().mode.rawValue,
                    "outputVolume": AVAudioSession.sharedInstance().outputVolume,
                ]))
    }

    func audioSession(_ audioSession: RTCAudioSession, didChange canPlayOrRecord: Bool) {
        let session = AVAudioSession.sharedInstance()
        self.logger.log(
            "[VmWebrtc] " + "RTCAudioSession canPlayOrRecord changed",
            attributes: logAttributes(
                for: .debug,
                metadata: [
                    "canPlayOrRecord": canPlayOrRecord,
                    "category": session.category.rawValue,
                    "mode": session.mode.rawValue,
                    "currentOutputs": describeAudioOutputs(session.currentRoute),
                    "currentInputs": describeAudioInputs(session.currentRoute),
                ]))
    }
}

// MARK: - RTCPeerConnectionDelegate

extension OpenAIWebRTCBase: RTCPeerConnectionDelegate {
    func peerConnection(
        _ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState
    ) {}

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        let audioTrackCount = stream.audioTracks.count
        let videoTrackCount = stream.videoTracks.count
        let streamId = stream.streamId
        guard let audioTrack = stream.audioTracks.first else {
            self.logger.log(
                "[VmWebrtc] " + "Remote stream added without audio tracks",
                attributes: logAttributes(
                    for: .debug,
                    metadata: ["audioTrackCount": audioTrackCount, "videoTrackCount": videoTrackCount]
                ))
            return
        }
        let trackId = audioTrack.trackId

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.remoteAudioTrackId = trackId
            self.inboundAudioMonitor.reset()
            self.logger.log(
                "[VmWebrtc] " + "Remote audio track received",
                attributes: logAttributes(
                    for: .info, metadata: ["trackId": trackId, "streamId": streamId]))
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {
        guard let removedTrack = stream.audioTracks.first else { return }
        let removedTrackId = removedTrack.trackId
        let streamId = stream.streamId

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if removedTrackId == self.remoteAudioTrackId {
                self.logger.log(
                    "[VmWebrtc] " + "Remote audio track removed",
                    attributes: logAttributes(
                        for: .info,
                        metadata: ["trackId": removedTrackId, "streamId": streamId]))
                self.remoteAudioTrackId = nil
                self.inboundAudioMonitor.reset()
                self.stopInboundAudioStatsMonitoring()
                self.stopOutboundAudioStatsMonitoring()
            }
        }
    }

    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    func peerConnection(
        _ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState
    ) {
        let stateString = stringValue(for: newState)
        self.logger.log(
            "[VmWebrtc] " + "ICE connection state changed",
            attributes: logAttributes(for: .debug, metadata: ["state": stateString]))

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard let continuation = self.connectionContinuation else { return }

            switch newState {
            case .connected, .completed:
                self.startInboundAudioStatsMonitoring()
                self.startOutboundAudioStatsMonitoring()
                self.logger.log(
                    "[VmWebrtc] " + "OpenAI WebRTC connection established",
                    attributes: logAttributes(for: .info, metadata: ["state": stateString]))
                self.connectionTimeoutTask?.cancel()
                self.connectionTimeoutTask = nil
                self.connectionContinuation = nil
                continuation.resume(returning: stateString)
            case .failed, .disconnected, .closed:
                self.stopInboundAudioStatsMonitoring()
                self.stopOutboundAudioStatsMonitoring()
                self.logger.log(
                    "[VmWebrtc] " + "OpenAI WebRTC connection failed",
                    attributes: logAttributes(for: .error, metadata: ["state": stateString]))
                self.connectionTimeoutTask?.cancel()
                self.connectionTimeoutTask = nil
                self.connectionContinuation = nil
                continuation.resume(throwing: OpenAIWebRTCError.connectionFailed(stateString))
            case .checking, .new, .count:
                break
            @unknown default:
                break
            }
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate)
    {
        let sdpMid = candidate.sdpMid ?? ""
        let sdpMLineIndex = candidate.sdpMLineIndex
        let hasServerUrl = candidate.serverUrl != nil
        let now = Date()

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let isFirstCandidate = (self.firstCandidateTimestamp == nil)
            if isFirstCandidate { self.firstCandidateTimestamp = now }

            var metadata: [String: Any] = [
                "sdpMid": sdpMid,
                "sdpMLineIndex": sdpMLineIndex,
                "hasServerUrl": hasServerUrl,
                "isFirst": isFirstCandidate,
            ]
            if isFirstCandidate, let start = self.iceGatheringStartTimestamp {
                metadata["elapsedSinceGatherStart"] = now.timeIntervalSince(start)
            }
            self.logger.log(
                "[VmWebrtc] " + "Generated ICE candidate",
                attributes: logAttributes(for: .debug, metadata: metadata))
        }
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]
    ) {
        self.logger.log(
            "[VmWebrtc] " + "Removed ICE candidates",
            attributes: logAttributes(for: .debug, metadata: ["count": candidates.count]))
    }

    func peerConnection(
        _ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState
    ) {
        let stateRawValue = newState.rawValue
        self.logger.log(
            "[VmWebrtc] " + "ICE gathering state changed",
            attributes: logAttributes(for: .debug, metadata: ["state": stateRawValue]))

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if newState == .complete {
                self.iceGatheringTimeoutTask?.cancel()
                self.iceGatheringTimeoutTask = nil
            }
            guard newState == .complete, let continuation = self.iceGatheringContinuation else {
                return
            }
            self.iceGatheringContinuation = nil
            continuation.resume(returning: ())
        }
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        self.logger.log(
            "[VmWebrtc] " + "Data channel opened",
            attributes: logAttributes(for: .info, metadata: ["label": dataChannel.label]))
    }

    func stringValue(for state: RTCIceConnectionState) -> String {
        switch state {
        case .new: return "new"
        case .checking: return "checking"
        case .connected: return "connected"
        case .completed: return "completed"
        case .failed: return "failed"
        case .disconnected: return "disconnected"
        case .closed: return "closed"
        case .count: return "count"
        @unknown default: return "unknown"
        }
    }
}

// MARK: - RTCDataChannelDelegate

extension OpenAIWebRTCBase: RTCDataChannelDelegate {
    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        let label = dataChannel.label
        let readyState = dataChannel.readyState
        let stateString = stringValue(for: readyState)

        self.logger.log(
            "[VmWebrtc] " + "Data channel state changed",
            attributes: logAttributes(for: .debug, metadata: ["label": label, "state": stateString])
        )

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard dataChannel === self.dataChannel else { return }
            if readyState == .open {
                self.dataChannelDidOpen()
            }
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        if buffer.isBinary {
            self.logger.log(
                "[VmWebrtc] " + "Received binary data channel message",
                attributes: logAttributes(
                    for: .debug,
                    metadata: ["label": dataChannel.label, "bytes": buffer.data.count]))
            return
        }

        guard let text = String(data: buffer.data, encoding: .utf8) else {
            self.logger.log(
                "[VmWebrtc] " + "Received non-UTF8 data channel message",
                attributes: logAttributes(
                    for: .warn, metadata: ["label": dataChannel.label, "bytes": buffer.data.count]))
            return
        }

        self.logger.log(
            "[VmWebrtc] " + "Received data channel message",
            attributes: logAttributes(
                for: .trace, metadata: ["label": dataChannel.label, "payloadLength": text.count]))

        do {
            if let eventDict = try JSONSerialization.jsonObject(with: buffer.data, options: [])
                as? [String: Any]
            {
                self.handleDataChannelMessage(eventDict)
            } else {
                self.logger.log(
                    "[VmWebrtc] " + "Data channel message is not a JSON object",
                    attributes: logAttributes(for: .warn, metadata: ["payload": text]))
            }
        } catch {
            self.logger.log(
                "[VmWebrtc] " + "Failed to parse data channel message as JSON",
                attributes: logAttributes(
                    for: .error,
                    metadata: ["error": error.localizedDescription, "payload": text]))
        }
    }
}
