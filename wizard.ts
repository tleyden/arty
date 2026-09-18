#!/usr/bin/env bun

import { spawn } from "bun";
import * as readline from "readline/promises";
import { promises as fs } from "fs";
import * as path from "path";

interface BuildOption {
  name: string;
  flag: string;
  command: string;
  description: string;
  customHandler?: () => Promise<number>;
}

// Directories containing WebRTC headers that require patching.
const HEADER_DIRS = [
  'ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-arm64/WebRTC.framework/Headers',
  'ios/Pods/WebRTC-lib/WebRTC.xcframework/ios-x86_64_arm64-simulator/WebRTC.framework/Headers',
];

async function patchHeaderDirectory(relativeDir: string): Promise<void> {
  const absoluteDir = path.resolve(process.cwd(), relativeDir);
  try {
    await fs.access(absoluteDir, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    console.warn(`\n⚠️  Skipping ${relativeDir}: directory not found or inaccessible.`);
    return;
  }

  const targetDir = path.join(absoluteDir, 'sdk/objc/base');
  await fs.mkdir(targetDir, { recursive: true });

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    const { name } = entry;
    if (name === 'sdk') {
      continue;
    }

    if (entry.isDirectory()) {
      continue;
    }

    const source = path.join(absoluteDir, name);
    const destination = path.join(targetDir, name);

    try {
      await fs.link(source, destination);
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        continue;
      }
      throw new Error(`Failed to link ${name} in ${relativeDir}: ${err.message}`);
    }
  }

  console.log(`\n✅ Patched headers in ${relativeDir}`);
}

async function patchHeaders(): Promise<number> {
  console.log('\nPatching WebRTC-lib headers...');
  try {
    for (const dir of HEADER_DIRS) {
      await patchHeaderDirectory(dir);
    }
    console.log('\n🎉 All done!');
    return 0;
  } catch (err: any) {
    console.error(`\n❌ ${err.message}`);
    return 1;
  }
}

async function findMostRecentIpa(modifiedSince = 0): Promise<{ filePath: string; size: number; mtime: Date } | null> {
  let mostRecent: { filePath: string; size: number; mtime: Date } | null = null;

  async function searchDir(dir: string, depth: number): Promise<void> {
    if (depth > 3) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.ipa')) {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs < modifiedSince) continue;
        if (!mostRecent || stat.mtime > mostRecent.mtime) {
          mostRecent = { filePath: fullPath, size: stat.size, mtime: stat.mtime };
        }
      } else if (entry.isDirectory()) {
        await searchDir(fullPath, depth + 1);
      }
    }
  }

  await searchDir(process.cwd(), 0);
  return mostRecent;
}

async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    // EOF is a declined prompt, even when an explicit blank answer means yes.
    const closed = new Promise<null>((resolve) => rl.once('close', () => resolve(null)));
    const answer = await Promise.race([rl.question(`\n${question} `), closed]);
    if (answer === null) return false;
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes' || (defaultYes && normalized === '');
  } finally {
    rl.close();
  }
}

export function isExpiredIosCredentialsError(output: string): boolean {
  const plainOutput = Bun.stripANSI(output).replace(/\s+/g, ' ');
  return /Provisioning Profile has expired/i.test(plainOutput) || (
    /Failed to set up credentials/i.test(plainOutput) &&
    /ASC API key is required in non-interactive mode/i.test(plainOutput)
  );
}

async function runEasBuild(profile: string, extraFlags: string[] = []): Promise<number> {
  const command = ['bunx', 'eas', 'build', '--platform', 'ios', '--profile', profile];
  const result = await executeCommand([...command, '--non-interactive', ...extraFlags], {
    captureOutput: true,
  });
  if (result.exitCode === 0 || result.interrupted || !isExpiredIosCredentialsError(result.output)) {
    return result.exitCode;
  }

  console.log('\n❌ Your iOS signing credentials have expired or need to be refreshed.');
  if (!await confirm('Do you want to refresh them now? (y/N)')) {
    return result.exitCode;
  }

  // EAS owns the credential prompts. Inherit its terminal output and retry only once.
  return executeCommand([...command, ...extraFlags]);
}

