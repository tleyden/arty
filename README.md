# 🎙️ Arty - iOS realtime voice assistant w/ translation + connectors

[![TestFlight](https://img.shields.io/badge/TestFlight-available-blue)](https://testflight.apple.com/join/DyK83gVd) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/vibemachine-labs/arty) [![Snyk](https://snyk.io/test/github/vibemachine-labs/arty/badge.svg)](https://snyk.io/test/github/vibemachine-labs/arty)
[![OSSF Scorecard](https://github.com/vibemachine-labs/arty/actions/workflows/scorecard-pr.yml/badge.svg)](https://github.com/vibemachine-labs/arty/actions/workflows/scorecard-pr.yml) ![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/vibemachine-labs/arty?utm_source=oss&utm_medium=github&utm_campaign=vibemachine-labs%2Farty&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

**Features**

* Realtime Voice Assistant, fully interruptible
* Realtime Translator/Interpreter mode
* Bring Your Own OpenAI API Key
* Extensions/connectors: DeepWiki MCP, Google Drive, GitHub, Hugging Face Papers, Hacker News, Web Search
* Generic MCP connector (experimental, still WIP)
* Works with 🔈 speaker or 🎧 headphones
* Customizable prompts: Edit system and tool prompts directly from the config UI

**Tech Stack**

* WebRTC
* Native Swift w/ echo cancellation support
* Expo / React Native

**Requirements**

* iOS - tested on ios 26, may work on earlier versions
* OpenAI API Key

## 📱 Screenshots

<table style="border-collapse:collapse; border-spacing:0; border:none; margin:0 auto;">
  <tr>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Voice chat home screen" src="https://github.com/user-attachments/assets/aef4e478-c98a-4d9c-a4ca-642871d32dc2" />
      <div>Voice chat (home screen)</div>
    </td>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Realtime Translation/Interpreter" src="https://github.com/user-attachments/assets/1450d8fa-9945-4369-910d-ce99a2aa9b6b" />
      <div>Realtime Translation/Interpreter</div>
    </td>
    <td align="center" style="border:none; padding:0 12px;">
      <img width="250" alt="Configure connectors screen" src="https://github.com/user-attachments/assets/e8fe8fe7-c6f1-471c-9535-039e9860bb1f" />
      <div>Configure connectors</div>
    </td>
  </tr>
</table>

## ▶️ Install it via TestFlight

[<img src="https://github.com/user-attachments/assets/33a4ed30-f00d-4639-9389-022d8f9bf581" alt="Join the TestFlight beta" width="220" />](https://testflight.apple.com/join/DyK83gVd)

[Test Flight Installation](https://testflight.apple.com/join/DyK83gVd)

> **Security note:** TestFlight builds are compiled binaries; do not assume they exactly match this source code. If you require verifiability, build from source and review the code before installing.


## 🔐 Security + Privacy

> **Privacy status:** Currently, the app uses OpenAI's API, which means user prompts and connector content are transmitted to OpenAI by design. Your credentials (API keys, OAuth tokens) never leave your device and are stored securely in iOS Keychain. Future updates will add support for self-hosted and fully local execution options.

## 🛠️ Building from source

<details>
  <summary>Installation steps</summary>

### Clone project and install dependencies

```bash
git clone https://github.com/vibemachine-labs/arty.git
cd arty
curl -fsSL https://bun.sh/install | bash
bun install
```


### Run the app

To run in the iOS simulator:

```bash
bunx expo run:ios
```

⛓️‍💥 If you get **CommandError: No iOS devices available in Simulator.app**, it means you need to install the iOS platform in Xcode.  Go to Xcode > Settings > Components and install the iOS platform.

⚠️ Audio is flaky on the iOS Simulator.  Using a real device is highly recommended.

To run on a physical device:

```bash
bunx expo run:ios --device
```

</details>

<details>
  <summary>Editing Swift code in Xcode</summary>

### Open Xcode project

To open the project in Xcode:

```bash
xed ios
```

In Xcode, the native swift code will be under **Pods / Development Pods**

</details>

<details>
  <summary>Misc Dev Notes</summary>


### Create a Google Drive Client ID (Optional)

When building from source, you will need to provide your own Google Drive Client ID.  You can decide the permissions you want to give it, as well as whether you want to go through the verification process.

[Google API Instructions](https://support.google.com/cloud/answer/15549257)

For testing, the following oauth scopes are suggested:

1. See and download your google drive files (included by default)
1. See, edit, create, and delete only the specific Google Drive files you use with this app


### Development notes

- Project bootstrapped with `bunx create-expo-app@latest .`
- Refresh dependencies after pulling new changes: `bunx expo install`
- Install new dependencies: `bunx expo install <package-name>`
- Allow LAN access once: `bunx expo start --lan`

### Run on iOS device via ad hoc distribution

1. Register device: `eas device:create`
2. Scan the generated QR code on the device and install the provisioning profile via Settings.
3. Configure build: `bunx eas build:configure`
4. Build: `eas build --platform ios --profile dev_self_contained`

### Clean build

If pods misbehave, rebuild from scratch:

```bash
bunx expo prebuild --clean --platform ios
bunx expo run:ios
```

</details>

## 📦 Expo Build

<details>
  <summary>Build Steps</summary>


### Additional Deps

```
brew install fastlane
```

### Expo login

```
bunx eas login
```

### Setup Apple Dev Account 

```
bunx eas credentials
```

### Run build wizard

```
bun run wizard
```

</details>


## ⚙️ Technical Details

<details>
  <summary>Architecture overview</summary>

### Native Swift WebRTC Client

React Native WebRTC libraries did not reliably support speakerphone mode during prototyping. The native Swift implementation resolves this issue but adds complexity and delays Android support.

### Connector Architecture

All connectors use statically defined tools with explicit function definitions, providing reliability and predictable behavior. Examples include Google Drive file operations, DeepWiki documentation search, Hacker News browsing, and Daily Hugging Face Top Papers discovery.

### MCP Support

**MCP** *(can be enabled in settings)*: Connects to external MCP servers via a streamable HTTP endpoint. 

> **Note:** OAuth token refresh is implemented but still very buggy.

### Web Search

GPT-4 web search serves as a temporary solution. The roadmap includes integrating a dedicated search API (e.g., Brave Search) using user-provided API tokens.

### Voice / Text LLM backend

OpenAI is currently the only supported backend. Adding support for multiple providers and self-hosted backends is on the roadmap.

</details>


## 📬 Contact & Feedback

- **Email/Twitter:** Email or Twitter/X via my [Github profile](https://github.com/tleyden).
- **Issues, Ideas:** Submit bugs, feature requests, or connector suggestions on GitHub Issues.
- **Responsible disclosure:** Report security-relevant issues privately via email using the address listed on my [Github profile](https://github.com/tleyden) before any public disclosure.
