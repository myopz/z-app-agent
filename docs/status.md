# z-app-agent 项目状态与路线图

> 更新日期：2026-11-02  
> 对照：[requirements.md](./requirements.md) · [architecture.md](./architecture.md)  
> 说明：✅ 已落地可用 · 🔶 部分落地 / 粗糙 · ❌ 未做 · 🔧 stub

---

## 1. 一句话现状

P0 主路径已可演示：**自然语言 → Team Mode（Mike→Emma→Bob→Alex）→ 工作区 Vite/React → 预览 iframe**。  
本地后台脚本 + `mac.ittoolplus.cn/zapp` 反代已接通；LLM 可热切换（ittoolplus / DeepSeek / OpenAI 等）。  
质量上已用**确定性门禁**兜住「裸 HTML 无样式」等常见撒谎，但仍有不少 P0 能力偏粗或仅接口位。

---

## 2. 已完成（相对稳定）

### 2.1 运行与接入

| 项 | 状态 | 备注 |
|----|------|------|
| monorepo（web / server / shared） | ✅ | pnpm workspace |
| `.env` 通用 OpenAI 兼容 LLM | ✅ | `LLM_BASE_URL` / `KEY` / `MODEL` |
| `/healthz`、`/api/llm/status` | ✅ | |
| 后台 `scripts/serve.sh`（start/stop/restart/status/logs） | ✅ | pid/日志在 `.run/` |
| `PUBLIC_BASE_PATH=/zapp` 子路径部署 | ✅ | Vite base + Router + API/preview 前缀 |
| OpenResty `mac_conf/proxy/proxy-zapp.conf` | ✅ | `https://mac.ittoolplus.cn/zapp/` |
| 预览进程 base 对齐公网前缀 | ✅ | `/zapp/preview/:id/`；allowedHosts；预热 main.tsx |

### 2.2 产品主路径

| 项 | 状态 | 备注 |
|----|------|------|
| 新建项目 / 列表 / 删除 | ✅ | SQLite + workspaces |
| Build / Goal 双模式 | ✅ | Goal → Plan card |
| Team Mode 主 SOP | ✅ | Mike → Emma → Bob → Alex |
| question / plan / tool / version / issue 卡片 | ✅ | |
| `@` 点名（如 `@alex`） | ✅ | 可走 Engineer 捷径 |
| 消息队列 + Stop + Resume | ✅ | checkpoint 持久化 |
| 工具：list/read/write/edit/run/install/build/preview | ✅ | 路径沙箱 |
| install → build → preview 自动闭环 | ✅ | 失败进 Fix Loop |
| Patch + Snapshot；Revert / Restore | ✅ | |
| 工作区内 `.atoms/*.md` 记忆 | ✅ | 由角色 write_file 维护 |
| Terminal ≠ Console 分流 | ✅ | SSE + 预览日志 |
| 文件树 + 代码只读查看 | ✅ | |
| UI 视觉质量门禁（Tailwind / 禁裸控件） | ✅ | `quality/app-ui.ts`；Alex 后 + verify 强制 |

### 2.3 角色

| 角色 | 状态 | 备注 |
|------|------|------|
| Mike / Emma / Bob / Alex | ✅ | 主路径可用 |
| David | 🔶 | 有工具面；调度偏弱 |
| Iris | 🔶 | `web_search` 未接通，会声明假设 |
| Sarah / Adrian | 🔧 | stub，明确未接通 |

---

## 3. 部分完成 / 已知粗糙点

| 项 | 状态 | 问题 |
|----|------|------|
| Engineer Mode | 🔶 | API/DB 支持 `collab_mode=engineer`；首页默认写死 `team`，UI 切换弱 |
| `#` 文件引用 | ❌/🔶 | 需求写了 P0；实现基本未做（仅 `@`） |
| 记忆压缩（摘要） | 🔶 | 有截断/组装；独立「摘要调用」弱 |
| Mode Guard / 非法组合拒绝 | 🔶 | 编排有分支，专门 Guard 模块弱 |
| Iris / David 条件派工 | 🔶 | 未形成稳定自动路由 |
| Preview HMR | 🔶 | 多级反代下关闭 HMR；靠刷新预览 |
| 假 LLM 编排单测 | 🔶 | 有工具/质量单测；全链路编排 mock 不足 |
| 控制台设计系统 | 🔶 | Tailwind 自研组件，非完整 shadcn 套件 |
| 仓库根 `.atoms/` 项目记忆 | ❌ | 需求提到；目录缺失（工作区项目内有） |
| 并发项目数限制 | 🔶 | 无严格配额；靠本机资源 |

---

## 4. 未完成（按优先级）

### P0 缺口（建议补齐后再宣称「P0 DoD 全绿」）