function printIpaDetails(ipa: { filePath: string; size: number; mtime: Date }): void {
  console.log(`   Path:     ${ipa.filePath}`);
  console.log(`   Size:     ${(ipa.size / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`   Modified: ${ipa.mtime.toLocaleString()}`);
}

async function easSubmitLocalIpa(): Promise<number> {
  console.log('\n🔍 Searching for IPA files...');

  const ipa = await findMostRecentIpa();

  if (!ipa) {
    console.error('\n❌ No IPA file found. Run a local build first (e.g. EAS Build Dev Local).');
    return 1;
  }

  console.log('\n📦 Most recent IPA found:');
  printIpaDetails(ipa);

  if (!await confirm('Submit this IPA to TestFlight / App Store? (y/N)')) {
    console.log('\nCancelled.');
    return 0;
  }

  return executeCommand(['bunx', 'eas', 'submit', '--platform', 'ios', '--path', ipa.filePath]);
}

async function easBuildProd(): Promise<number> {
  const buildExitCode = await runEasBuild('production');
  if (buildExitCode !== 0) return buildExitCode;
  return executeCommand(['bunx', 'eas', 'submit', '--platform', 'ios']);
}

async function easBuildProdLocal(): Promise<number> {
  const buildExitCode = await runEasBuild('production', ['--local']);
  if (buildExitCode !== 0) {
    return buildExitCode;
  }
  console.log('\n✅ Local production build complete. Proceeding to TestFlight / App Store submission...');
  return easSubmitLocalIpa();
}

async function easBuildDev(): Promise<number> {
  const buildExitCode = await runEasBuild('dev_self_contained');
  if (buildExitCode !== 0) return buildExitCode;
  console.log('\n📲 Install on your iPhone with Expo Orbit:');
  console.log('   Open the EAS build page linked above and choose "Open with Orbit".');
  console.log('   Plug in and unlock your iPhone, enable Developer Mode, and select it in Orbit.');
  return 0;
}

async function easBuildDevLocal(): Promise<number> {
  const startedAt = Date.now();
  const buildExitCode = await runEasBuild('dev_self_contained', ['--local']);
  if (buildExitCode !== 0) return buildExitCode;

  const ipa = await findMostRecentIpa(startedAt);
  if (!ipa) {
    console.warn('\n⚠️  Build succeeded, but no new IPA was found in the project. Use the artifact path printed by EAS above.');
    return 0;
  }

  console.log('\n📦 New development IPA:');
  printIpaDetails(ipa);
  console.log('\n📲 Install on your iPhone with Expo Orbit:');
  console.log('   1. Plug in the iPhone (USB) and unlock it. Enable Developer Mode in');
  console.log('      Settings → Privacy & Security → Developer Mode.');
  console.log('   2. Pick the device in the Orbit menu bar app.');
  console.log('   3. Drag the .ipa onto the Orbit menu bar icon (or choose "Select build from local file").');
  console.log('   If the phone is not registered, run `bun run wizard register-device`,');
  console.log('   then rebuild so its UDID is included in the provisioning profile.');

  if (await confirm('Open it in Expo Orbit now? (Y/n)', true)) {
    let opened = false;
    try {
      opened = await executeCommand(['open', '-a', 'Expo Orbit', ipa.filePath]) === 0;
    } catch {
      // A missing opener is handled the same way as a failed application handoff.
    }
    if (!opened) {
      console.warn('\n⚠️  Could not open the IPA in Expo Orbit. Revealing it in Finder so you can drag it into Orbit.');
      try {
        if (await executeCommand(['open', '-R', ipa.filePath]) !== 0) {
          console.warn(`   Open Finder manually and locate: ${ipa.filePath}`);
        }
      } catch {
        console.warn(`   Open Finder manually and locate: ${ipa.filePath}`);
      }
    } else {
      console.log('   Sent to Expo Orbit. If it does not show the build, use "Select build from local file" with the path above.');
    }
  }
  return 0;
}

async function startExpoServer(): Promise<number> {
  console.log('\n🔍 Running TypeScript check...\n');

  const tscProc = spawn({
    cmd: ["sh", "-c", "bunx tsc --noEmit"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const tscExitCode = await tscProc.exited;

  if (tscExitCode !== 0) {
    console.error('\n❌ TypeScript check failed. Fix errors before starting Expo.');
    return tscExitCode;
  }

  console.log('\n✅ TypeScript check passed!\n');
  console.log('🚀 Starting Expo server...\n');

  const expoProc = spawn({
    cmd: ["sh", "-c", "bunx expo start"],
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  // Set up signal handlers to forward signals to child process
  let isShuttingDown = false;

  const shutdownHandler = (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    console.log(`\n\n⚠️  Received ${signal}, shutting down Expo server gracefully...`);

    // Kill the child process
    expoProc.kill(signal);

    // Give it 2 seconds to clean up, then force kill if needed
    setTimeout(() => {
      if (!expoProc.killed) {
        console.log('\n⚠️  Process did not exit cleanly, force killing...');
        expoProc.kill('SIGKILL');
      }
    }, 2000);
  };

  // Handle SIGINT (Ctrl+C) and SIGTERM
  const sigintHandler = () => shutdownHandler('SIGINT');
  const sigtermHandler = () => shutdownHandler('SIGTERM');

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  const expoExitCode = await expoProc.exited;

  // Clean up signal handlers
  process.off('SIGINT', sigintHandler);
  process.off('SIGTERM', sigtermHandler);

  return expoExitCode;
}

const BUILD_OPTIONS: BuildOption[] = [
  {
    name: "Start Expo Server",
    flag: "start-expo",
    command: "",
    description: "Run TypeScript check, then start Expo server",
    customHandler: startExpoServer,
  },
  {
    name: "Patch WebRTC Headers",
    flag: "patch-webrtc",
    command: "",
    description: "Patch WebRTC-lib headers for iOS",
    customHandler: patchHeaders,
  },
  {
    name: "EAS Build Dev",
    flag: "eas-build-dev",
    command: "",
    description: "Build iOS app with dev_self_contained profile",
    customHandler: easBuildDev,
  },
  {
    name: "EAS Build Dev Local",
    flag: "eas-build-dev-local",
    command: "",
    description: "Build iOS app locally with dev_self_contained profile",
    customHandler: easBuildDevLocal,
  },
  {
    name: "EAS Update Dev",
    flag: "eas-update-dev",
    command: 'bunx eas update --platform ios --branch dev_self_contained --message "Update"',
    description: "Push an OTA update to dev_self_contained branch",
  },
  {
    name: "Clean Build",
    flag: "clean-build",
    command: "CI=1 bunx expo prebuild --clean --platform ios",
    description: "Clean prebuild for iOS",
  },
  {
    name: "EAS Build Prod",
    flag: "eas-build-prod",
    command: "",
    description: "Build and submit iOS app to TestFlight / App Store",
    customHandler: easBuildProd,
  },
  {
    name: "EAS Build Prod Local",
    flag: "eas-build-prod-local",
    command: "",
    description: "Build IPA locally with Distribution profile, then submit to TestFlight / App Store",
    customHandler: easBuildProdLocal,
  },
  {
    name: "EAS Submit Local IPA",
    flag: "eas-submit-local-ipa",
    command: "",
    description: "Find the most recent local IPA and submit it to TestFlight / App Store",
    customHandler: easSubmitLocalIpa,
  },
  {
    name: "Run Xcodebuild",
    flag: "build-ios-local",
    command:
      "set -o pipefail && if test -x \"$(command -v xcpretty)\"; then xcodebuild build -workspace ios/vibemachine.xcworkspace -scheme vibemachine -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' | xcpretty; else xcodebuild build -workspace ios/vibemachine.xcworkspace -scheme vibemachine -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator'; fi",
    description: "Compile Swift without launching (same compiler as Xcode, no EAS overhead)",
  },
  {
    name: "Open in Xcode",
    flag: "open-xcode",
    command: "xed ios",
    description: "Open iOS project in Xcode",
  },
  {
    name: "Register New Device UDID",
    flag: "register-device",
    command: "bunx eas device:create",
    description: "Register a new device UDID with EAS",
  },
];

type Command = string | string[];
interface CommandResult {
  exitCode: number;
  output: string;
  interrupted: boolean;
}

export function executeCommand(command: Command, options: { captureOutput: true }): Promise<CommandResult>;
export function executeCommand(command: Command): Promise<number>;
export async function executeCommand(
  command: Command,
  options?: { captureOutput: true },
): Promise<number | CommandResult> {
  console.log(`\n🚀 Executing: ${typeof command === 'string' ? command : command.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg).join(' ')}\n`);

  const proc = spawn({
    cmd: typeof command === 'string' ? ["sh", "-c", command] : command,
    stdout: options?.captureOutput ? "pipe" : "inherit",
    stderr: options?.captureOutput ? "pipe" : "inherit",
    stdin: "inherit",
    env: options?.captureOutput ? { ...process.env, FORCE_COLOR: '1' } : process.env,
  });

  const outputLimit = 64 * 1024;
  let outputTail = Buffer.alloc(0);
  const forward = async (stream: ReadableStream<Uint8Array>, destination: NodeJS.WriteStream) => {
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        outputTail = Buffer.from(Buffer.concat([outputTail, chunk]).subarray(-outputLimit));
        await new Promise<void>((resolve, reject) => {
          destination.write(chunk, (error) => error ? reject(error) : resolve());
        });
      }
    } finally {
      reader.releaseLock();
    }
  };

  // Set up signal handlers to forward signals to child process
  let isShuttingDown = false;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let interruptedExitCode: number | undefined;

  const shutdownHandler = (signal: NodeJS.Signals) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    interruptedExitCode = signal === 'SIGINT' ? 130 : 143;

    console.log(`\n\n⚠️  Received ${signal}, shutting down command gracefully...`);

    // Kill the child process
    proc.kill(signal);

    // Give it 2 seconds to clean up, then force kill if needed
    shutdownTimer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        console.log('\n⚠️  Process did not exit cleanly, force killing...');
        proc.kill('SIGKILL');
      }
    }, 2000);
  };

  // Handle SIGINT (Ctrl+C) and SIGTERM
  const sigintHandler = () => shutdownHandler('SIGINT');
  const sigtermHandler = () => shutdownHandler('SIGTERM');

  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigtermHandler);

  try {
    const [exitCode] = await Promise.all([
      proc.exited,
      options?.captureOutput && proc.stdout ? forward(proc.stdout, process.stdout) : undefined,
      options?.captureOutput && proc.stderr ? forward(proc.stderr, process.stderr) : undefined,
    ]);
    const commandExitCode = interruptedExitCode ?? exitCode;
    return options?.captureOutput
      ? { exitCode: commandExitCode, output: outputTail.toString('utf8'), interrupted: isShuttingDown || proc.signalCode !== null }
      : commandExitCode;
  } finally {
    clearTimeout(shutdownTimer);
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigtermHandler);
  }
}

function showMenu(): void {
  console.log("\n=== Arty Build Wizard ===\n");
  BUILD_OPTIONS.forEach((option, index) => {
    console.log(`${index + 1}) ${option.name}`);
    console.log(`   ${option.description}`);
    console.log(`   Flag: bun run wizard ${option.flag}\n`);
  });
  console.log("0) Exit");
}

async function executeChoice(choice: string): Promise<void> {
  const index = parseInt(choice) - 1;

  if (choice === "0" || choice === "") {
    console.log("\nGoodbye!");
    process.exit(0);
  }

  if (index >= 0 && index < BUILD_OPTIONS.length) {
    const option = BUILD_OPTIONS[index];
    console.log(`\n📦 ${option.name}`);

    const exitCode = option.customHandler
      ? await option.customHandler()
      : await executeCommand(option.command);

    if (exitCode === 0) {
      console.log(`\n✅ ${option.name} completed successfully! (${new Date().toLocaleTimeString()})`);
      process.exit(0);
    } else {
      console.error(`\n❌ ${option.name} failed with exit code ${exitCode}`);
      process.exit(exitCode);
    }
  } else {
    console.log("\n❌ Unrecognized option.");
    process.exit(1);
  }
}

async function handleFlag(flag: string): Promise<void> {
  const option = BUILD_OPTIONS.find((opt) => opt.flag === flag);

  if (option) {
    console.log(`\n📦 ${option.name}`);

    const exitCode = option.customHandler
      ? await option.customHandler()
      : await executeCommand(option.command);

    if (exitCode === 0) {
      console.log(`\n✅ ${option.name} completed successfully! (${new Date().toLocaleTimeString()})`);
      process.exit(0);
    } else {
      console.error(`\n❌ ${option.name} failed with exit code ${exitCode}`);
      process.exit(exitCode);
    }
  } else {
    console.error(`\n❌ Unknown flag: ${flag}`);
    console.log("\nAvailable flags:");
    BUILD_OPTIONS.forEach((opt) => {
      console.log(`  - ${opt.flag}: ${opt.description}`);
    });
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);

  // Check if a flag was provided
  if (args.length > 0) {
    await handleFlag(args[0]);
    return;
  }

  // Interactive mode
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  showMenu();

  const answer = await rl.question("\nSelect an option: ");
  rl.close();
  const choice = answer.trim();
  await executeChoice(choice);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`\n❌ ${err.message}`);
    process.exit(1);
  });
}
