#!/usr/bin/env bash
# z-app-agent 后台进程：start | stop | restart | status | logs
# 管理 server(API) + web(Vite) 两个进程。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${ROOT}/.run"
PID_SERVER="${RUN_DIR}/server.pid"
PID_WEB="${RUN_DIR}/web.pid"
LOG_SERVER="${RUN_DIR}/server.log"
LOG_WEB="${RUN_DIR}/web.log"

mkdir -p "${RUN_DIR}"
cd "${ROOT}"

# 从仓库根 .env 读 KEY（不覆盖已有环境变量）
load_dotenv() {
  local file="${ROOT}/.env"
  [[ -f "${file}" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value:1:${#value}-2}"
    fi
    if [[ -n "${key}" && -z "${!key+x}" ]]; then
      export "${key}=${value}"
    fi
  done <"${file}"
}

load_dotenv
SERVER_PORT="${PORT:-39000}"
WEB_PORT="${WEB_PORT:-39001}"
# 与 Vite PUBLIC_BASE_PATH 一致；默认 /zapp
PUBLIC_BASE_PATH="${PUBLIC_BASE_PATH:-/zapp}"
PUBLIC_BASE_PATH="/${PUBLIC_BASE_PATH#/}"
PUBLIC_BASE_PATH="${PUBLIC_BASE_PATH%/}"
[[ "${PUBLIC_BASE_PATH}" == "/" ]] && PUBLIC_BASE_PATH=""
WEB_BASE_URL="http://127.0.0.1:${WEB_PORT}${PUBLIC_BASE_PATH}/"

require_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "ERROR: pnpm not found in PATH" >&2
    exit 1
  fi
}

is_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

pid_from_file() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    tr -d '[:space:]' <"${file}"
  fi
}

listeners_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
  elif command -v ss >/dev/null 2>&1; then
    ss -lptn "sport = :${port}" 2>/dev/null \
      | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' \
      | sort -u || true
  fi
}

# 杀掉 pid 及其直接子进程（pnpm/tsx/vite 常有子进程）
kill_tree() {
  local pid="$1"
  [[ -z "${pid}" ]] && return 0
  local kids
  kids="$(pgrep -P "${pid}" 2>/dev/null || true)"
  if [[ -n "${kids}" ]]; then
    local kid
    for kid in ${kids}; do
      kill_tree "${kid}"
    done
  fi
  kill "${pid}" 2>/dev/null || true
}

wait_dead() {
  local pid="$1"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    is_running "${pid}" || return 0
    sleep 0.3
  done
  if is_running "${pid}"; then
    kill -9 "${pid}" 2>/dev/null || true
    local kids
    kids="$(pgrep -P "${pid}" 2>/dev/null || true)"
    if [[ -n "${kids}" ]]; then
      # shellcheck disable=SC2086
      kill -9 ${kids} 2>/dev/null || true
    fi
  fi
}

free_port() {
  local port="$1"
  local pids
  pids="$(listeners_on_port "${port}")"
  [[ -z "${pids}" ]] && return 0
  echo "Port ${port} in use by: ${pids}"
  # shellcheck disable=SC2086
  kill ${pids} 2>/dev/null || true
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    pids="$(listeners_on_port "${port}")"
    [[ -z "${pids}" ]] && break
    sleep 0.3
  done
  pids="$(listeners_on_port "${port}")"
  if [[ -n "${pids}" ]]; then
    # shellcheck disable=SC2086
    kill -9 ${pids} 2>/dev/null || true
    sleep 0.2
  fi
  if [[ -n "$(listeners_on_port "${port}")" ]]; then
    echo "ERROR: failed to free port ${port}" >&2
    exit 1
  fi
}

stop_one() {
  local name="$1"
  local pid_file="$2"
  local port="$3"
  local pid
  pid="$(pid_from_file "${pid_file}" || true)"
  if [[ -n "${pid}" ]] && is_running "${pid}"; then
    kill_tree "${pid}"
    wait_dead "${pid}"
  fi
  rm -f "${pid_file}"
  free_port "${port}"
  echo "${name}: stopped"
}