| 项 | 说明 |
|----|------|
| `#path` 文件引用 | 对话里引用工作区文件进入上下文 |
| Engineer Mode UI | 首页/项目页可切换 Team ↔ Engineer |
| 验收自动化补强 | 预览 DOM/截图级冒烟（不仅静态读 App.tsx） |
| 编排集成测试 | 假 LLM 跑完 Mike→Alex→verify 路径 |
| 文档/记忆同步 | 根目录 `.atoms` + 本 status 持续维护 |

### P1

| 项 | 说明 |
|----|------|
| Docker / 更强沙箱 | 替代纯本机目录隔离 |
| 导出源码 ZIP | US-11 |
| `web_search` 实装 | Iris 深研可用 |
| 深研工作流 `deep_research` | 强制 Iris |
| Keys / 模型引用 `#` | 密钥不进前端 |
| 文件树可编辑 | 只读 → 可写 |
| 多专家有限并行 | 现串行交接 |
| 假 LLM + e2e | CI 稳定性 |

### P2+

| 项 | 说明 |
|----|------|
| 一键发布 / 预览子域 | US-12 |
| Database / Auth / Storage | US-13 |
| Remix / Discover / 多用户 | |
| SEO / Ads 实装 | Sarah / Adrian |
| 计量 / Credits | |
| Postgres 迁移 | SQLite 够用前不急 |

---

## 5. 后续计划（建议顺序）

### 近一周（巩固 P0）

1. **补 `#` 文件引用**与 Engineer Mode 开关 UI。  
2. **预览冒烟**：`ensurePreview` 后探测关键选择器或 HTTP+内容断言。  
3. **假 LLM 编排测试**：固定 fence/tool_call 脚本跑通主路径。  
4. 保持 **UI 质量门禁**；按真实失败样例扩充 `localAcceptanceGaps`（勿堆特例）。  
5. README / 本文件与代码同步（端口、`/zapp`、LLM 示例）。

### 接下来 2～4 周（P1 起步）

1. 导出 ZIP；`web_search` 接可用上游。  
2. 沙箱加固（命令白名单 / 资源限制；评估 Docker）。  
3. 消息与 checkpoint 在异常路径的可观测性（结构化日志）。  
4. 控制台交互打磨（队列可视化、Stop/Resume 状态更清晰）。

### 更后（P2）

发布托管、云能力子集、多用户——在 P0 演示稳定与迭代成功率上去后再开。

---

## 6. 优化方向（非功能）

| 方向 | 建议 |
|------|------|
| **模型质量** | 默认用较强兼容模型（如 DeepSeek）；弱模型靠门禁+模板兜底 |
| **生成约束** | 继续「强脚手架 + 少自由度」；禁止大面积空样式 |
| **预览稳定性** | 已做 module 预热；可再缓存 deps、避免无谓 force 杀进程 |
| **反代/HMR** | 子路径下维持 hmr:false；或单独配 WSS 路径（复杂度高） |
| **Prompt** | 短系统提示 + brief 契约；少堆长对话进上下文 |
| **性能** | 限制同时 preview 端口数；闲置预览回收 |
| **安全** | 强化 `run_command` 白名单；禁止外网（除显式 web_search） |
| **可观测** | run/phase/tool 结构化日志；失败样例入库便于扩门禁 |
| **DX** | `pnpm start/status/logs`；一键 `--reload` OpenResty 文档化 |

---

## 7. P0 验收对照（DoD）

| # | 标准 | 现状 |
|---|------|------|
| 1 | 本地启动 web+server，LLM 可用 | ✅（需有效 `LLM_API_KEY` 若上游要求） |
| 2 | 新建项目输入需求（Team + Build/Goal） | ✅ |
| 3 | 可见多角色与 brief/Plan | ✅ |
| 4 | 生成 Vite+React+TS 工作区 | ✅ |
| 5 | Preview 可交互（非空白/非纯错误） | ✅（样式门禁后改善；仍依赖模型） |
| 6 | 编译错误 → Resolve 修复尝试 | ✅ |
| 7 | Revert / Restore | ✅ |
| 8 | Stop 保留文件；重启可读 checkpoint | ✅ |

残留风险：弱模型仍可能多轮才过门禁；预览在 force 重启瞬时仍可能闪白（已预热缓解）。

---

## 8. 关键路径速查

| 用途 | 地址 |
|------|------|
| 本地 Web | http://127.0.0.1:39001/zapp/ |
| 本地 API | http://127.0.0.1:39000/healthz |
| 公网 | https://mac.ittoolplus.cn/zapp/ |
| 后台 | `pnpm start` / `stop` / `restart` / `status` / `logs` |

环境变量见根目录 [README.md](../README.md) 与 [.env.example](../.env.example)。
