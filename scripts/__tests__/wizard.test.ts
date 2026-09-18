import { afterEach, describe, expect, test } from 'bun:test';
import { $ } from 'bun';

import { isExpiredIosCredentialsError } from '../../wizard';

const wizardPath = new URL('../../wizard.ts', import.meta.url).pathname;
const refreshPrompt = 'Do you want to refresh them now? (y/N)';
const orbitPrompt = 'Open it in Expo Orbit now? (Y/n)';
const submitPrompt = 'Submit this IPA to TestFlight / App Store? (y/N)';
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const dir of temporaryDirectories.splice(0)) {
    if (/^\/(private\/)?tmp\/arty-wizard-test-/.test(dir)) await $`rm -rf ${dir}`.quiet();
  }
});

// These executables replace every EAS and macOS open call. No builds, account
// access, application launches, or submissions can occur in these tests.
const fakeCommand = `#!/usr/bin/env bun
const args = Bun.argv.slice(2);
const kind = Bun.argv[1].endsWith('/open') ? 'open' : 'bunx';
const config = await Bun.file('config.json').json();
const previous = await Bun.file('commands.jsonl').text().catch(() => '');
await Bun.write('commands.jsonl', previous + JSON.stringify({ kind, args, color: process.env.FORCE_COLOR }) + '\\n');
if (kind === 'open') process.exit(args[0] === '-a' ? (config.orbitExit ?? 0) : (config.finderExit ?? 0));
if (args[1] === 'submit') process.exit(config.submitExit ?? 0);
if (args[1] !== 'build') process.exit(99);
const nonInteractive = args.includes('--non-interactive');
if (config.hold) {
  if (config.exitCleanlyOnSignal) process.on('SIGINT', () => process.exit(0));
  console.log('Provisioning Profile has expired. BUILD_WAITING');
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (!nonInteractive) {
  console.log('INTERACTIVE_RETRY');
  if (config.credentialPrompt) {
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Fake Apple login? ');
    rl.close();
    if (answer !== 'yes') process.exit(97);
  }
}
const code = nonInteractive ? (config.firstExit ?? 0) : (config.retryExit ?? 0);
if (code !== 0) {
  process.stdout.write(config.stdout ?? 'Provisioning Profile has expired.\\n');
  process.stderr.write(config.stderr ?? 'Failed to set up credentials.\\n');
  process.exit(code);
}
if (args.includes('--local') && config.artifact !== false) {
  await Bun.write(config.artifact ?? 'build-123.ipa', 'fake IPA');
}
console.log('BUILD_SUCCEEDED');
`;

interface FakeConfig {
  firstExit?: number;
  retryExit?: number;
  stdout?: string;
  stderr?: string;
  artifact?: string | false;
  orbitExit?: number;
  finderExit?: number;
  submitExit?: number;
  credentialPrompt?: boolean;
  hold?: boolean;
  exitCleanlyOnSignal?: boolean;
}

interface Reply {
  prompt: string;
  answer: string | null;
}

async function runWizard(
  flag: string,
  config: FakeConfig = {},
  replies: Reply[] = [],
  options: { oldIpa?: boolean; interrupt?: boolean } = {},
) {
  const createdDir = (await $`/usr/bin/mktemp -d /tmp/arty-wizard-test-XXXXXX`.text()).trim();
  if (!createdDir.startsWith('/tmp/arty-wizard-test-')) throw new Error('mktemp did not return a test directory');
  const dir = (await $`/bin/pwd -P`.cwd(createdDir).text()).trim();
  temporaryDirectories.push(dir);
  await $`mkdir ${dir + '/bin'}`.quiet();
  await Bun.write(dir + '/config.json', JSON.stringify(config));
  for (const name of ['bunx', 'open']) {
    await Bun.write(dir + '/bin/' + name, fakeCommand);
    await $`chmod +x ${dir + '/bin/' + name}`.quiet();
  }
  if (options.oldIpa) {
    await Bun.write(dir + '/old-production.ipa', 'old IPA');
    await $`/usr/bin/touch -t 202001010000 ${dir + '/old-production.ipa'}`.quiet();
  }
  const proc = Bun.spawn([process.execPath, wizardPath, flag], {
    cwd: dir,
    env: { ...process.env, PATH: dir + '/bin:' + process.env.PATH, FORCE_COLOR: '0' },
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  let output = '';
  let nextReply = 0;
  let timedOut = false;
  let interrupted = false;
  const timer = setTimeout(() => { timedOut = true; proc.kill(); }, 8000);
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
      while (nextReply < replies.length && output.includes(replies[nextReply].prompt)) {
        const { answer } = replies[nextReply++];
        if (answer === null) proc.stdin.end();
        else { proc.stdin.write(answer + '\n'); proc.stdin.flush(); }
      }
      if (options.interrupt && !interrupted && output.includes('BUILD_WAITING')) {
        interrupted = true;
        proc.kill('SIGINT');
      }
    }
  };
  try {
    const [exitCode] = await Promise.all([proc.exited, read(proc.stdout), read(proc.stderr)]);
    expect(timedOut).toBe(false);
    const records = (await Bun.file(dir + '/commands.jsonl').text()).trim().split('\n');
    const commands = records.map((record) => JSON.parse(record) as {
      kind: string; args: string[]; color: string;
    });
    return { exitCode, output, commands, dir };
  } finally {
    clearTimeout(timer);
    proc.stdin.end();
    if (proc.exitCode === null && proc.signalCode === null) proc.kill();
  }
}

