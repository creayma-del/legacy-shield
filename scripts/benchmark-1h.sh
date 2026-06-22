#!/bin/bash
# 1 小时日志体积 benchmark 脚本
# 前置条件：pnpm build 已完成，且老项目 dev server 已启动。
set -e

cd /Users/creayma/personal/legacy-shield

PROJECT=${SHIELD_BENCHMARK_PROJECT:-/Users/creayma/work/sichuan/event}
LOG_DIR=$PROJECT/.runtime-log-ignore
LIMIT=$((500 * 1024 * 1024))

echo "[benchmark] 启动 shield 1 小时监控..."
echo "[benchmark] PROJECT=$PROJECT"
echo "[benchmark] LOG_DIR=$LOG_DIR"

node ./dist/cli.js shield \
  --project "$PROJECT" \
  --target http://localhost:8080 \
  --headless true \
  --proxy-port 9876 &
PID=$!

shutdown() {
  echo ""
  echo "[benchmark] 收到中断信号，正在停止 shield (PID=$PID)..."
  kill -SIGINT "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
}

trap shutdown INT TERM

# 持续运行 1 小时
echo "[benchmark] 监控中，持续 3600 秒..."
sleep 3600

shutdown

# 计算当日所有 .jsonl 文件总大小
echo "[benchmark] 计算日志体积..."
TOTAL=0
if [ -d "$LOG_DIR" ]; then
  TOTAL=$(find "$LOG_DIR" -maxdepth 2 -name '*.jsonl' -exec stat -f%z {} + 2>/dev/null | awk '{s+=$1} END {print s}')
fi

# 兼容无日志的情况
TOTAL=${TOTAL:-0}

echo "[benchmark] 当日 .jsonl 总大小: $TOTAL bytes"

if [ "$TOTAL" -lt "$LIMIT" ]; then
  echo "PASS: total=$TOTAL bytes (limit=$LIMIT)"
else
  echo "FAIL: total=$TOTAL bytes exceeds limit=$LIMIT"
fi
