import AVFoundation
import Foundation
import WebRTC

// MARK: - Shared Error Type

enum OpenAIWebRTCError: LocalizedError {
    case invalidEndpoint
    case missingLocalDescription
    case missingAPIKey
    case openAIRejected(Int)
    case openAIResponseDecoding
    case connectionTimeout
    case connectionFailed(String)
    case failedToAddAudioTrack
    case missingInstructions

    var errorDescription: String? {
        switch self {
        case .invalidEndpoint:
            return "Failed to build the OpenAI Realtime endpoint URL."
        case .missingLocalDescription:
            return "The local WebRTC session description is missing after ICE gathering."
        case .missingAPIKey:
            return "An OpenAI API key must be set before starting a session."
        case .openAIRejected(let status):
            return "OpenAI Realtime endpoint rejected the SDP offer with status code \(status)."
        case .openAIResponseDecoding:
            return "Could not decode the SDP answer returned by OpenAI."
        case .connectionTimeout:
            return "Timed out waiting for the WebRTC connection to reach the connected state."
        case .connectionFailed(let state):
            return "WebRTC connection failed with state: \(state)."
        case .failedToAddAudioTrack:
            return "Could not attach the audio track to the peer connection."
        case .missingInstructions:
            return "Assistant instructions must be provided when starting a session."
        }
    }
}

// MARK: - Shared Enums

enum NativeLogLevel: String {
    case trace
    case debug
    case info
    case warn
    case error
}

enum AudioOutputPreference: String {
    case handset
    case speakerphone
}

enum TurnDetectionMode: String {
    case server
    case semantic
}

enum OutputRoute {
    case speaker
    case receiver
}

// MARK: - Base Class

class OpenAIWebRTCBase: NSObject {

    // MARK: Shared stored properties

    let factory: RTCPeerConnectionFactory
    var peerConnection: RTCPeerConnection?
    var audioTrack: RTCAudioTrack?
    var remoteAudioTrackId: String?
    var isOutgoingAudioMuted = false
    var dataChannel: RTCDataChannel?
    var iceGatheringContinuation: CheckedContinuation<Void, Error>?
    var connectionContinuation: CheckedContinuation<String, Error>?
    var connectionTimeoutTask: Task<Void, Never>?
    var iceGatheringTimeoutTask: Task<Void, Never>?
    var firstCandidateTimestamp: Date?
    var iceGatheringStartTimestamp: Date?
    var isMonitoringAudioRoute = false
    var hasSentInitialSessionConfig = false
    // When true, this is a secondary (reverse) session sharing the primary's AVAudioSession.
    // configureAudioSession and deactivateAudioSession become no-ops.
    var skipAudioSession = false
    let logger = VmWebrtcLogging.logger
    var apiKey: String?
    let iceGatheringGracePeriod: TimeInterval = 0.5

    // Lazy audio monitors — initialized on first access to avoid deinit issues
    private var _inboundAudioMonitor: InboundAudioStatsMonitor?
    var inboundAudioMonitor: InboundAudioStatsMonitor {
        if let existing = _inboundAudioMonitor { return existing }
        let monitor = InboundAudioStatsMonitor(
            peerConnectionProvider: { [weak self] in self?.peerConnection },
            remoteTrackIdentifierProvider: { [weak self] in self?.remoteAudioTrackId },
            logEmitter: { [weak self] level, message, metadata in
                guard let self else { return }
                self.logger.log(
                    "[VmWebrtc][\(level.rawValue.uppercased())] " + message,
                    attributes: logAttributes(for: level, metadata: metadata)
                )
            },
            speakingActivityRecorder: { [weak self] in self?.recordRemoteSpeakingActivity() }
        )
        _inboundAudioMonitor = monitor
        return monitor
    }

    private var _outboundAudioMonitor: OutboundAudioStatsMonitor?
    var outboundAudioMonitor: OutboundAudioStatsMonitor {
        if let existing = _outboundAudioMonitor { return existing }
        let monitor = OutboundAudioStatsMonitor(
            peerConnectionProvider: { [weak self] in self?.peerConnection },
            localTrackIdentifierProvider: { [weak self] in self?.audioTrack?.trackId },
            logEmitter: { [weak self] level, message, metadata in
                guard let self else { return }
                self.logger.log(
                    "[VmWebrtc][\(level.rawValue.uppercased())] " + message,
                    attributes: logAttributes(for: level, metadata: metadata)
                )
            },
            statsEventEmitter: { [weak self] metadata in
                guard let self else { return }
                Task { @MainActor in
                    self.emitModuleEvent("onOutboundAudioStats", payload: metadata)
                }
            }
        )
        _outboundAudioMonitor = monitor
        return monitor
    }

