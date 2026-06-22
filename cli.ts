#!/usr/bin/env node
import { Command } from 'commander';
import { runShield } from './lib/cli/shield.js';
import { runQuality } from './lib/cli/quality.js';
import { runReport } from './lib/cli/report.js';
import { runApi } from './lib/cli/api.js';
import { today } from './lib/utils.js';

const program = new Command();

program.name('legacy-shield').description('非侵入式老项目护航工具').version('0.1.0');

program
  .command('shield')
  .description('启动运行时监控')
  .requiredOption('--project <path>', '老项目根路径')
  .requiredOption('--target <url>', '目标 dev server URL')
  .option('--proxy-port <port>', '代理端口', '9876')
  .option('--start-page <path>', '启动页面', '/')
  .option('--headless <bool>', '是否无头模式', 'true')
  .option('--no-body', '不采集 body')
  .option('--insecure', '关闭 HTTPS 证书校验')
  .option('--redact-body-fields <fields>', 'body 脱敏字段', 'password,token,phone,idCard')
  .option('--session-id <uuid>', '会话 ID')
  .option('--log-retention-days <days>', '日志保留天数', '7')
  .option('--enable-react-patch', '实验性：启用 React 渲染错误捕获')
  .action(async (opts) => {
    await runShield({
      project: opts.project,
      target: opts.target,
      proxyPort: Number(opts.proxyPort),
      startPage: opts.startPage,
      headless: opts.headless !== 'false',
      noBody: opts.body === false,
      insecure: opts.insecure ?? false,
      redactBodyFields: opts.redactBodyFields.split(',').map((s: string) => s.trim()),
      sessionId: opts.sessionId,
      logRetentionDays: Number(opts.logRetentionDays),
      enableReactPatch: opts.enableReactPatch ?? false,
    });
  });

program
  .command('quality')
  .description('执行提交前质量检查')
  .requiredOption('--project <path>', '老项目根路径')
  .option('--target <file>', '指定文件', (v: string, p: string[]) => { p.push(v); return p; }, [] as string[])
  .option('--base <ref>', 'git diff 基准')
  .option('--skip <step>', '跳过步骤', (v: string, p: string[]) => { p.push(v); return p; }, [] as string[])
  .option('--disable-rule <rule-id>', '禁用自定义规则', (v: string, p: string[]) => { p.push(v); return p; }, [] as string[])
  .option('--log-retention-days <days>', 'QualityLog 保留天数', '7')
  .option('--platform <platform>', '强制指定平台类型（web 或 h5）')
  .option('--enable-memory-monitor', '启用内存泄漏运行时监控')
  .option('--enable-resource-monitor', '启用资源加载运行时监控')
  .option('--start-page <path>', '运行时监控启动页面', '/')
  .option('--memory-threshold-percent <percent>', '内存泄漏判定阈值（百分比）', '30')
  .option('--resource-duration-threshold-ms <ms>', '资源加载长耗时阈值（毫秒）', '10000')
  .option('--resource-size-threshold-bytes <bytes>', '资源体积过大阈值（字节）', '1048576')
  .option('--resource-ignore-pattern <pattern>', '资源忽略模式', (v: string, p: string[]) => { p.push(v); return p; }, [] as string[])
  .option('--log-dir <path>', '结构化日志输出目录')
  .option('--structured-log-retention-days <days>', '结构化日志保留天数')
  .action(async (opts) => {
    const exitCode = await runQuality({
      project: opts.project,
      targets: opts.target,
      base: opts.base,
      skip: opts.skip,
      disabledRules: opts.disableRule,
      logRetentionDays: Number(opts.logRetentionDays),
      platform: opts.platform,
      enableMemoryMonitor: opts.enableMemoryMonitor ?? false,
      enableResourceMonitor: opts.enableResourceMonitor ?? false,
      startPage: opts.startPage,
      memoryThresholdPercent: Number(opts.memoryThresholdPercent),
      resourceDurationThresholdMs: Number(opts.resourceDurationThresholdMs),
      resourceSizeThresholdBytes: Number(opts.resourceSizeThresholdBytes),
      resourceIgnorePatterns: opts.resourceIgnorePattern,
      logDir: opts.logDir,
      structuredLogRetentionDays:
        opts.structuredLogRetentionDays !== undefined
          ? Number(opts.structuredLogRetentionDays)
          : undefined,
    });
    process.exitCode = exitCode;
  });

program
  .command('report')
  .description('生成分析报告')
  .requiredOption('--project <path>', '老项目根路径')
  .option('--date <date>', '日期')
  .option('--format <format>', '输出格式', 'md')
  .option('--out <path>', '输出路径')
  .action(async (opts) => {
    const format = opts.format;
    if (format !== 'md' && format !== 'json') {
      throw new Error(`非法输出格式: ${format}，仅支持 md 或 json`);
    }
    await runReport({
      project: opts.project,
      date: opts.date ?? today(),
      format,
      out: opts.out,
    });
  });

program
  .command('api')
  .description('启动 REST API 服务')
  .requiredOption('--project <path>', '老项目根路径')
  .option('--port <port>', '端口', '3456')
  .option('--cors', '启用 CORS')
  .action(async (opts) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`非法端口: ${opts.port}，必须是 0-65535 之间的整数`);
    }
    await runApi({
      project: opts.project,
      port,
      cors: opts.cors ?? false,
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
