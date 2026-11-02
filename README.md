# z-app-agent

类 [atoms.dev](https://atoms.dev) 的应用生成智能体（P0）：自然语言 → Team Mode 多角色协作 → Vite/React 预览。

## 栈

- `apps/web` — Vite + React + TS + Tailwind
- `apps/server` — Hono + Node `sqlite` + 工具沙箱 + Preview 代理
- `packages/shared` — Brief / Card / Event zod schema
- LLM — **通用 OpenAI 兼容客户端**（默认 [ittoolplus](https://ittoolplus.cn/api/openai/v1/chat/completions) 免费聚合）

## 准备

```bash
cd /Users/zhangjianlong/workspace/myopz/z-app-agent
cp .env.example .env   # 按需修改
pnpm install
```

LLM 在仓库根目录 `.env` 配置（`apps/server` 启动时自动加载）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `LLM_BASE_URL` | `https://ittoolplus.cn/api/openai/v1` | OpenAI 兼容基址（含 `/v1`） |
| `LLM_MODEL` | `auto` | 模型名；ittoolplus 可用 `auto` |
| `LLM_API_KEY` | 空 | Bearer Key；免费聚合通常可不填 |
| `LLM_TIMEOUT_MS` | `90000` | 请求超时 |
| `LLM_EXTRA_HEADERS` | 空 | JSON 额外请求头（如 OpenRouter） |
| `PORT` | `39000` | 本服务端口 |
| `PUBLIC_BASE_PATH` | `/zapp` | 公网/本地 Web 路径前缀（Vite + Router + API） |
| `MAX_FIX_ATTEMPTS` | `3` | 构建修复上限 |

兼容别名：`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`。  
换 OpenAI、DeepSeek、SiliconFlow、OpenRouter 等只需改 base URL + key + model，见 `.env.example`。

实际请求：`POST {LLM_BASE_URL}/chat/completions`。

## 开发

前台（终端占用）：

```bash
pnpm dev
# web  http://127.0.0.1:39001/zapp/
# api  http://127.0.0.1:39000/healthz
# llm  http://127.0.0.1:39000/api/llm/status
# 公网 https://mac.ittoolplus.cn/zapp/（mac_conf/proxy/proxy-zapp.conf）
```

后台（`nohup`，pid/日志在 `.run/`）：

```bash
pnpm start      # 或 ./scripts/serve.sh start
pnpm status
pnpm logs       # Ctrl+C 退出 tail，不关服务
pnpm restart
pnpm stop
```

演示路径：首页新建项目 → 输入需求（Team/Build 或 Goal）→ 观察 Mike/Emma/Bob/Alex → Preview 面板 Load preview。

## 检查

```bash
pnpm typecheck
pnpm test
```

## 文档

- [docs/requirements.md](docs/requirements.md)
- [docs/architecture.md](docs/architecture.md)
- [.atoms/](.atoms/) 项目记忆

## 说明

- 项目真相源在 **server SQLite + `workspaces/`**；浏览器 IndexedDB 仅缓存消息/草稿/日志投影。
- Key 只放在服务端 `.env`，前端不持有。
- Sarah/Adrian 为 stub；Docker 沙箱与发布能力不在 P0。