describe('expired iOS credentials detection', () => {
  test('recognizes the specific error through ANSI formatting and wrapped lines', () => {
    expect(isExpiredIosCredentialsError('\x1b[31mProvisioning Profile\x1b[0m has expired.')).toBe(true);
    expect(isExpiredIosCredentialsError('Failed to set up credentials.\nIn order to configure your Provisioning Profile, authentication with an ASC API key is required in\nnon-interactive mode.')).toBe(true);
  });

  test('does not misclassify unrelated failures or incomplete credential errors', () => {
    for (const message of ['Build command failed.', 'Network error', 'Failed to set up credentials.', 'ASC API key is required in non-interactive mode.', 'Distribution certificate is invalid.']) {
      expect(isExpiredIosCredentialsError(message)).toBe(false);
    }
  });
});

describe('wizard build recovery', () => {
  for (const flag of ['eas-build-prod', 'eas-build-prod-local', 'eas-build-dev', 'eas-build-dev-local']) {
    test(`${flag}: declining retains the original failure`, async () => {
      const result = await runWizard(flag, { firstExit: 23 }, [{ prompt: refreshPrompt, answer: 'n' }]);
      expect(result.exitCode).toBe(23);
      expect(result.commands).toHaveLength(1);
      expect(result.output).toContain('Provisioning Profile has expired.');
      expect(result.commands[0].color).toBe('1');
    });

    test(`${flag}: accepts one interactive retry with the same profile and local flag`, async () => {
      const replies = [{ prompt: refreshPrompt, answer: 'yes' }, { prompt: 'Fake Apple login?', answer: 'yes' }];
      if (flag === 'eas-build-prod-local') replies.push({ prompt: submitPrompt, answer: 'y' });
      if (flag === 'eas-build-dev-local') replies.push({ prompt: orbitPrompt, answer: 'n' });
      const result = await runWizard(flag, { firstExit: 23, credentialPrompt: true }, replies);
      expect(result.exitCode).toBe(0);
      expect(result.commands[1].args).toEqual(result.commands[0].args.filter((arg) => arg !== '--non-interactive'));
      expect(result.commands[1].color).toBe('0');
      const submissions = result.commands.filter((command) => command.args[1] === 'submit');
      expect(submissions).toHaveLength(flag.includes('prod') ? 1 : 0);
    });
  }

  test('another build error never offers a refresh or submits', async () => {
    const result = await runWizard('eas-build-prod', { firstExit: 12, stdout: '', stderr: 'Swift compile failed\n' });
    expect(result.exitCode).toBe(12);
    expect(result.output).not.toContain(refreshPrompt);
    expect(result.commands).toHaveLength(1);
  });

  test('failed interactive retry does not retry again or submit', async () => {
    const result = await runWizard('eas-build-prod', { firstExit: 23, retryExit: 34 }, [{ prompt: refreshPrompt, answer: 'y' }]);
    expect(result.exitCode).toBe(34);
    expect(result.commands).toHaveLength(2);
    expect(result.output.split(refreshPrompt)).toHaveLength(2);
  });

  test('blank answer and EOF both decline refresh', async () => {
    for (const answer of ['', null]) {
      const result = await runWizard('eas-build-dev', { firstExit: 23 }, [{ prompt: refreshPrompt, answer }]);
      expect(result.exitCode).toBe(23);
      expect(result.commands).toHaveLength(1);
    }
  });

  test('Ctrl-C forwards to the build and does not offer recovery', async () => {
    const result = await runWizard('eas-build-dev', { hold: true }, [], { interrupt: true });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).not.toContain(refreshPrompt);
    expect(result.commands).toHaveLength(1);
  });

  test('successful cloud production build submits and propagates a submit failure', async () => {
    const result = await runWizard('eas-build-prod', { submitExit: 45 });
    expect(result.exitCode).toBe(45);
    expect(result.commands.map((command) => command.args[1])).toEqual(['build', 'submit']);
    expect(result.output).not.toContain(refreshPrompt);
  });

  test('an interrupted production build cannot submit even if the child exits zero', async () => {
    const result = await runWizard('eas-build-prod', { hold: true, exitCleanlyOnSignal: true }, [], { interrupt: true });
    expect(result.exitCode).toBe(130);
    expect(result.output).not.toContain(refreshPrompt);
    expect(result.commands).toHaveLength(1);
  });
});

