# Add GPT-Live 1 and make it the default voice model

Date: 2026-09-18. Status: Live integration implemented; real-iPhone acceptance and the final default-switch commit are pending.

**Decided:** backend `gpt-5.6-terra` · default Live voice `meridian` (session creation verified) · one PR.

Reviewed against the original proposal in [gpt_live_1_default_plan_original.md](gpt_live_1_default_plan_original.md). This version keeps its correct core and cuts the parts that are more ceremony than this app needs.

## Why this isn't a one-line model swap

`gpt-live-1` only works on the Live endpoint. Its docs list Realtime and every other endpoint as unsupported. Everything the app sends today is Realtime-shaped:

| | Realtime (today) | Live |
|---|---|---|
| Session create | `POST /v1/realtime/calls`, multipart SDP + session configuration | `POST /v1/live/sessions`, JSON `{ session, transport: { type: "webrtc", sdp } }`, JSON answer with `transport.sdp` |
| Ready signal | data channel open | wait for `session.started` |
| Tools | model calls functions directly, results via `conversation.item.create` + `response.create` | a backend model (Responses delegation) picks tools; calls arrive wrapped in `response.event`, results go back via `response.item.create` + `response.create` |
| Instructions | one prompt | voice prompt (`session.instructions`) + backend prompt (`delegation.responses.instructions`) |
| Turn-taking | VAD settings, `response.create` | full duplex; model decides when to speak; no VAD settings |
| Greeting | `response.create` | `session.instructions.append` with `delegation_id: null` after `session.started` |
| Mid-session updates | `session.update` for most fields | only `delegation.responses` can change; instructions/voice/audio are fixed at start |
| Transcripts | `conversation.item.input_audio_transcription.*`, `response.output_audio_transcript.*` | `session.input_transcript.delta`, `session.output_transcript.delta` |
| Context | app deletes/compacts items | Live compacts itself at 90% of 128k |
| Cost | per-token audio/text | $0.05/min voice billed per second (`session.usage.updated`, final in `session.closed`) + backend tokens |
| Close | tear down peer connection | send `session.close`, wait for `session.closed` |
| Voices | `cedar` (app default), `marin`, `alloy`, ... | the app's Live picker uses the sessions guide's 12 additional voices, with `meridian` as the app default |

