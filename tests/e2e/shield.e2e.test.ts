import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';
import http from 'node:http';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function hasPlaywrightChromium(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

function waitForExit(process: ChildProcess | undefined, timeoutMs = 10000): Promise<void> {
  if (!process || process.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`子进程未在 ${timeoutMs}ms 内退出`)),
      timeoutMs,
    );
    process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function killShield(process: ChildProcess | undefined, timeoutMs = 10000): Promise<void> {
  if (!process || process.exitCode !== null) return;
  process.kill('SIGINT');
  try {
    await waitForExit(process, timeoutMs);
  } catch {
    if (process.exitCode === null) {
      process.kill('SIGKILL');
      await waitForExit(process, 5000).catch(() => {
        // 尽最大努力清理，忽略最终退出等待失败
      });
    }
  }
}

async function waitForLogFile(dir: string, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = join(dir, file);
        if (existsSync(filePath) && readFileSync(filePath, 'utf8').trim().length > 0) {
          return filePath;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`日志文件在 ${timeoutMs}ms 内未生成: ${dir}`);
}

describe('shield integration', () => {
  let legacyDir: string;
  let targetServer: http.Server;
  let targetPort: number;
  let shieldProcess: ChildProcess | undefined;

  beforeAll(async () => {
    legacyDir = mkdtempSync(join(tmpdir(), 'shield-legacy-'));
    mkdirSync(join(legacyDir, 'src'));
    writeFileSync(join(legacyDir, 'package.json'), JSON.stringify({ name: 'fake-legacy' }));

    targetServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <button id="btn">Click</button>
        <script>
          document.getElementById('btn').addEventListener('click', () => console.error('clicked error'));
          console.error('page error');
          setTimeout(() => document.getElementById('btn').click(), 500);
        </script>
      `);
    });
    await new Promise<void>((r) => targetServer.listen(0, r));
    targetPort = (targetServer.address() as { port: number }).port;

    const cliPath = resolve('dist/cli.js');
    if (!existsSync(cliPath)) {
      execSync('pnpm build', { stdio: 'inherit' });
    }

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (!hasPlaywrightChromium() && !process.env.PLAYWRIGHT_CHROMIUM_CHANNEL) {
      env.PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome';
    }

    shieldProcess = spawn(
      'node',
      [
        cliPath,
        'shield',
        '--project',
        legacyDir,
        '--target',
        `http://localhost:${targetPort}`,
        '--headless',
        'true',
        '--proxy-port',
        '0',
      ],
      { stdio: 'pipe', env },
    );

    await new Promise<void>((resolveStartup, reject) => {
      const timer = setTimeout(() => reject(new Error('shield startup timeout')), 30000);
      shieldProcess!.stdout!.on('data', (data) => {
        if (String(data).includes('监控会话')) {
          clearTimeout(timer);
          resolveStartup();
        }
      });
      shieldProcess!.stderr!.on('data', (data) => {
        // eslint-disable-next-line no-console
        console.error(String(data));
      });
    });
  }, 60000);

  afterAll(async () => {
    await killShield(shieldProcess, 15000);
    if (targetServer) {
      await new Promise<void>((r) => targetServer.close(() => r()));
    }
    if (legacyDir) {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  }, 30000);

  it(
    'collects runtime, network and behavior logs',
    { retry: 2, timeout: 90000 },
    async () => {
      const runtimeDir = join(legacyDir, '.runtime-log-ignore', 'runtime');
      const networkDir = join(legacyDir, '.runtime-log-ignore', 'network');
      const behaviorDir = join(legacyDir, '.runtime-log-ignore', 'behavior');

      const [runtimeFile, networkFile, behaviorFile] = await Promise.all([
        waitForLogFile(runtimeDir, 15000),
        waitForLogFile(networkDir, 15000),
        waitForLogFile(behaviorDir, 15000),
      ]);

      await killShield(shieldProcess, 15000);

      const runtimeLines = readFileSync(runtimeFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(runtimeLines.some((l) => l.subType === 'console-error')).toBe(true);

      const networkLines = readFileSync(networkFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(networkLines.some((l) => l.method === 'GET')).toBe(true);

      const behaviorLines = readFileSync(behaviorFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(behaviorLines.some((l) => l.subType === 'click')).toBe(true);
    },
  );
});
