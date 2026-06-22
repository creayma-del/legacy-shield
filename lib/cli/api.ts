import { startApiServer } from '../api.js';
import { assertLegacyProject } from '../utils.js';
import type { ApiCommandOptions } from '../types.js';

export async function runApi(options: ApiCommandOptions): Promise<void> {
  const { project, port, cors } = options;
  assertLegacyProject(project);
  const server = startApiServer({ projectPath: project, port, cors });

  await new Promise<void>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`端口 ${port} 已被占用，请使用 --port 指定其他端口`));
        return;
      }
      reject(err);
    });
    server.once('listening', resolve);
  });
  const actualPort = (server.address() as { port: number }).port;
  // eslint-disable-next-line no-console
  console.log(`[legacy-shield] API 服务已启动: http://127.0.0.1:${actualPort}`);

  const shutdown = () => {
    // eslint-disable-next-line no-console
    console.log('\n[legacy-shield] 正在关闭 API 服务...');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
