# Add GPT-Live 1 and make it the default voice model

Date: 2026-09-18. Status: proposed for review; no application changes made.

The confirmed target is **GPT-Live 1 (`gpt-live-1`)**. Adding it requires a Live API integration: this app currently uses Realtime session creation, events, and token accounting. A model-string change alone would send an incompatible request.

**Verified documentation**

| Topic | Current official guidance |
| --- | --- |
| Model | `gpt-live-1` handles simultaneous listening and speaking. Voice costs $0.05/minute, billed per second; backend usage is separate. [Model documentation](https://developers.openai.com/api/docs/models/gpt-live-1) |
| Connection | Create a session with JSON at `POST /v1/live/sessions`, passing `session` and `transport: { type: "webrtc", sdp }`. Read the JSON answer and wait for `session.started`. [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live) |
| Migration | Split voice instructions from reasoning/tool instructions. Realtime's startup `response.create` does not serve as Live's speech trigger. [Migration guide](https://developers.openai.com/api/docs/guides/live-migration) |
| Tools | Responses delegation wraps backend events inside `response.event`; function results use `response.item.create`, followed by backend continuation. [Delegation guide](https://developers.openai.com/api/docs/guides/live-delegation) |
| Lifecycle | Live has its own transcript events, cumulative duration updates, and graceful session closure. [Session guide](https://developers.openai.com/api/docs/guides/live-conversations) |
| Accounting | WebRTC initialization bills 15 seconds, credited against running-session duration. Do not add 15 seconds again to a running session. [Cost guide](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live) |

The catalog also lists GPT-Realtime 2.1 Mini and GPT-Live-Transcribe. This proposal adds the requested conversational model; it does not expand the picker to unrelated transcription models. [Model catalog](https://developers.openai.com/api/docs/models)

**Proposed product decisions**

- Put “GPT-Live 1” first in Choose Model and identify it as the default. Keep the existing Realtime options selectable.
- Use Live when there is no valid saved model preference. Preserve explicit saved selections, including GPT-Realtime 2. This means existing users who selected a model keep it until they choose Live; a forced migration is a separate product choice.
- Use **Responses delegation**, initially with `gpt-5.6-terra`, the backend used in the official Live quickstart. This is a proposed implementation choice, not a model mandated by the API. Keep it in one named constant, with no extra settings screen for this change.
- Keep iOS as the implementation target. Translation keeps its dedicated model and session path. Text chat keeps its current model.
- Make Live the shipped default only after connection, tools, accounting, and device acceptance pass together. An access error should offer an explicit switch to an existing model rather than silently changing the chosen model.

**Current code and impact**

| Surface | Current behavior | Planned change |
| --- | --- | --- |
| [Model preferences](/Users/tleyden/Development/arty/lib/realtimeModelPreference.ts) | Three allowed models; default is `gpt-realtime-2` | Add Live, update validation/default/copy, retain the storage key |
| [Model picker](/Users/tleyden/Development/arty/components/settings/ConfigureRealtimeModel.tsx) | Renders the shared options | Reuse the existing small component and selection behavior |
| [App entry](/Users/tleyden/Development/arty/app/index.tsx) and [voice screen](/Users/tleyden/Development/arty/app/VoiceChat.tsx) | Hydrate selection and pass common options into native code | Resolve model capabilities, prompts, endpoint overrides, and usage display |
| [Native module](/Users/tleyden/Development/arty/modules/vm-webrtc/ios/VmWebrtcModule.swift) | Owns one `OpenAIWebRTCClient`; tool responders are bound to it | Route to the correct client and keep callbacks bound to their originating session |
| [Realtime client](/Users/tleyden/Development/arty/modules/vm-webrtc/ios/OpenAIWebRTCClient.swift) | Multipart `/v1/realtime/calls`, Realtime session fields and startup response | Preserve its Realtime role; add a separate Live client |
| [WebRTC core](/Users/tleyden/Development/arty/modules/vm-webrtc/ios/OpenAIWebRTCCore.swift) and [helpers](/Users/tleyden/Development/arty/modules/vm-webrtc/ios/WebRtcClientHelpers.swift) | Shared audio, ICE, SDP and transport support | Reuse media support and add Live JSON exchange/endpoint diagnostics |
| [Tool bridge](/Users/tleyden/Development/arty/modules/vm-webrtc/ios/ToolkitHelper.swift) and [event handler](/Users/tleyden/Development/arty/modules/vm-webrtc/ios/WebRTCEventHandler.swift) | Realtime function and conversation events | Reuse execution through a Live-specific adapter, not the Realtime response state machine |
| [Cost tracker](/Users/tleyden/Development/arty/lib/tokenUsageTracker.ts) | Claims pricing exists for every model; unknown models use Realtime 2 rates | Route Live to duration/backend accounting and remove misleading unknown-model fallback |

**Implementation sequence**

1. **Define model capabilities and preference behavior.** Add an API-family discriminator and narrowly scoped capability metadata beside the existing registry. Preserve the current storage key and saved options. Wait for preference hydration before starting a session so a stored Realtime choice cannot briefly launch Live. Resolve an omitted native model through the model router; do not change the Realtime-only client's fallback to a Live model.

2. **Add the iOS Live connection.** Introduce a focused `OpenAILiveWebRTCClient` using the shared media base and a small Live configuration builder. Post JSON to the Live endpoint, retain the session ID, validate `transport.sdp`, and report readiness only after both transport connection and `session.started`. Use the existing user-supplied API-key flow. Keep the Realtime endpoint override from being accidentally reused as a Live endpoint; add a separate Live override only if needed. Clean up partial connections and remote sessions on failure. Review the existing 503 retry loop so retries do not leak or duplicate billable sessions.

3. **Adapt tools and prompts.** Build a short Live conversation prompt for language, speaking style, and delegation. Put the existing detailed tool instructions and custom prompt addition in the backend prompt; preserve user-facing language/style requirements in the voice prompt too. Keep current toolkit/MCP execution. Add a Live event adapter that collects complete function items, retains delegation/response/call IDs, executes each call once, sends every result or error, and then continues the backend. Start with sequential tool calls. Bind responses to the session that created them, and ignore late callbacks after teardown or model switches. Speech interruption must not automatically cancel an already-running tool action.

4. **Adapt session controls and settings.** Add independent Live transcript and backend-progress handling; use audio activity for speaking state and idle monitoring. Close via `session.close`, drain `session.closed` with a bounded timeout, then release audio/transport resources. Keep session state serialized on the main actor or a dedicated serial queue. Check the Live schema for supported voices and settings before writing requests. Use `marin` as the documented Live fallback if a saved voice is unsupported, preserving the saved Realtime voice. Omit unsupported Realtime VAD, transcription configuration, truncation, and compaction fields; explain unavailable controls in the UI. Treat voice speed as unsupported until verified. Live manages its own context, so do not run Realtime conversation-item deletion against it.

5. **Implement accurate usage reporting.** Add a separate Live usage tracker, fed by native duration and delegated usage events. Replace cumulative duration snapshots rather than summing them; deduplicate backend completion usage. Calculate voice cost as `seconds / 60 * 0.05`, plus separately priced backend usage. Respect the initialization credit. Reconcile final duration on close; mark estimates incomplete when final usage or tool pricing is unavailable. Never display an apparently complete $0 cost or apply Realtime token rates to Live. Log model, API family, session/delegation IDs, lifecycle, and usage through the existing `vibemachine` telemetry, without credentials.

6. **Enable the default and document behavior.** Set the shared default to `gpt-live-1`, put its option first, remove the old model's default wording, and update the README. Ensure selecting an older model restores its own connection, settings, prompts, and accounting. Native Swift changes require a rebuilt iOS app; a JavaScript-only update is insufficient.

**Validation and acceptance**

- Add deterministic preference tests for missing, invalid, unreadable, and every valid stored value; verify explicit selection survives restart and hydration completes before Connect.
- Use fixture-based request/event tests for Live versus Realtime routing, correct JSON and SDP handling, readiness, malformed responses, startup failure cleanup, graceful close, and timeout cleanup. Test the actual Swift adapter through a focused native test target/harness if none exists; TypeScript fixture tests alone cannot validate native dispatch.
- Exercise tool events with duplicate delivery, empty terminal output snapshots, failed tools, interruption during execution, all-results-before-continuation, and stale callbacks after switching sessions.
- Test duration snapshots, repeated completion events, final usage reconciliation, unknown pricing, and initialization credit with a fake clock and fixed fixtures. Automated tests must make no paid model calls.
- Run targeted Bun tests, `bunx tsc --noEmit`, lint, and an iOS Simulator build using the existing build workflow's command. Review changes to shared media code against translation.
- Manually test a real iPhone: first launch default, saved older choice, model switch/restart, startup greeting, two-way audio, overlapping speech/interruption, mute, speaker/handset routing, selected language, a real toolkit/MCP round trip, cost display, and hangup/reconnect. Smoke-test an existing Realtime option and translation.
- Confirm account access and successful Live/backend startup during manual acceptance. Documentation availability does not verify this account's access; no authenticated API calls were made while preparing this plan.

**Review choices**

The user confirmed GPT-Live 1 as the target. The proposed reasoning backend is GPT-5.6 Terra, and the proposed preference policy preserves explicit saved selections. These two proposed choices remain reviewable independently.

Only this plan is being added now. Implementation starts after review.
