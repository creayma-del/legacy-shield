# T1：H5/Web 项目检测入口与配置适配

> 版本：v1.3
> 任务编号：T1
> 对应阶段 Spec：[phases/phase-v1.3-spec.md](phase-v1.3-spec.md)
> 对应设计文档：[design-v1.3.md](../design-v1.3.md)
> 对应执行计划：[execution-plan-v1.3.md](../execution-plan-v1.3.md)
> 依赖任务：无
> 状态：已完成，已归档
> 评审记录：见本文档末尾

---

## 1. 任务目标

实现 `lib/platform.ts`，支持显式指定与自动推断项目平台类型，并将平台信息传入后续监控流程；同步完成 `assertLegacyProject` 的 `allowNoSrc` 适配、`generateSessionId` 工具函数、CLI 参数扩展与结构化日志平台上下文写入。

---

## 2. 对应需求与验收标准

| 需求编号 | 需求描述 | 本任务验收标准 |
|---|---|---|
| REQ-1.3-1 | 监控对象覆盖 Web 端与移动端 H5 业务系统 | `detectPlatform` 可正确识别 H5/Web 项目；`--platform` 可显式覆盖自动推断结果 |
| REQ-1.3-8 | 保持现有 CLI 子命令接入方式 | 在 `quality` 子命令上新增 `--platform` 参数，不新增其他子命令 |
| REQ-1.3-2 | 监控结果以 NDJSON 结构化日志持久化 | 平台识别结果以 `category: 'platform'` 写入结构化日志 |

---

## 3. 实现步骤

### 3.1 创建 `lib/platform.ts`

- 定义 `PlatformType = 'web' | 'h5'`、`DetectPlatformOptions` 与 `DetectPlatformResult` 接口。
- 实现 `detectPlatform(options)`，返回 `{ platform, context }`：
  - 若 `explicit` 存在，`platform` 直接返回该值，`context` 中 `explicit: true`、`inferred: false`。
  - 否则按以下优先级推断：
    - P1：读取 `package.json` 的 `dependencies` / `devDependencies`：
      - 命中 H5 包名/前缀（`cordova`、`@dcloudio/uni-app`、`uni-app`、`@tarojs/taro`、`taro`、`@ionic/vue`、`@ionic/react`、`@ionic/angular`、`ionic`、`phonegap`）则 `platform` 为 `h5`；其中 `@tarojs/taro`/`taro` 指运行时框架依赖，不包含仅引用 `@tarojs/components` 等 UI 库的场景。
      - 命中 Web 包名/前缀（`next`、`nuxt`、`gatsby`）则 `platform` 为 `web`；`react-router-dom` 仅在同时存在服务端路由配置或 `pages/` 路由目录时才作为 `web` 辅助判定依据。
    - P2：扫描入口 HTML 文件（优先 `index.html`，其次 `public/index.html`，最后 `src/index.html`），解析 `<meta name="viewport">` 的 `content`；同时包含 `width=device-width` 与 `initial-scale` 时，若存在 `maximum-scale` 或 `user-scalable=no` 等移动端常见属性则 `platform` 为 `h5`，否则 `platform` 为 `web`（置信度低）。
    - P3：检查项目根目录是否存在 `manifest.json`，存在则作为 `web` 辅助参考。
    - P4：默认回退为 `web`。
  - `context` 中记录 `inferred`、`explicit`、命中策略 `strategy`、相关包名 `packageName`、viewport 内容 `viewportContent` 等推断依据。

### 3.2 扩展 `assertLegacyProject`

- 在 `lib/utils.ts` 的 `assertLegacyProject(projectPath, options?)` 中增加 `allowNoSrc?: boolean` 可选参数。
- 当 `allowNoSrc === true` 时，跳过 `src/` 目录强制检查，`package.json` 存在性校验保持不变。

### 3.3 新增 `generateSessionId()`

- 在 `lib/utils.ts` 中新增 `generateSessionId()` 函数。
- 格式：`shield_<timestamp>_<randomSuffix>`，其中 `timestamp` 为当前时间戳，`randomSuffix` 为 4 位随机字符（字母+数字）。
- `shield` 子命令保持现有 `generateId()` 行为不变。

### 3.4 扩展 CLI 参数与 `QualityCommandOptions`

