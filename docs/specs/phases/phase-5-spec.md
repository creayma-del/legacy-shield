# legacy-shield 阶段 5 详细 Spec：集成测试与验收

> 文档版本：v1.0
> 对应需求文档：[requirements.md](../requirements.md)
> 对应设计文档：[design.md](../design.md)
> 对应执行计划：[execution-plan.md](../execution-plan.md) 阶段 5
> 状态：已完成，已归档（冻结，不再修改）

---

## 1. 阶段目标

在真实老项目和模拟边界场景上验证 legacy-shield 的完整流程，确保 shield → report → quality → api 全链路可用，并补充用户文档。阶段结束时，legacy-shield 达到可交付状态。

### 1.1 阶段交付物

| 交付物 | 路径 | 说明 |
|---|---|---|
| 端到端场景验证（自动集成） | `tests/e2e/shield.e2e.test.ts` | 自动构造模拟老项目，验证 shield 采集链路可正常生成 runtime/network/behavior 日志 |
| 边界情况测试（全自动） | `tests/e2e/boundary.test.ts` | 异常路径测试；不依赖外部日志，可独立运行 |
| 性能基线测试（全自动/手动） | `tests/e2e/performance.test.ts` + 手动 benchmark | 延迟与资源占用；自动化测试做 smoke，关键基线可手动复测 |
| 用户文档 | `README.md`、`docs/usage.md`、`docs/api.md`、`docs/custom-rules.md` | 使用与开发指南 |
| 验收报告 | `docs/specs/acceptance-report.md`（可选） | 阶段 5 验收结论 |

### 测试归类说明

- **自动集成 E2E 验证**：`shield.e2e.test.ts` 自动构造模拟老项目，启动 shield 并操作浏览器，最后断言日志已正确生成。
- **全自动边界测试**：`boundary.test.ts` 使用 `spawnSync` 直接调用 CLI，覆盖非法路径、空日志 report 等异常路径，可随 `pnpm test` 全量执行。
- **性能基线测试**：`performance.test.ts` 做自动化 smoke（代理延迟 < 10ms）；1 小时运行体积、事件处理耗时等长时指标采用手动 benchmark 记录。

### 1.2 阶段边界

- **范围内**：端到端测试、边界测试、性能基线、文档完善。
- **范围外**：新增功能、架构调整。

---

## 2. 任务 5.1：端到端场景验证（自动集成）

### 2.1 目标

通过自动集成测试验证 shield 采集链路在模拟老项目上可正常工作。

### 2.2 测试场景

测试脚本自动构造一个符合老项目结构的最小项目（含 `package.json` 与 `src` 目录），然后：

1. 自动构造模拟目标页面并通过 shield 访问。
2. 在 headless 浏览器中触发点击、console.error 等操作。
3. 停止 shield。
4. 断言 runtime、network、behavior 日志已生成。

> 前置条件：已执行 `pnpm install` 和 `pnpm build`。

### 2.3 测试步骤

运行自动集成测试：

```bash
cd /Users/creayma/personal/legacy-shield
pnpm test tests/e2e/shield.e2e.test.ts
```

测试内部会自动完成模拟老项目构造、shield 启动、浏览器操作、日志断言与临时目录清理。

### 2.4 验收标准

- [ ] shield 采集到日志。
- [ ] runtime、network、behavior 三类日志均非空。
- [ ] 所有日志写入 `<legacy>/.runtime-log-ignore/` 下对应目录。
- [ ] 测试结束后进程与临时目录被清理。

### 2.5 测试用例

完整实现见 [tests/e2e/shield.e2e.test.ts](../../../../tests/e2e/shield.e2e.test.ts)。

关键逻辑：

- `beforeAll` 构造临时老项目、启动模拟目标 server、在子进程中启动 `shield`。
- 若本地未安装 Playwright Chromium，自动设置 `PLAYWRIGHT_CHROMIUM_CHANNEL=chrome` 回退到系统 Chrome。
- `afterAll` 发送 `SIGINT` 停止 shield、关闭 server、删除临时目录。
- 用例断言：
  - `runtime` 日志存在且至少包含一条 `subType === 'console-error'`。
  - `network` 日志存在且至少包含一条 `method === 'GET'`。
  - `behavior` 日志存在且至少包含一条 `subType === 'click'`。

---

## 3. 任务 5.2：边界情况测试

### 3.1 目标

验证工具在异常输入和环境下的行为。

### 3.2 测试项

`boundary.test.ts` 覆盖以下全自动边界场景：

