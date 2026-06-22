# legacy-shield REST API 文档

`legacy-shield api` 子命令会启动一个本地 HTTP 服务，将运行日志、分析报告以 JSON 形式暴露给外部消费者（如 AI 智能体、IDE 插件、CI 流水线）。

## 启动方式

```bash
node ./dist/cli.js api --project /path/to/legacy --port 3456 --cors
```

- `--project`：老项目根路径（必填）。
- `--port`：监听端口，默认 `3456`。
- `--cors`：启用跨域，允许浏览器/插件直接调用。

启动成功后，控制台会输出：

```text
[legacy-shield] API 服务已启动: http://127.0.0.1:3456
```

按 `Ctrl+C` 可优雅关闭服务。

## 端点列表

| 方法 | 端点 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/logs` | 获取指定类型原始日志 |
| GET | `/report` | 获取分析报告 |
| GET | `/errors/top` | 获取高频错误 TOP N |
| GET | `/timeline` | 获取用户行为时间线 |
| POST | `/suggest` | 根据 errorId 生成 AI 修复提示词 |

所有端点（除 `/health` 外）均支持 `date` 查询参数，格式为 `YYYY-MM-DD`，默认当天。

## 通用响应格式

- 成功：返回 `200` 与对应 JSON 数据。
- 路径不存在：返回 `404 JSON`：`{ "error": "not found" }`。
- 参数错误：返回 `400 JSON`，如 `{ "error": "invalid date", "detail": "date must be YYYY-MM-DD" }`。
- 服务端异常：返回 `500 JSON`：`{ "error": "internal error", "detail": "..." }`。

## 端点详解

### GET /health

健康检查，确认服务与老项目关联正常。

#### 请求示例

```bash
curl -s http://127.0.0.1:3456/health
```

#### 响应示例

```json
{
  "ok": true,
  "project": "event"
}
```

### GET /logs

获取指定类型的原始日志。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | 否 | `runtime`、`network`、`behavior`、`quality`，默认 `runtime` |
| `date` | string | 否 | `YYYY-MM-DD`，默认当天 |

#### runtime 子类型说明

`type=runtime` 的日志条目通过 `subType` 字段区分错误来源。除 v1.1 ~ v1.3 已有子类型外，v1.4 新增 4 个 store 相关子类型：

| subType | 来源 | 关键 context 字段 | 典型示例 |
|---|---|---|---|
| `pinia-error` | Pinia 2.x action 同步 / 异步抛错（含 `$onAction` onError 回调） | `appId`、`storeId`、`actionName`、`args`（脱敏）、`stateKeys`、`stateSizeBytes`、`stateTruncated`、`stateUnserializable?` | `useUserStore().submit()` 内部抛错 |
| `pinia-plugin-error` | Pinia 插件 install / extend 阶段抛错 | `appId`、`pluginName?` | `pinia.use(badPlugin)` 安装失败 |
| `vuex-error` | Vuex 4 action / mutation / subscribe / subscribeAction 抛错 | `appId`、`modulePath`、`type`、`payload`（脱敏）、`stage`(`action`\|`mutation`\|`subscribeAction`\|`subscribe`)、`stateKeys`、`stateSizeBytes`、`stateTruncated`、`stateUnserializable?` | `store.dispatch('user/login')` 中抛错 |
| `vuex-strict-violation` | Vuex 4 strict mode 违规：在 mutation 外修改 state（基于 `_committing === false` 内部结构识别，不依赖 console 文本） | `appId`、`modulePath`、`mutatedKeyPath?`、`stateKeys`、`stateSizeBytes`、`stateTruncated`、`stateUnserializable?` | 在组件中直接 `store.state.user.name = 'x'` |

> `args` / `payload` / state 摘要均通过 `--redact-body-fields` 字段名单进行递归脱敏；state 摘要仅记录 keys 与字节数，不落盘完整值；JSON 序列化超过 64KB 时 `stateTruncated: true`。

#### 请求示例

```bash
curl -s "http://127.0.0.1:3456/logs?type=runtime&date=2026-06-18"
```

#### 响应示例

```json
{
  "type": "runtime",
  "date": "2026-06-18",
  "count": 3,
  "logs": [
    {
      "type": "runtime",
      "subType": "js-error",
      "sessionId": "...",
      "errorId": "abc123",
      "timestamp": "2026-06-18T10:00:00.000Z",
      "level": "error",
      "url": "/page-a",
      "userAgent": "Mozilla/5.0 ...",
      "message": "Cannot read property 'x' of undefined",
      "stack": "..."
    },
    {
      "type": "runtime",
      "subType": "pinia-error",
      "sessionId": "...",
      "errorId": "def456",
      "timestamp": "2026-06-18T10:00:01.000Z",
      "level": "error",
      "url": "/page-a",
      "userAgent": "Mozilla/5.0 ...",
      "message": "submit failed",
      "stack": "Error: submit failed\n    at submit ...",
      "context": {
        "appId": "app-1",
        "storeId": "user",
        "actionName": "submit",
        "args": [{ "password": "[REDACTED]" }],
        "stateKeys": ["profile", "token"],
        "stateSizeBytes": 128,
        "stateTruncated": false
      }
    },
    {
      "type": "runtime",
      "subType": "vuex-strict-violation",
      "sessionId": "...",
      "errorId": "ghi789",
      "timestamp": "2026-06-18T10:00:02.000Z",
      "level": "error",
      "url": "/page-b",
      "userAgent": "Mozilla/5.0 ...",
      "message": "[vuex] do not mutate vuex store state outside mutation handlers.",
      "stack": "...",
      "context": {
        "appId": "app-1",
        "modulePath": "user",
        "mutatedKeyPath": "user/name",
        "stateKeys": ["user", "cart"],
        "stateSizeBytes": 256,
        "stateTruncated": false
      }
    }
  ]
}
```

### GET /report

获取按日期聚合的完整分析报告。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `format` | string | 否 | `json` 或 `md`，默认 `json` |
| `date` | string | 否 | `YYYY-MM-DD`，默认当天 |

#### 请求示例

```bash
curl -s "http://127.0.0.1:3456/report?format=json&date=2026-06-18"
```

#### 响应示例（JSON 格式）

```json
{
  "format": "json",
  "date": "2026-06-18",
  "report": {
    "meta": {
      "project": "/path/to/legacy",
      "date": "2026-06-18",
      "generatedAt": "2026-06-18T12:00:00.000Z"
    },
    "summary": {
      "runtimeErrorCount": 5,
      "runtimeWarningCount": 2,
      "networkCount": 120,
      "networkIssueCount": 3,
      "behaviorCount": 45,
      "eslintIssueCount": 0,
      "testStatus": "unknown",
      "customRuleHitCount": 1
    },
    "topErrors": [...],
    "networkIssues": [...],
    "behaviorTimeline": [...],
    "qualitySummary": {...}
  }
}
```

> `summary.runtimeErrorCount` 与 `topErrors` 自 v1.4 起已纳入新的运行时错误子类型计数与聚合（`pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation`），与 v1.1 ~ v1.3 已有 `js-error` / `promise-rejection` / `vue-render-error` / `vue-router-error` 等保持一致的统计口径。

### GET /errors/top

获取按 `errorId` 聚合的高频错误 TOP N。

> 自 v1.4 起，聚合范围已包含 `pinia-error` / `pinia-plugin-error` / `vuex-error` / `vuex-strict-violation` 四类新子类型，与既有错误子类型采用相同的 `errorId + 1s` 窗口去重逻辑。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `limit` | number | 否 | 返回条数，默认 `10` |
| `date` | string | 否 | `YYYY-MM-DD`，默认当天 |

#### 请求示例

```bash
curl -s "http://127.0.0.1:3456/errors/top?limit=5&date=2026-06-18"
```

#### 响应示例

```json
{
  "date": "2026-06-18",
  "limit": 5,
  "errors": [
    {
      "errorId": "abc123",
      "subType": "js-error",
      "message": "Cannot read property 'x' of undefined",
      "source": "app.js:42",
      "url": "/page-a",
      "count": 12,
      "firstAt": "2026-06-18T09:00:00.000Z",
      "lastAt": "2026-06-18T11:00:00.000Z",
      "samples": [...]
    }
  ]
}
```

### GET /timeline

获取用户行为时间线，已按时间戳与 sequence 排序。

#### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `date` | string | 否 | `YYYY-MM-DD`，默认当天 |

#### 请求示例

```bash
curl -s "http://127.0.0.1:3456/timeline?date=2026-06-18"
```

#### 响应示例

```json
{
  "date": "2026-06-18",
  "count": 45,
  "timeline": [
    {
      "sequence": 1,
      "subType": "click",
      "timestamp": "2026-06-18T10:00:01.000Z",
      "pageUrl": "/page-a",
      "target": { "tagName": "BUTTON", "selector": "#submit" },
      "payload": {}
    }
  ]
}
```

### POST /suggest

根据 `errorId` 生成面向 AI 的修复提示词（prompt）。

#### 请求体

```json
{
  "errorId": "abc123"
}
```

#### 请求示例

```bash
curl -s -X POST "http://127.0.0.1:3456/suggest?date=2026-06-18" \
  -H "Content-Type: application/json" \
  -d '{"errorId":"abc123"}'