- 在 `cli.ts` 的 `quality` 子命令中新增 `--platform <type>` 参数定义。
- 在 `lib/cli/quality.ts` 的 `QualityCommandOptions` 类型中新增 `platform?: 'web' | 'h5'`。
- 在 `runQuality` 中透传 `platform` 参数。

### 3.5 在 `runQuality` 中编排平台识别与日志记录

- 在 `runQuality` 中先生成 `sessionId`。
- 判断是否启用 v1.3 路径（用户显式传入 `--platform`、或传入 `--enable-memory-monitor`、或传入 `--enable-resource-monitor`、或传入 `--log-dir`、或传入 `--structured-log-retention-days`）。
- 未启用 v1.3 路径时：调用原有 `assertLegacyProject(project)`，创建 QualityLog，不再调用 `detectPlatform`。
- 启用 v1.3 路径时：调用 `detectPlatform({ projectPath, explicit: options.platform })` 获取 `{ platform, context }`；根据 `platform` 调用 `assertLegacyProject(project, { allowNoSrc: true })`；创建 QualityLog + StructuredLogger；将平台识别结果封装为 `category: 'platform'` 的 `StructuredLogEntry`，调用 `logger.logStructured(entry)` 写入日志，`context` 包含 `DetectPlatformResult.context` 中的推断依据、`inferred` 标记、`explicit` 标记。

### 3.6 新增测试夹具与单元测试

- 在 `tests/fixtures/` 下新增 H5/Web 项目夹具：
  - H5 夹具：`package.json` 包含 `uni-app` 依赖；或入口 HTML viewport 包含移动端属性。
  - Web 夹具：普通 Web 项目结构。
- 新增 `tests/platform.test.ts`：覆盖显式指定、H5 自动推断、Web 自动推断、默认回退、推断依据记录。

---

## 4. 测试计划

### 4.1 单元测试

- `detectPlatform({ projectPath, explicit: 'h5' })` 返回 `h5`。
- 对无显式参数的 Web 项目自动推断为 `web`。
- 对典型 H5 项目（含 `uni-app` 依赖）自动推断为 `h5`。
- 对无 `src/` 目录但含 `package.json` 的 Web/H5 项目，`assertLegacyProject(project, { allowNoSrc: true })` 不抛错。
- `generateSessionId()` 返回值符合 `shield_<timestamp>_<randomSuffix>` 格式。

### 4.2 集成测试 / 端到端测试

- 在临时目录构造 H5/Web 项目夹具，运行 `node ./dist/cli.js quality --project <dir> --platform <type>`，验证平台识别不阻塞流程。
- 验证平台识别日志以 `category: 'platform'` 写入结构化日志。

### 4.3 回归测试

- 未启用任何 v1.3 新参数时，`quality` 子命令不调用 `detectPlatform`，使用原有 `assertLegacyProject(project)` 校验逻辑，行为与 v1.2 完全一致（包括退出码）。
- `shield` 子命令的 `generateId()` 行为不受影响。

---

## 5. 风险与依赖

| 风险 / 依赖 | 影响 | 应对措施 |
|---|---|---|
| 无前置依赖 | 本任务为首个任务 | 按计划直接开发 |
| 自动推断误识别 | 后续规则与采集策略不匹配 | 提供 `--platform` 显式覆盖；在结构化日志中记录推断依据 |
| `src/` 跳过导致老项目校验变宽松 | 可能影响 v1.2 行为 | 仅在显式指定 `--platform` 或 `detectPlatform` 推断为 `web`/`h5` 时启用 `allowNoSrc` |

---

## 6. 变更范围

- 本任务不实现静态规则、运行时采集、结构化日志写入的具体逻辑（由 T2-T7 处理）。
- 本任务不修改 `lib/quality.ts` 内部实现，仅扩展 `lib/cli/quality.ts` 的入参与编排。
- 本任务不修改 `shield` 子命令的 ID 生成逻辑。

---

## 7. 评审记录

> 评审日期：2026-06-21
> 评审结论：通过
> 评审人：SPEC 动态评审团

### P0 阻塞缺陷

| 编号 | 问题描述 | 位置 | 修订建议 |
|---|---|---|---|
| - | - | - | - |

### P1 重要问题

| 编号 | 问题描述 | 位置 | 修订建议 |
|---|---|---|---|
| - | - | - | - |

### P2 优化项

| 编号 | 问题描述 | 位置 | 处理建议 |
|---|---|---|---|
| - | - | - | - |
