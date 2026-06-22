import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ResolveStartPageResult {
  url: string;
  isFileUrl: boolean;
  devServer?: {
    process: ReturnType<typeof import('node:child_process').spawn>;
    port: number;
    stop: () => Promise<void>;
  };
}

export async function resolveStartPage(
  projectPath: string,
  startPage: string,
  options: { headless?: boolean } = {},
): Promise<ResolveStartPageResult> {
  // 1. 如果 startPage 已经是完整 URL，直接使用
  if (/^https?:\/\//.test(startPage)) {
    return { url: startPage, isFileUrl: false };
  }

  // 2. 如果 startPage 指向存在的 html 文件，使用 file:// 协议
  const filePath = resolve(projectPath, startPage);
  if (existsSync(filePath) && filePath.endsWith('.html')) {
    return { url: `file://${filePath}`, isFileUrl: true };
  }

  // 3. 尝试自动检测并启动 dev server
  const packageJson = readPackageJson(projectPath);
  const scripts = packageJson?.scripts || {};

  // 优先使用项目自身 dev 脚本
  const devScript = scripts.dev || scripts.serve || scripts.start;
  if (devScript) {
    const port = await findFreePort();
    const { spawn } = await import('node:child_process');
    const env = { ...process.env, PORT: String(port), BROWSER: 'none' };
    const proc = spawn('npm', ['run', devScript.includes('dev') ? 'dev' : devScript.includes('serve') ? 'serve' : 'start'], {
      cwd: projectPath,
      env,
      stdio: options.headless === false ? 'inherit' : 'pipe',
      detached: false,
    });

    await waitForServer('127.0.0.1', port, 30000);

    const stop = (): Promise<void> => {
      return new Promise((resolve) => {
        if (proc.killed || proc.exitCode !== null) {
          resolve();
          return;
        }
        proc.once('exit', () => resolve());
        proc.once('error', () => resolve());
        proc.kill('SIGTERM');
      });
    };

    return {
      url: `http://127.0.0.1:${port}${startPage.startsWith('/') ? startPage : `/${startPage}`}`,
      isFileUrl: false,
      devServer: { process: proc, port, stop },
    };
  }

  // 4. 默认回退到 index.html
  const indexPath = resolve(projectPath, 'index.html');
  if (existsSync(indexPath)) {
    return { url: `file://${indexPath}`, isFileUrl: true };
  }

  throw new Error(`无法解析启动页面: ${startPage}`);
}

function readPackageJson(projectPath: string): { scripts?: Record<string, string> } | null {
  try {
    const content = readFileSync(resolve(projectPath, 'package.json'), 'utf8');
    return JSON.parse(content) as { scripts?: Record<string, string> };
  } catch {
    return null;
  }
}

async function findFreePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitForServer(host: string, port: number, timeoutMs: number): Promise<void> {
  const net = await import('node:net');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
      socket.once('connect', () => {
        socket.end();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`dev server 未在 ${timeoutMs}ms 内就绪 (port ${port})`);
}