| 测试项 | 输入 | 期望行为 |
|---|---|---|
| 老项目路径不存在 | `--project /nonexistent` | 清晰错误提示，退出码 1 |
| 老项目缺少 package.json | 临时空目录 | 清晰错误提示，退出码 1 |
| 老项目缺少 src/ | 临时目录仅含 package.json | 清晰错误提示，退出码 1 |
| 无日志时 report | 清空日志目录后运行 report | 生成空报告，不崩溃，退出码 0 |
| 无效日期格式 | `--date not-a-date` | 按不存在日志处理，生成空报告，不崩溃，退出码 0 |
| API 请求不存在端点 | `GET /notfound` | 返回 404 JSON |
| API 请求无效 JSON | `POST /suggest` with `not json` | 返回 400 JSON |

> 注：大 body 请求、代理延迟与 report 生成耗时等场景由 `performance.test.ts` 覆盖；浏览器启动与采集链路覆盖由 `shield.e2e.test.ts` 覆盖；长时间运行体积由手动 benchmark 覆盖。代理端口被占用等场景通过 shield 内置的端口自增逻辑处理，不重复列入本文件。

### 3.3 验收标准

- [ ] 老项目路径不存在时的错误提示清晰。
- [ ] 老项目缺少 package.json 或 src 时的错误提示清晰。
- [ ] 无日志时 report 命令不崩溃。
- [ ] 无效日期格式时 report 命令不崩溃。
- [ ] API 不存在端点返回 404 JSON。
- [ ] API 非法 JSON 返回 400 JSON。

### 3.4 测试用例

完整实现见 [tests/e2e/boundary.test.ts](../../../../tests/e2e/boundary.test.ts)。

关键逻辑：

- 使用 `spawnSync` 直接调用 CLI，覆盖非法路径、缺少 `package.json`、缺少 `src/` 等启动前校验。
- 对 `report` 命令覆盖空日志与无效日期两种边界，断言退出码为 `0` 且报告文件已生成。
- 对 API 服务使用静态导入的 `startApiServer`，直接断言 404 与 400 响应。
- 每个临时目录在 `finally` 块中清理。

---

## 4. 任务 5.3：性能基线测试

### 4.1 目标

建立关键性能指标基线。

### 4.2 测试项

| 测试项 | 目标值 | 测试方法 |
|---|---|---|
| 代理转发延迟 | < 5ms（不含 body 大流量场景） | 对比直接请求与代理请求的耗时差 |
| 单次事件处理耗时 | < 1ms | 在注入脚本中测量 `performance.now()` 差值 |
| 1 小时运行后日志文件大小 | 可接受（< 500MB） | 持续运行 1 小时，观察日志大小 |
| 大 body 截断 | 64KB 阈值生效 | 发送 100KB 请求 body |
| report 生成时间 | < 5s（10 万条日志） | 生成 10 万条模拟日志后运行 report |

### 4.3 测试方法

#### 4.3.1 代理延迟

```bash
# 1. 启动目标 server
node -e "require('http').createServer((req,res)=>res.end('ok')).listen(8080)"

# 2. 直接请求耗时
time curl -s http://localhost:8080/

# 3. 通过 shield 代理请求耗时
# 启动 shield 后执行
time curl -s --proxy http://localhost:9876 http://localhost:8080/
```

#### 4.3.2 事件处理耗时

事件处理耗时指注入脚本中单个事件回调（错误捕获、console 补丁、行为采集等）的执行时间。目标 < 1ms。

验证方式（手动）：

1. 在浏览器 DevTools Performance 面板中录制页面操作。
2. 过滤 `inject.iife.js` 相关调用栈，观察事件回调（如 `error`、`click`、`input` 处理函数）的执行耗时。
3. 或在 `lib/inject.iife.ts` 中临时插入 `performance.now()` 采样：

```js
const t0 = performance.now();
// 事件处理逻辑
const t1 = performance.now();
if (t1 - t0 > 1) {
  console.warn('[shield] slow event handler', t1 - t0);
}
```

> 注：生产构建不内置采样逻辑，避免增加运行时开销。自动化测试通过代理延迟与 report 生成时间间接保证性能基线。

#### 4.3.3 1 小时日志体积（手动 benchmark）

使用 [scripts/benchmark-1h.sh](../../../../scripts/benchmark-1h.sh) 在真实老项目上连续运行 1 小时。前置条件：`pnpm build` 已完成，且老项目 dev server 已启动。

脚本要点：

