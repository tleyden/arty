import ExpoModulesCore
import Foundation

struct OpenAIConnectionOptions: Record {
    @Field
    var apiKey: String

    @Field
    var model: String?

    @Field
    var baseUrl: String?

    @Field
    var audioOutput: String?

    @Field
    var muted: Bool?

    @Field
    var instructions: String

    @Field
    var voice: String?

    @Field
    var backendInstructions: String?

    @Field
    var greetingLanguage: String?

    @Field
    var toolDefinitions: [[String: Any]]?

    @Field
    var vadMode: String?

    @Field
    var audioSpeed: Double?

    @Field
    var maxConversationTurns: Int?

    @Field
    var retentionRatio: Double?

    @Field
    var disableCompaction: Bool?

    @Field
    var transcriptionEnabled: Bool?
}

public class VmWebrtcModule: Module {
    private lazy var webrtcClient = OpenAIWebRTCClient()
    private var liveClient: OpenAILiveWebRTCClient?
    private var toolGithubConnector: ToolGithubConnector?
    // Add GDrive connector tool instance
    private var toolGDriveConnector: ToolGDriveConnector?
    private var toolGPT5GDriveFixer: ToolGPT5GDriveFixer?
    private var toolGPT5WebSearch: ToolGPT5WebSearch?
    // Add Gen2 toolkit helper
    private var toolkitHelper: ToolkitHelper?
    private let logfireTracingManager = LogfireTracingManager()
    private var logger: NativeLogger { VmWebrtcLogging.logger }

    private func configureTools(responder: ToolCallResponder, live: OpenAILiveWebRTCClient? = nil) {
        toolGithubConnector = ToolGithubConnector(module: self, responder: responder)
        toolGDriveConnector = ToolGDriveConnector(module: self, responder: responder)
        toolGPT5GDriveFixer = ToolGPT5GDriveFixer(module: self, responder: responder)
        toolGPT5WebSearch = ToolGPT5WebSearch(module: self, responder: responder)
        toolkitHelper = ToolkitHelper(module: self, responder: responder)
        if let live {
            live.toolDelegates = [
                "github_connector": toolGithubConnector!, "gdrive_connector": toolGDriveConnector!,
                "GPT5-gdrive-fixer": toolGPT5GDriveFixer!, "GPT5-web-search": toolGPT5WebSearch!,
            ]
            live.toolkitHelper = toolkitHelper
        } else {
            webrtcClient.setGithubConnectorDelegate(toolGithubConnector!)
            webrtcClient.setGDriveConnectorDelegate(toolGDriveConnector!)
            webrtcClient.setGPT5GDriveFixerDelegate(toolGPT5GDriveFixer!)
            webrtcClient.setGPT5WebSearchDelegate(toolGPT5WebSearch!)
            webrtcClient.setToolkitHelper(toolkitHelper!)
        }
    }

    @MainActor
    private func openVoiceConnection(_ options: OpenAIConnectionOptions) async throws -> String {
        if let liveClient { _ = await liveClient.closeGracefully() }
        liveClient = nil
        if webrtcClient.peerConnection != nil { _ = webrtcClient.closeConnection() }
        if options.model == "gpt-live-1" {
            let client = OpenAILiveWebRTCClient()
            client.setEventEmitter { [weak self] name, payload in self?.sendEvent(name, payload) }
            client.setAPIKey(options.apiKey)
            client.setOutgoingAudioMuted(options.muted ?? false)
            liveClient = client
            configureTools(responder: client, live: client)
            return try await client.openConnection(options: options)
        }
        configureTools(responder: webrtcClient)
        webrtcClient.setToolDefinitions(options.toolDefinitions ?? [])
        webrtcClient.setAPIKey(options.apiKey)
        webrtcClient.setOutgoingAudioMuted(options.muted ?? false)
        return try await webrtcClient.openConnection(
            model: options.model, baseURL: options.baseUrl,
            audioOutput: AudioOutputPreference(rawValue: options.audioOutput ?? "handset") ?? .handset,
            instructions: options.instructions, voice: options.voice, vadMode: options.vadMode,
            audioSpeed: options.audioSpeed, maxConversationTurns: options.maxConversationTurns,
            retentionRatio: options.retentionRatio, disableCompaction: options.disableCompaction,
            transcriptionEnabled: options.transcriptionEnabled ?? false
        )
    }