describe('dev build installation help', () => {
  test('cloud builds point to Open with Orbit without opening local files', async () => {
    const result = await runWizard('eas-build-dev');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Open with Orbit');
    expect(result.commands).toHaveLength(1);
  });

  test('new local artifact is passed literally to Orbit; blank answer means yes', async () => {
    const artifact = "build-$(touch SHOULD_NOT_EXIST) 'quoted'.ipa";
    const result = await runWizard('eas-build-dev-local', { artifact }, [{ prompt: orbitPrompt, answer: '' }], { oldIpa: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Developer Mode');
    expect(result.output).toContain('bun run wizard register-device');
    expect(result.output).toContain('New development IPA');
    expect(result.commands[1]).toMatchObject({ kind: 'open', args: ['-a', 'Expo Orbit', result.dir + '/' + artifact] });
    expect(await Bun.file(result.dir + '/SHOULD_NOT_EXIST').exists()).toBe(false);
  });

  test('Orbit failure reveals the new IPA in Finder', async () => {
    const result = await runWizard('eas-build-dev-local', { orbitExit: 1 }, [{ prompt: orbitPrompt, answer: 'y' }]);
    expect(result.exitCode).toBe(0);
    expect(result.commands[2]).toMatchObject({ kind: 'open', args: ['-R', result.dir + '/build-123.ipa'] });
    expect(result.output).toContain('Revealing it in Finder');
  });

  test('Finder failure still leaves a usable path and preserves build success', async () => {
    const result = await runWizard('eas-build-dev-local', { orbitExit: 1, finderExit: 1 }, [{ prompt: orbitPrompt, answer: 'y' }]);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Open Finder manually and locate: ' + result.dir + '/build-123.ipa');
  });

  test('declining or closing the Orbit prompt does not open anything', async () => {
    for (const answer of ['n', null]) {
      const result = await runWizard('eas-build-dev-local', {}, [{ prompt: orbitPrompt, answer }]);
      expect(result.exitCode).toBe(0);
      expect(result.commands).toHaveLength(1);
    }
  });

  test('successful build without a new artifact never offers an old production IPA', async () => {
    const result = await runWizard('eas-build-dev-local', { artifact: false }, [], { oldIpa: true });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('no new IPA was found');
    expect(result.output).not.toContain(orbitPrompt);
    expect(result.commands).toHaveLength(1);
  });
});

test('capture streams both outputs live, strips split ANSI for detection, and retains only 64 KiB', async () => {
  const script = `
    import { executeCommand, isExpiredIosCredentialsError } from ${JSON.stringify(wizardPath)};
    const result = await executeCommand([process.execPath, '-e', ${JSON.stringify("process.stdout.write('x'.repeat(100000)); process.stdout.write('\\x1b[31mProvisioning '); await Bun.sleep(10); process.stdout.write('Profile has expired.\\x1b[0m\\n'); process.stderr.write('stderr-visible\\n'); process.exit(7);")}], { captureOutput: true });
    console.log('RESULT:' + JSON.stringify({ ...result, output: undefined, bytes: Buffer.byteLength(result.output), detected: isExpiredIosCredentialsError(result.output) }));
  `;
  const proc = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect(code).toBe(0);
  expect(stdout).toContain('x'.repeat(100000));
  expect(stderr).toContain('stderr-visible');
  const result = JSON.parse(stdout.slice(stdout.lastIndexOf('RESULT:') + 7).trim());
  expect(result).toEqual({ exitCode: 7, interrupted: false, bytes: 65536, detected: true });
});