- 后台启动 `shield`，持续监控 3600 秒。
- 捕获 `INT` / `TERM` 信号，向 shield 发送 `SIGINT` 优雅退出。
- 使用 `stat -f%z` 计算当日所有 `.jsonl` 文件总大小（当前实现针对 macOS；在 Linux 上可替换为 `stat -c%s` 或 `wc -c`）。
- 判定：当日日志总量 < 500MB。

### 4.4 验收标准

- [ ] 代理转发延迟目标 < 5ms（headers-only 模式）；自动化 smoke 测试允许本地波动，阈值放宽至 < 10ms。
- [ ] 单次事件处理耗时 < 1ms。
- [ ] 1 小时运行后日志文件大小可接受（< 500MB）。

### 4.5 测试用例

完整实现见 [tests/e2e/performance.test.ts](../../../../tests/e2e/performance.test.ts)。

关键逻辑：

- 使用 `closeResources` 辅助函数统一关闭 proxy、目标 server 与 logger，避免资源泄漏。
- `proxy overhead` 用例：空 body 场景下采样 20 次代理请求，平均耗时 < 10ms（目标 < 5ms，允许本地波动）。
- `truncates large request body` 用例：发送 100KB body，断言 `request.bodyTruncated` 为 `true`。
- `generates report within 5s` 用例：构造 10 万条 runtime 日志，断言 `report` 命令在 5 秒内完成。

---

## 5. 任务 5.4：文档完善

### 5.1 目标

补充用户文档，使其他开发者能够独立使用 legacy-shield。

### 5.2 文档清单

#### 5.2.1 `README.md`

包含：
- 项目简介
- 安装步骤
- 快速开始（shield/quality/report/api）
- 命令参数参考
- 与 code-quality 的关系
- 注意事项（日志目录、隐私、Node 版本）

#### 5.2.2 `docs/usage.md`

详细使用指南：
- 环境准备
- shield 命令详解
- quality 命令详解
- report 命令详解
- api 命令详解
- 常见问题排查

#### 5.2.3 `docs/api.md`

API 文档：
- 启动方式
- 端点列表
- 请求/响应示例
- CORS 配置
- 与 AI 智能体集成的示例

#### 5.2.4 `docs/custom-rules.md`

自定义规则开发指南：
- 规则结构
- AST 遍历示例
- 注册新规则步骤
- 测试规则方法

### 5.3 验收标准

- [ ] `README.md` 使用说明完整。
- [ ] `docs/usage.md` 详细使用指南覆盖所有子命令。
- [ ] `docs/api.md` API 文档包含所有端点示例。
- [ ] `docs/custom-rules.md` 自定义规则开发指南可跟随执行。

---

## 6. 阶段 5 集成验收

### 6.1 验收清单

- [ ] 端到端场景验证（自动集成）通过（任务 5.1）：`shield.e2e.test.ts` 随 `pnpm test` 全量通过。
- [ ] 边界情况测试通过（任务 5.2）：`boundary.test.ts` 随 `pnpm test` 全量通过。
- [ ] 性能基线达标（任务 5.3）：自动化 smoke 通过，手动 benchmark 指标符合 4.2 节目标值。
- [ ] 文档完善（任务 5.4）。

### 6.2 最终验收标准

以下全部满足后，legacy-shield MVP 视为验收通过：

1. `pnpm test` 全量通过（含单元测试、阶段 2-4 集成测试、阶段 5 自动集成/边界/性能 smoke 测试）。
2. `tests/e2e/shield.e2e.test.ts` 在自动构造的模拟老项目上启动 shield，断言 runtime、network、behavior 日志均已生成。
3. 所有子命令 help 信息完整。
4. 日志文件结构符合设计。
5. 报告和 API 输出符合 schema。
6. 文档齐全，新用户可独立上手。

### 6.3 最终交付验证命令

前置条件：`pnpm install && pnpm build` 已完成。

```bash
cd /Users/creayma/personal/legacy-shield
pnpm test
node ./dist/cli.js --help
node ./dist/cli.js shield --help
node ./dist/cli.js quality --help
node ./dist/cli.js report --help
node ./dist/cli.js api --help
```

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 |
|---|---|---|
| 真实老项目环境不可用 | 高 | 提前确认 dev server 可启动；准备备用模拟项目 |
| 性能基线不达标 | 中 | 优化代理 body 处理；提供 `--no-body` 模式 |
| 文档遗漏关键步骤 | 中 | 按模板逐项检查；邀请他人试用 |
| 长时间运行测试耗时 | 中 | 性能测试可改为 10 分钟采样估算 |

---

## 8. 依赖关系

- **前置依赖**：阶段 1、2、3、4 全部完成。
- **后续依赖**：无。阶段 5 为 MVP 最终验收阶段。