Sources: [model page](https://developers.openai.com/api/docs/models/gpt-live-1), [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live), [migration](https://developers.openai.com/api/docs/guides/live-migration), [delegation](https://developers.openai.com/api/docs/guides/live-delegation), [sessions](https://developers.openai.com/api/docs/guides/live-conversations), [cost](https://developers.openai.com/api/docs/guides/voice-latency-cost?api=live).

## Review of the original plan

**Correct, and kept:**
- Needs a real Live integration, not a model string change.
- Responses delegation with `gpt-5.6-terra` as the backend. The docs recommend it, and Luna is the cheaper alternative.
- Split prompts. Keep the Realtime path intact. Leave translation and text chat alone.
- Don't auto-migrate users who explicitly picked a model.

**Wrong or unverified:**
- **Voice catalog:** the sessions guide lists additional Live voices; the full API schema also includes shared voices such as `marin` and `cedar`. The app's Live picker uses the 12 additional voices by product choice. A controlled API test rejected `arbor` with HTTP 403 and accepted `meridian` with HTTP 201 using the same key and offer.
- **Mute** doesn't need new work beyond an optional nicety. Muting the local audio track already works. Live also has `session.input_audio.mute` if we want server-side confirmation.

**Too much for this app:**
- A native Swift test target or harness. None exists today, and building one is its own project.
- Fixture tests for duplicate tool events, stale callbacks after a model switch, and fake-clock cost reconciliation.
- A separate Live endpoint-override setting and a 503 retry-loop audit. Neither is needed to ship.
- A separate Live usage tracker class. A small branch in the existing tracker is enough.

## Step 2: do we really need a new Live client?

Yes, but a small one. Session creation, the ready signal, event names, tools and close all differ, so the Realtime client can't just point at a new URL. There's already a precedent: `OpenAIWebRTCTranslatorClient` is a ~240-line subclass of `OpenAIWebRTCBase` for the translation API. `OpenAILiveWebRTCClient` follows the same pattern and reuses the shared audio, ICE and data channel code as-is.

What we skip from the original step 2: the separate endpoint override, reviewing the 503 retry loop, and remote-session cleanup beyond sending `session.close`.

## Plan

### 1. Model preference (`lib/realtimeModelPreference.ts`)
- Add `"gpt-live-1"` to `RealtimeModel`, `isRealtimeModel`, and the options list, with the title "GPT-Live 1". The default flip happens in step 6.
- Add `isLiveModel(model)` so the rest of the code branches on one helper.
- Keep the storage key. Users with nothing saved get the default. Users with a saved pick keep it.

### 2. iOS Live client (`modules/vm-webrtc/ios/OpenAILiveWebRTCClient.swift`, new)
- Subclass `OpenAIWebRTCBase`, like the translator client.
- Add `exchangeSDPWithLive(...)` next to `exchangeSDPWithOpenAI` in `WebRtcClientHelpers.swift`. It POSTs the JSON body and returns `(sessionId, answerSDP)`. It uses the user's API key from the device, same as Realtime today.
- Body: `session.model`, `session.instructions` (voice prompt), `session.audio.output.voice`, and `session.delegation = { type: "responses", responses: { model: "gpt-5.6-terra", instructions: <backend prompt>, tools: <existing toolkit function defs>, tool_choice: "auto" } }`. Model the backend name as one constant.
- Report connected only after `session.started`, then send the greeting via `session.instructions.append`.
- `closeConnection()` sends `session.close`, waits up to ~2s for `session.closed`, then tears down.
- `VmWebrtcModule.swift` picks the Live or Realtime client based on the model passed from JS. Tool delegates and `ToolkitHelper` get wired the same way for both.

### 3. Tools
- In the Live client's data channel handler, unwrap `response.event`. On an inner `response.output_item.done` with `type: "function_call"`, dispatch to the existing tool execution path (the same `ToolkitHelper` / connector delegates Realtime uses), keyed by `call_id`.
- Send results as `response.item.create` (`function_call_output`). Once all calls from that backend response have results, send one `response.create` to continue.
- Keep `parallel_tool_calls` off at first so execution is sequential.
- The existing GPT-5 web search tool keeps working as a function. Swapping it for Live's hosted `web_search` is a possible follow-up, not part of this change.

### 4. Prompts and settings (JS, `app/VoiceChat.tsx` and `lib/`)
- Voice prompt: language, persona and speaking style from the existing prompt settings, plus "delegate tasks and tool use".
- Backend prompt: the existing detailed tool instructions and custom prompt addition.
- When a Live model is selected:
  - The voice picker shows the Live voice list (see *Voices per model* below).
  - VAD, transcription model, voice speed and context-window settings are hidden or shown as "not used with GPT-Live".
  - Skip Realtime-only code paths (compaction, conversation item deletion, `session.update` for instructions).

### Voices per model
The voice list depends on the selected model.

- `lib/voiceOptions.ts` holds `REALTIME_VOICES`, `LIVE_VOICES`, and `getVoiceOptions(model)`. Keeping these outside the component lets preferences validate the same lists without importing UI code. `ConfigureVoice` takes the selected model and renders its list.
- **Save a voice per model family** so switching models never overwrites your other choice:
  - `@vibemachine/voicePreference` stays as the Realtime voice (default `cedar`).
  - New `@vibemachine/liveVoicePreference` for the Live voice (default `meridian`).
  - `loadVoicePreference(model)` / `saveVoicePreference(model, voice)` choose the key.
- If a saved value isn't in the current family's list, fall back to that family's default. Persist the replacement for invalid Live selections, including saved Arbor, without changing the Realtime preference.
- **Live default `meridian`.** Authenticated session creation succeeded with Meridian. Arbor reproduced the app's HTTP 403 "Voice session access denied" error and has been removed from the picker.
- `LIVE_VOICES` (the 12 additional voices from the guide's table):

| Voice | Accent | Presentation |
|---|---|---|
| quartz | Australian | Feminine |
| ripple | Australian | Masculine |
| vesper | British | Masculine |
| willow | Irish | Feminine |
| stone | Irish | Masculine |
| gleam | North American | Feminine |
| meridian | North American | Masculine |
| bossa | Brazilian Portuguese | Feminine |
| tempo | Brazilian Portuguese | Masculine |
| beacon | Filipino | Masculine |
| delta | Southern U.S. | Feminine |
| cinder | Southern U.S. | Masculine |

### Greeting (the assistant speaks first)

**Today (Realtime),** `OpenAIWebRTCClient.handleDataChannelOpenAfterInitialSessionSetup()`, about 300 ms after the data channel opens, sends:
```json
{ "type": "response.create" }
```
The model then greets according to the main prompt, which starts with "Greet the user in English with a friendly tone." (`lib/mainPrompt.ts:11`).

**Live has no `response.create` for speech.** The migration guide says to stream audio continuously and let GPT-Live decide when to speak. To have it speak first, the sessions guide says: after `session.started`, send one `session.instructions.append` with `delegation_id: null`. It should say what to greet with and in which language, and tell the model to greet right away without waiting, then pause and listen.

Doc example, from the sessions guide:
```json
{
  "type": "session.instructions.append",
  "event_id": "greeting_1",
  "delegation_id": null,
  "content": "Greet the caller in English immediately without waiting. Pause and listen for their response."
}
```
Server acknowledgement:
```json
{
  "type": "session.instructions.appended",
  "event_id": "event_id_from_server",
  "client_event_id": "greeting_1"
}
```
- `delegation_id: null` means the instruction applies to the conversation as a whole, not to a particular backend task.
- The guide's caveats: send it only after `session.started`; it requests a greeting but doesn't guarantee the exact wording; if the caller speaks first, the greeting can be cut off; there is no "greeting finished" event.
- The same event is also the general way to steer the conversation mid-session. We only use it for the greeting.

**What we'd implement** in `OpenAILiveWebRTCClient`:
1. On `session.started`, and only once per session (a `hasSentGreeting` flag, like today's `hasSentInitialSessionConfig`), send:
   ```json
   {
     "type": "session.instructions.append",
     "event_id": "greeting_<sessionId>",
     "delegation_id": null,
     "content": "Greet the user in <selected language> with a friendly tone, immediately, without waiting for them to speak. Then pause and listen."
   }
   ```
   `<selected language>` comes from the same language preference the main prompt uses. Keep "greet the user" out of the voice prompt itself, so the greeting comes from this event only and isn't repeated.
2. On `session.instructions.appended` with a matching `client_event_id`, log it. On an `error` whose `client_event_id` matches, log it and go on with the session; you just start talking yourself.
3. Keep the mic streaming the whole time. Don't mute while waiting for the greeting.

**Realtime models are unaffected.** `session.instructions.append` exists only in the Live API; a Realtime session would reply with an `error`. So each client keeps its own greeting:

| Model | Client | Greeting |
|---|---|---|
| GPT Realtime / 2 / 2.1 | `OpenAIWebRTCClient` (unchanged) | `response.create` ~300 ms after the data channel opens, as today |
| GPT-Live 1 | `OpenAILiveWebRTCClient` (new) | `session.instructions.append` after `session.started` |

The existing greeting code in `OpenAIWebRTCClient.handleDataChannelOpenAfterInitialSessionSetup()` is not touched.

**Why this is lower risk than it sounds:** it's the same shape as today. One event, sent once, right after the session is ready, and the model does the rest. The only differences are the event name and that the greeting text travels in the event instead of the prompt. The worst case is that it doesn't greet and waits for you to speak, and the session still works.

### 5. Cost display (`lib/tokenUsageTracker.ts`)
- For Live: voice cost = latest cumulative `usage.seconds` / 60 × $0.05. Replace the running value, don't add to it; use the final value from `session.closed`.
- Backend cost: add `usage` from the nested backend `response.completed` events at Terra's token prices. If the prices aren't known yet, label it "voice only".
- Stop falling back to Realtime-2 prices for unknown models.

### 6. Make it the default (same PR, last commit)
- Land it as the last commit, after the real-device check below passes. Set `DEFAULT_REALTIME_MODEL = "gpt-live-1"`, put the Live option first, and update the descriptions ("Default voice model").
- If Live fails to connect (for example, no account access), show the error with a "Switch to GPT Realtime 2" button. Don't switch silently.
- Native change, so it needs a new build through `bun run wizard` (EAS Build Prod). An OTA update isn't enough.
- One PR contains steps 1–6.

## Testing
- `bun test` for the preference helpers: default when nothing is saved, saved values kept, invalid values fall back.
- `bunx tsc --noEmit`, lint, and a simulator build (wizard "Run Xcodebuild").
- On a real iPhone:
  - first launch lands on Live
  - `meridian` connects and produces audio; a previously saved Arbor selection migrates to Meridian
  - voice picker shows the Live list on Live and the Realtime list on Realtime; switching models keeps each saved voice
  - greeting plays
  - two-way talk, including talking over the model
  - mute, speaker/handset
  - a GitHub or Drive tool round trip
  - cost shows seconds-based
  - hang up and reconnect
  - switch back to GPT Realtime 2 and confirm it still works
  - translation still works

## Decisions (resolved)
1. Backend model: **`gpt-5.6-terra`**, kept in one constant.
2. Rollout: **one PR**, with the default flipped in the last commit after device testing.
3. Live default voice: **`meridian`**. Remove Arbor and retain only the 12 additional Live voices in the Live picker.

## Implementation and validation record (2026-09-18)

- Wizard work committed separately as `a4d6ba5` before starting this implementation.
- Steps 1–5 implemented, including the explicit “Switch to GPT Realtime 2” connection-error action. **The shipped default is still GPT Realtime 2** until the phone acceptance gate passes.
- Live uses `/v1/live/sessions`, `session.audio.output.voice`, Responses delegation to the single native backend constant `gpt-5.6-terra`, and a two-second graceful-close wait.
- Incoming Live events, startup/close state, and tool-result processing run on the main queue. Each Live connection gets its own client and tool helpers. Existing Realtime greeting and translation protocol code are unchanged.
- Terra estimate uses published per-million-token rates of $2 input, $0.20 cached input, and $12 output, with the documented long-context multipliers. Live duration snapshots replace previous seconds. Unknown voice models have no pricing; unknown backend models explicitly display voice-only estimates. [Terra pricing](https://developers.openai.com/api/docs/models/gpt-5.6-terra).
- `bun test ./lib/__tests__/voicePreferences.test.ts ./lib/__tests__/tokenUsageTracker.test.ts`: **21 passed** (52 assertions), covering saved choices, family-specific voices, storage failures, duration reconciliation, backend cache accounting, unknown pricing, and Realtime regression.
- `bunx tsc --noEmit`: passed.
- ESLint on changed TypeScript/TSX files: no errors; four existing warnings in `app/index.tsx` and `VmWebrtcModule.ts`.
- Full `bun run lint`: blocked by six pre-existing errors in unchanged files (`OnboardingWizard`, `ConfigureChatMode`, `ConfigureTranslation`, `ConfigureVad`, `GithubConnectorConfig`, `ToolGroupList`).
- `pod install --no-repo-update` refreshed the local Pods project to include the new Swift source. `bun run wizard build-ios-local`: simulator build passed, including an incremental rebuild after final native changes.
- Subsequent phone testing reproduced HTTP 403 with Arbor. Controlled authenticated requests with the same API key and WebRTC offer returned HTTP 201 for the API default and Meridian, and HTTP 403 for Arbor. Both successful test sessions were immediately closed. Full Meridian audio, greeting, interruption, tool execution, and regression checks remain pending on the phone.

### Remaining phone acceptance and final commit

1. Install a native build containing these changes, for example with `bun run wizard eas-build-dev-local` and the wizard's Expo Orbit instructions. An OTA update alone cannot add the native Live client.
2. In **Advanced Configuration → Choose Model**, select **GPT-Live 1**. Confirm the Live voice is **Meridian** (including migration from a previously saved Arbor selection), then start a session.
3. Complete the phone checks listed above, including a GitHub or Drive tool round trip and final usage after hangup. Record the result before changing the default.
4. In the last commit, set `DEFAULT_REALTIME_MODEL` to `gpt-live-1`, update the model descriptions, rerun preference tests, and verify a fresh installation selects Live while existing saved models remain selected.
5. Keep the feature and default-switch commits in the same PR.