```

#### 响应示例

```json
{
  "errorId": "abc123",
  "date": "2026-06-18",
  "prompt": "请根据以下运行时错误信息，分析根因并给出修复建议：\n错误类型：js-error\n错误标识：abc123\n消息：Cannot read property 'x' of undefined\n..."
}
```

#### 错误响应

- `400`：请求体不是合法 JSON，或缺少 `errorId`。
- `404`：未找到对应 `errorId` 的错误样本。

## CORS 配置

默认情况下 API 不启用跨域。如需在浏览器或不同端口的插件中调用，启动时加上 `--cors`：

```bash
node ./dist/cli.js api --project /path/to/legacy --port 3456 --cors
```

启用后，响应头会包含：

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

前端可直接调用：

```javascript
fetch('http://127.0.0.1:3456/errors/top?limit=5')
  .then(r => r.json())
  .then(console.log);
```

## AI 智能体集成示例

AI 智能体可通过 `/suggest` 端点将运行时错误转换为可执行的修复建议。

### 示例：自动诊断高频错误

```javascript
async function diagnoseTopErrors(date, limit = 5) {
  const base = 'http://127.0.0.1:3456';

  // 1. 获取高频错误
  const topRes = await fetch(`${base}/errors/top?limit=${limit}&date=${date}`);
  const topData = await topRes.json();

  // 2. 为每个 errorId 生成 prompt
  const prompts = await Promise.all(
    topData.errors.map(async (err) => {
      const suggestRes = await fetch(`${base}/suggest?date=${date}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ errorId: err.errorId }),
      });
      return suggestRes.json();
    })
  );

  return prompts;
}

const date = new Date().toISOString().slice(0, 10);
diagnoseTopErrors(date).then(console.log);
```

### 示例：每日报告推送

```bash
#!/bin/bash
DATE=$(date +%Y-%m-%d)
REPORT=$(curl -s "http://127.0.0.1:3456/report?format=json&date=$DATE")
# 将 REPORT 推送到企业微信/飞书/钉钉机器人
curl -s -X POST "$WEBHOOK_URL" -H "Content-Type: application/json" \
  -d "{\"msg\": \"$REPORT\"}"
```

## 注意事项

1. API 服务仅监听 `127.0.0.1`，不对外暴露，适合本地开发环境使用。
2. 所有日志读取均为只读操作，不会修改 `.runtime-log-ignore/` 下的原始日志。
3. `date` 参数严格校验 `YYYY-MM-DD` 格式，非法日期会返回 `400`。
4. 当日志文件不存在时，`/logs`、`/report` 等端点会返回空数组/空报告，而不是 `404`。