start_server() {
  local pid
  pid="$(pid_from_file "${PID_SERVER}" || true)"
  if [[ -n "${pid}" ]] && is_running "${pid}"; then
    echo "server: already running pid=${pid}"
    return 0
  fi
  free_port "${SERVER_PORT}"
  # 后台不用 tsx watch，避免无用文件监听
  nohup pnpm --filter @z-app-agent/server start >>"${LOG_SERVER}" 2>&1 &
  echo $! >"${PID_SERVER}"
  sleep 0.8
  if ! is_running "$(pid_from_file "${PID_SERVER}")"; then
    echo "ERROR: server failed to start; see ${LOG_SERVER}" >&2
    exit 1
  fi
  echo "server: started pid=$(pid_from_file "${PID_SERVER}") port=${SERVER_PORT} log=${LOG_SERVER}"
}

start_web() {
  local pid
  pid="$(pid_from_file "${PID_WEB}" || true)"
  if [[ -n "${pid}" ]] && is_running "${pid}"; then
    echo "web: already running pid=${pid}"
    return 0
  fi
  free_port "${WEB_PORT}"
  nohup pnpm --filter @z-app-agent/web dev >>"${LOG_WEB}" 2>&1 &
  echo $! >"${PID_WEB}"
  sleep 0.8
  if ! is_running "$(pid_from_file "${PID_WEB}")"; then
    echo "ERROR: web failed to start; see ${LOG_WEB}" >&2
    exit 1
  fi
  echo "web: started pid=$(pid_from_file "${PID_WEB}") port=${WEB_PORT} log=${LOG_WEB}"
}

cmd_start() {
  require_pnpm
  if [[ ! -d "${ROOT}/node_modules" ]]; then
    echo "node_modules missing; running pnpm install..."
    pnpm install
  fi
  start_server
  start_web
  echo "ready  web=${WEB_BASE_URL}  api=http://127.0.0.1:${SERVER_PORT}/healthz"
}

cmd_stop() {
  stop_one "web" "${PID_WEB}" "${WEB_PORT}"
  stop_one "server" "${PID_SERVER}" "${SERVER_PORT}"
}

cmd_restart() {
  cmd_stop || true
  cmd_start
}

status_one() {
  local name="$1"
  local pid_file="$2"
  local port="$3"
  local log="$4"
  local pid
  pid="$(pid_from_file "${pid_file}" || true)"
  if [[ -n "${pid}" ]] && is_running "${pid}"; then
    echo "${name}: running pid=${pid} port=${port} log=${log}"
    return 0
  fi
  local listeners
  listeners="$(listeners_on_port "${port}")"
  if [[ -n "${listeners}" ]]; then
    echo "${name}: port ${port} busy pids=${listeners} (no pidfile)"
    return 0
  fi
  echo "${name}: stopped"
  return 1
}

cmd_status() {
  local ok=0
  status_one "server" "${PID_SERVER}" "${SERVER_PORT}" "${LOG_SERVER}" || ok=1
  status_one "web" "${PID_WEB}" "${WEB_PORT}" "${LOG_WEB}" || ok=1
  return "${ok}"
}

cmd_logs() {
  local which="${1:-all}"
  case "${which}" in
    server)
      [[ -f "${LOG_SERVER}" ]] || { echo "no server log yet"; exit 1; }
      tail -n 80 -f "${LOG_SERVER}"
      ;;
    web)
      [[ -f "${LOG_WEB}" ]] || { echo "no web log yet"; exit 1; }
      tail -n 80 -f "${LOG_WEB}"
      ;;
    all|*)
      touch "${LOG_SERVER}" "${LOG_WEB}"
      echo "==> tail -f ${LOG_SERVER} ${LOG_WEB}"
      tail -n 40 -f "${LOG_SERVER}" "${LOG_WEB}"
      ;;
  esac
}

case "${1:-}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart ;;
  status) cmd_status ;;
  logs) cmd_logs "${2:-all}" ;;
  *)
    echo "usage: $0 {start|stop|restart|status|logs [server|web|all]}" >&2
    exit 2
    ;;
esac
