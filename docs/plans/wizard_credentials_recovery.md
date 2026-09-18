# Wizard: refresh expired iOS credentials + dev build install hint

Implemented on 2026-09-18 in `wizard.ts`, with deterministic subprocess tests in `scripts/__tests__/wizard.test.ts`. GPT-Live implementation remains deferred.

## Problem

`bun run wizard eas-build-prod` fails when the provisioning profile (and/or distribution certificate) expires:

```
Provisioning Profile has expired.
Failed to set up credentials.
In order to configure your Provisioning Profile, authentication with an ASC API key is required in non-interactive mode.
    Error: build command failed.
```

## Desired UX

```
❌ Your iOS signing credentials have expired.
? Do you want to refresh them now? (y/N)
```

- **n** → wizard exits with the original failure, same as today.
- **y** → wizard walks you through the refresh, then continues the build.

## What "refresh" runs

Re-run the same build **without `--non-interactive`**:

```
bunx eas build --platform ios --profile production
```

In interactive mode, eas-cli handles the refresh itself with simple yes/no prompts — log in to Apple, generate a new distribution certificate if needed, generate a new provisioning profile — and then carries on with the build. No `eas credentials` menus to navigate.

(Considered: launching `bunx eas credentials -p ios`. Rejected — it drops you into multi-level menus where you have to know to pick *Build Credentials → All*, and you still have to rerun the build afterwards.)

## Changes (all in `wizard.ts`)

### 1. Let `executeCommand` see the output

Today it spawns with `stdout/stderr: "inherit"`, so the wizard can't tell this error from any other exit code 1.

Add an optional `{ captureOutput: true }` mode:
- spawn with `stdout/stderr: "pipe"`, `stdin: "inherit"`
- forward every chunk to the terminal immediately (you still see output live)
- keep only the last ~64 KB in memory to check afterwards
- set `FORCE_COLOR=1` so eas-cli keeps its colors

Existing callers are unchanged.

### 2. Detect the error

```ts
function isExpiredIosCredentialsError(output: string): boolean
```

After stripping ANSI color codes, true if the output contains `Provisioning Profile has expired`, or contains both `Failed to set up credentials` and `ASC API key is required in non-interactive mode`. Deliberately narrow so normal build failures don't trigger the prompt.

### 3. Prompt-and-retry wrapper

```ts
async function runEasBuild(profile: string, extraFlags: string[] = []): Promise<number>
```

1. Run `bunx eas build --platform ios --profile <profile> --non-interactive <extraFlags>` with output capture.
2. If it succeeded, or failed for another reason → return the exit code.
3. If it failed with the expired-credentials error → ask **"Do you want to refresh them now? (y/N)"**.
   - **n** → return the original exit code.
   - **y** → run the same command without `--non-interactive` (plain `executeCommand`, fully interactive) and return its exit code. Only one retry.

### 4. Use it in the build options

| Option | Change |
|---|---|
| EAS Build Prod | New handler `easBuildProd`: `runEasBuild("production")`, then `eas submit --platform ios` only if the build succeeded (replaces the `build && submit` shell string) |
| EAS Build Prod Local | `easBuildProdLocal` calls `runEasBuild("production", "--local")` |
| EAS Build Dev / Dev Local | New handlers calling `runEasBuild("dev_self_contained")` / `runEasBuild("dev_self_contained", "--local")` — internal builds use ad hoc profiles that expire the same way |

### 5. After a dev build succeeds, show how to install it (Expo Orbit)

`dev_self_contained` uses internal (ad hoc) distribution, so the build only installs on devices whose UDID is registered in the profile. Expo Orbit (already installed in `/Applications`) can install ad hoc signed apps on a connected iPhone. Its docs say it supports "any Android .apk, iOS Simulator compatible .app, or ad hoc signed apps", via Finder or by dragging onto the menu bar icon.

**EAS Build Dev Local** (`eas-build-dev-local`): the build writes `build-<timestamp>.ipa` to the project root. After a successful build:
1. Find the newest IPA modified since this build started with `findMostRecentIpa(startedAt)` and print its path, size and time. If none exists, show the artifact-path guidance without offering an older IPA.
2. Print:
   ```
   📲 Install on your iPhone with Expo Orbit:
      1. Plug in the iPhone (USB) and unlock it. Developer Mode must be on
         (Settings → Privacy & Security → Developer Mode).
      2. Pick the device in the Orbit menu bar app.
      3. Drag the .ipa onto the Orbit menu bar icon (or Orbit → "Select build from local file").
      Not installing? The device may not be registered: run `bun run wizard register-device`,
      then rebuild so the new UDID is included in the profile.
   ```
3. Ask `Open it in Expo Orbit now? (Y/n)`. On **y**, run `open -a "Expo Orbit" "<ipa path>"`. If Orbit doesn't take the file that way (check during implementation), fall back to `open -R "<ipa path>"`, which reveals the file in Finder so you can drag it.

**EAS Build Dev** (cloud, `eas-build-dev`): print that the build is on the EAS build page (the link eas-cli prints at the end), and that its **Open with Orbit** button installs it on the connected iPhone.

## Good to know

- The failed attempt has already bumped the production build number (e.g. 31 → 32), so the retry uses the next one (→ 33). App Store Connect doesn't care about gaps.
- Expect to see this prompt about once a year, when Apple's certificate and profile expire.

## Testing

1. Passed `bun test ./scripts/__tests__/wizard.test.ts`: 23 tests covering all four build options, ANSI/wrapped error detection, live output forwarding and the 64 KiB capture limit, decline/EOF, one interactive retry, failed retries, submission ordering, and Ctrl-C (including a child that exits zero after interruption).
2. The same tests replace EAS and `open` with fake executables and verify cloud Orbit guidance, fresh local artifact selection, literal paths containing shell characters, yes/no/default/EOF answers, Orbit failure, and Finder failure. No real build or submission runs in the tests.
3. Passed `bunx tsc --noEmit`, wizard menu/exit smoke test, and `git diff --check`. Targeted ESLint reports no errors and one existing unused-variable warning in the header-patching code.
4. Verified installed Expo Orbit 2.5.0 registers `.ipa` documents and has native file-open handlers. [Expo documentation](https://docs.expo.dev/build/orbit/) confirms local ad hoc build installation. The wizard attempts `open -a "Expo Orbit"`, falls back to Finder on a failed handoff, and prints manual selection guidance if the application opens without displaying the build.
5. Still requires a real Apple credential refresh and an on-device install to verify the external services and hardware end to end. No credentials were changed and no actual application was installed during implementation.