    public func helloFromExpoModule() -> String {
        return "Hello world from module"
    }

    // Each module class must implement the definition function. The definition consists of components
    // that describes the module's functionality and behavior.
    // See https://docs.expo.dev/modules/module-api for more details about available components.
    public func definition() -> ModuleDefinition {
        // Sets the name of the module that JavaScript code will use to refer to the module. Takes a string as an argument.
        // Can be inferred from module's class name, but it's recommended to set it explicitly for clarity.
        // The module will be accessible from `requireNativeModule('VmWebrtc')` in JavaScript.
        Name("VmWebrtc")

        // Defines constant property on the module.
        Constant("PI") {
            Double.pi
        }

        // Defines event names that the module can send to JavaScript.
        Events(
            "onChange",
            "onGithubConnectorRequest",
            "onGithubConnectorResponse",
            // Add GDrive events
            "onGDriveConnectorRequest",
            "onGDriveConnectorResponse",
            "onGPT5GDriveFixerRequest",
            "onGPT5GDriveFixerResponse",
            "onGPT5WebSearchRequest",
            "onGPT5WebSearchResponse",
            // Add Gen2 toolkit events
            "onToolkitRequest",
            "onToolkitResponse",
            "onIdleTimeout",
            "onTokenUsage",
            "onRealtimeError",
            "onAudioMetrics",
            "onVoiceSessionStatus",
            "onVoiceSessionClosed",
            "onTranscript",
            "onOutboundAudioStats"
        )

        // Initialize native tool delegates used by the module
        OnCreate {
            VmWebrtcLogging.configureTracingManager(self.logfireTracingManager)
            self.logger.log("OnCreate: initializing tool delegates")
            self.webrtcClient.setEventEmitter { [weak self] eventName, payload in
                guard let self else { return }
                self.sendEvent(eventName, payload)
            }
            self.logger.log("Event emitter configured for OpenAI WebRTC client")
            self.configureTools(responder: self.webrtcClient)

        }

        // Defines a JavaScript synchronous function that runs the native code on the JavaScript thread.
        Function("hello") {
            return "Hello world! 👋"
        }

        Function("helloFromExpoModule") { () -> String in
            return self.helloFromExpoModule()
        }

        // Defines a JavaScript function that always returns a Promise and whose native code
        // is by default dispatched on the different thread than the JavaScript runtime runs on.
        AsyncFunction("setValueAsync") { (value: String) in
            // Send an event to JavaScript.
            self.sendEvent(
                "onChange",
                [
                    "value": value
                ])
        }

        AsyncFunction("openOpenAIConnectionAsync") { (options: OpenAIConnectionOptions) -> String in
            self.logger.log(
                "openOpenAIConnectionAsync called",
                attributes: [
                    "model": options.model ?? "nil",
                    "baseUrl": options.baseUrl ?? "nil",
                    "audioOutput": options.audioOutput ?? "nil",
                    "voice": options.voice ?? "nil",
                    "vadMode": options.vadMode ?? "nil",
                    "toolDefinitionCount": options.toolDefinitions?.count ?? 0,
                    "transcriptionEnabled": options.transcriptionEnabled ?? false,
                ])
            let sanitizedInstructions = options.instructions
                .trimmingCharacters(in: .whitespacesAndNewlines)

            guard !sanitizedInstructions.isEmpty else {
                throw NSError(
                    domain: "VmWebrtc",
                    code: 1001,
                    userInfo: [
                        NSLocalizedDescriptionKey: "instructions must be a non-empty string."
                    ]
                )
            }

            return try await self.openVoiceConnection(options)
        }

        AsyncFunction("closeOpenAIConnectionAsync") { () -> String in
            if let client = await MainActor.run(body: { self.liveClient }) {
                return await client.closeGracefully()
            }
            return await MainActor.run { self.webrtcClient.closeConnection() }
        }

        AsyncFunction("initializeLogfireTracing") { (serviceName: String, apiKey: String) in
            try await self.logfireTracingManager.initialize(
                serviceName: serviceName, apiKey: apiKey)
        }

        Function("logfireEvent") {
            (tracerName: String, spanName: String, attributes: [String: Any]?) in
            let resolvedSeverity = LogfireTracingManager.severity(from: attributes) ?? .info
            print(
                "[VmWebrtcModule] logfireEvent span=\(spanName) severityText=\(resolvedSeverity.severityText) severityNumber=\(resolvedSeverity.severityNumber)"
            )
            self.logfireTracingManager.recordEvent(
                tracerName: tracerName,
                spanName: spanName,
                attributes: attributes,
                severity: resolvedSeverity,
                severityText: resolvedSeverity.severityText,
                severityNumber: resolvedSeverity.severityNumber
            )
        }

        // JavaScript calls this to send github connector result back
        Function("sendGithubConnectorResponse") { (requestId: String, result: String) in
            self.logger.log(
                "JS→Native sendGithubConnectorResponse",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                ])
            Task { @MainActor in
                self.toolGithubConnector?.handleResponse(requestId: requestId, result: result)
            }
        }