    private var moduleEventEmitter: ((String, [String: Any]) -> Void)?

    // MARK: Subclass-provided constants

    var defaultEndpoint: String { "" }
    var defaultModel: String { "" }

    // MARK: Init / deinit

    override init() {
        RTCInitializeSSL()
        self.factory = RTCPeerConnectionFactory()
        super.init()
    }

    deinit {
        connectionTimeoutTask?.cancel()
        iceGatheringTimeoutTask?.cancel()
        _inboundAudioMonitor?.stop()
        _outboundAudioMonitor?.stop()
        peerConnection?.close()
        if isMonitoringAudioRoute {
            RTCAudioSession.sharedInstance().remove(self)
            isMonitoringAudioRoute = false
        }
        RTCCleanupSSL()
    }

    // MARK: Virtual hooks — override in subclasses

    /// Called when the data channel first opens. Subclass sends its session init config here.
    func dataChannelDidOpen() {}

    /// Called for every parsed data channel message. Subclass routes to its event handler.
    func handleDataChannelMessage(_ event: [String: Any]) {}

    /// Called by inbound audio monitor when remote speaking activity is detected.
    func recordRemoteSpeakingActivity() {}

    // MARK: Common interface

    func setEventEmitter(_ emitter: @escaping (String, [String: Any]) -> Void) {
        moduleEventEmitter = emitter
    }

    func setAPIKey(_ apiKey: String) {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty else {
            self.apiKey = nil
            logger.log(
                "[VmWebrtc] Cleared OpenAI API key",
                attributes: logAttributes(for: .warn, metadata: ["reason": "empty_key"])
            )
            return
        }
        self.apiKey = trimmedKey
        logger.log(
            "[VmWebrtc] Stored OpenAI API key",
            attributes: logAttributes(for: .debug, metadata: ["keyLength": trimmedKey.count])
        )
    }

    @MainActor
    func setOutgoingAudioMuted(_ muted: Bool) {
        isOutgoingAudioMuted = muted
        if let audioTrack {
            audioTrack.isEnabled = !muted
            logger.log(
                "[VmWebrtc] " + (muted ? "Outgoing audio muted" : "Outgoing audio unmuted"),
                attributes: logAttributes(for: .info, metadata: ["hasAudioTrack": true])
            )
        } else {
            logger.log(
                "[VmWebrtc] Queued outgoing audio mute state",
                attributes: logAttributes(
                    for: .debug, metadata: ["muted": muted, "hasAudioTrack": false])
            )
        }
    }

    @MainActor
    func emitModuleEvent(_ name: String, payload: [String: Any]) {
        guard let moduleEventEmitter else {
            logger.log(
                "[VmWebrtc] No module event emitter configured; dropping event",
                attributes: logAttributes(for: .debug, metadata: ["event": name])
            )
            return
        }
        moduleEventEmitter(name, payload)
    }

    // MARK: Common teardown

    @MainActor
    func closeConnection() -> String {
        stopInboundAudioStatsMonitoring()
        stopOutboundAudioStatsMonitoring()
        remoteAudioTrackId = nil

        connectionTimeoutTask?.cancel()
        connectionTimeoutTask = nil
        iceGatheringTimeoutTask?.cancel()
        iceGatheringTimeoutTask = nil

        if let continuation = iceGatheringContinuation {
            iceGatheringContinuation = nil
            continuation.resume(returning: ())
        }
        if let continuation = connectionContinuation {
            connectionContinuation = nil
            continuation.resume(throwing: OpenAIWebRTCError.connectionFailed("closed"))
        }

        if let dataChannel {
            dataChannel.delegate = nil
            dataChannel.close()
            logger.log(
                "[VmWebrtc] Data channel closed",
                attributes: logAttributes(for: .debug, metadata: ["label": dataChannel.label])
            )
        }
        dataChannel = nil

        if let audioTrack { audioTrack.isEnabled = false }
        audioTrack = nil

        let hadPeerConnection = peerConnection != nil
        if let connection = peerConnection {
            connection.delegate = nil
            connection.close()
            logger.log(
                "[VmWebrtc] Peer connection closed",
                attributes: logAttributes(
                    for: .debug,
                    metadata: [
                        "signalingState": connection.signalingState.rawValue,
                        "iceState": stringValue(for: connection.iceConnectionState),
                    ])
            )
        }
        peerConnection = nil

        hasSentInitialSessionConfig = false

        stopMonitoringAudioRouteChanges()
        deactivateAudioSession()

        logger.log(
            "[VmWebrtc] WebRTC connection teardown completed",
            attributes: logAttributes(for: .info, metadata: ["hadPeerConnection": hadPeerConnection])
        )

        return "closed"
    }
}