        // Add: JavaScript calls this to send GDrive connector result back
        Function("sendGDriveConnectorResponse") { (requestId: String, result: String) in
            self.logger.log(
                "JS→Native sendGDriveConnectorResponse",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                    "result_preview": String(result.prefix(1000)),
                ])
            Task { @MainActor in
                self.toolGDriveConnector?.handleResponse(requestId: requestId, result: result)
            }
        }

        Function("sendGPT5GDriveFixerResponse") { (requestId: String, result: String) in
            self.logger.log(
                "JS→Native sendGPT5GDriveFixerResponse",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                ])
            Task { @MainActor in
                self.toolGPT5GDriveFixer?.handleResponse(requestId: requestId, result: result)
            }
        }

        Function("sendGPT5WebSearchResponse") { (requestId: String, result: String) in
            self.logger.log(
                "JS→Native sendGPT5WebSearchResponse",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                ])
            Task { @MainActor in
                self.toolGPT5WebSearch?.handleResponse(requestId: requestId, result: result)
            }
        }

        Function("sendToolkitResponse") { (requestId: String, result: String) in
            self.logger.log(
                "JS→Native sendToolkitResponse",
                attributes: [
                    "requestId": requestId,
                    "result_length": result.count,
                    "result": result,
                ])
            Task { @MainActor in
                self.toolkitHelper?.handleResponse(requestId: requestId, result: result)
            }
        }

        // Github Connector function - calls JavaScript github connector via events
        AsyncFunction("githubOperationFromSwift") { (codeSnippet: String, promise: Promise) in
            self.logger.log(
                "Swift→JS githubOperationFromSwift",
                attributes: [
                    "snippet_length": codeSnippet.count
                ])
            self.toolGithubConnector?.githubOperationFromSwift(
                codeSnippet: codeSnippet, promise: promise)
        }

        // GDrive bridge: call JS GDrive connector via events for Swift testing
        AsyncFunction("gdriveOperationFromSwift") { (codeSnippet: String, promise: Promise) in
            self.toolGDriveConnector?.gdriveOperationFromSwift(
                codeSnippet: codeSnippet, promise: promise)
        }

        AsyncFunction("gpt5GDriveFixerOperationFromSwift") {
            (paramsJson: String, promise: Promise) in
            self.toolGPT5GDriveFixer?.gpt5GDriveFixerOperationFromSwift(
                paramsJson: paramsJson, promise: promise)
        }

        AsyncFunction("gpt5WebSearchOperationFromSwift") { (query: String, promise: Promise) in
            self.toolGPT5WebSearch?.gpt5WebSearchOperationFromSwift(query: query, promise: promise)
        }

        Function("muteUnmuteOutgoingAudio") { (shouldMute: Bool) in
            Task { @MainActor in
                let client: OpenAIWebRTCBase = self.liveClient ?? self.webrtcClient
                client.setOutgoingAudioMuted(shouldMute)
            }
        }

        Function("emitVoiceSessionStatus") { (statusUpdate: String) in
            self.sendEvent(
                "onVoiceSessionStatus",
                [
                    "status_update": statusUpdate
                ])
        }

    }
}
