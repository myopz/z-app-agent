# z-app-agent 需求规格

> 阶段：第 1.1（需求梳理）。实现见后续 task02+。  
> 上游参考：`.ref/atoms/docs/atoms-dev-architecture.md`、`.ref/atoms/docs/research-atoms-dev.md`  
> 任务来源：`.tmp/step1/task01.md`

## 1. 产品定义

**一句话**：用户用自然语言提出应用需求，系统通过多角色智能体协作完成分析、拆解、规划、编码、构建与预览，交付可在浏览器内运行的 Web 应用。

**价值重心**不在「生成一段代码」，而在用户输入之后的中间过程是否可观测、可中断、可回退、可恢复：

| 中间过程 | 用户可见表现 | 系统职责 |
|----------|--------------|----------|
| 多角色 / 多智能体协作 | 消息带角色身份标签；`@` 点名；交接过程可见 | Role Runtime + brief 契约 |
| 需求分析 / 拆解 | question card；结构化 brief | Emma + Mike |
| 规划 | Plan card（Approve / Decline） | Mike（Goal 模式强制） |
| 执行 | tool / activity 卡片；Terminal 流 | Alex 等专家 + Tool Executor |
| 反思 / 修复 | Issue Report → Resolve；错误回灌 | 修复闭环（最多 N 次） |
| 回退 | 单条 Revert；版本 Restore | Patch + Snapshot |
| 中断恢复 | Stop 保留已完成；重启从 checkpoint 续跑 | Orchestrator checkpoint |
| 会话 / 上下文 / 记忆 | 单项目单会话；`.atoms/*.md`；摘要 | Memory + Prompt Assembler |

**刻意对齐 atoms.dev 的部分**：单会话=单项目、结构化 brief、三级回滚、状态变更与文字产出分离、`.atoms/` 长期记忆、Team Mode SOP。

**刻意差异**（本产品首期）：

| 项 | atoms.dev | z-app-agent 首期 |
|----|-----------|------------------|
| 控制台技术栈 | Nuxt（Vue） | React + Vite + shadcn/ui |
| 后端 | 闭源 | Node/TS（Hono）monorepo |
| 模型 | 商业多模型 | `api-ittoolplus` 免费聚合 |
| 沙箱 | 容器化 | 本机 `workspaces/<projectId>` 目录隔离 |
| 云后端 / 发布 / 双钱包 | 完整 | 砍掉或仅留接口位 |
| Team Mode | 可选 | **首期默认完整 Team Mode** |

## 2. 用户与场景

### 2.1 角色

| 角色 | 描述 |
|------|------|
| 终端用户（Builder） | 用自然语言描述要做的 Web 应用，通过对话驱动构建与迭代 |
| 系统运营者（本地开发者） | 部署 server、配置免费 AI 聚合地址与密钥环境 |

首期不实现多租户 Workspace 成员体系；单机单用户即可。

### 2.2 核心场景

**S1 首发构建（Happy Path）**

1. 用户创建项目，输入：「做一个待办清单，支持增删改和本地持久化」。
2. Mike 协调：必要时出 question card；生成 brief；Goal 模式或复杂任务时出 Plan card 待批。
3. Emma 收敛范围与验收点 → Bob 给出技术结构 → Alex 落盘脚手架与代码。
4. 系统 install → build/dev → Preview iframe 打开可交互页面。
5. 落盘成功后出现 Version card；对话中可见各角色与工具活动。

**S2 迭代修改**

1. 用户在同一会话追加：「加一个按截止日期排序」。
2. 若 Agent 正忙，消息入队；空闲后 Mike 合并进更新 brief，从当前工作区继续（非重建）。
3. 增量改文件 → 预览热更新或刷新 → 新 Version（若有状态变更）。

**S3 构建失败自愈**

1. 依赖或编译错误出现在 Terminal / Issue Report。
2. 用户点 Resolve（或系统自动触发一次）：错误日志回灌 Alex。
3. 修复后重试 build；超过 `MAX_FIX_ATTEMPTS`（默认 3）则停下并如实报告，不静默成功。

**S4 回退**

1. 用户对某条 Agent 消息点 Revert：回滚该回合 patch。
2. 或从 Versions 面板 Restore 到某里程碑快照；之后版本仍保留可再应用。

**S5 中断与恢复**

1. 用户 Stop：终止活跃任务，已写入文件与已完成子任务保留。
2. 进程崩溃或服务重启后：按 project checkpoint 恢复队列与未完成任务状态，可续跑或需用户确认后续跑。

**S6 条件角色**

1. 需要调研时 Mike 可派 Iris；需要数据分析时派 David。
2. Sarah / Adrian 首期在角色表注册，工具可 stub；调用时明确告知「能力未接通」，不假装完成。

## 3. 用户故事

| ID | 故事 | 优先级 |
|----|------|--------|
| US-01 | 作为 Builder，我输入一句话需求后能看到多角色协作过程，并最终在预览区打开可用页面 | P0 |
| US-02 | 作为 Builder，我能批准或拒绝 Plan，拒绝后团队重写计划再执行 | P0 |
| US-03 | 作为 Builder，我能 `@` 指定角色处理局部任务 | P0 |
| US-04 | 作为 Builder，我能看到 Terminal（Agent 执行）与 Console（产物运行）分流日志 | P0 |
| US-05 | 作为 Builder，构建失败时我能触发修复闭环并看到重试次数与最终结果 | P0 |
| US-06 | 作为 Builder，我能 Revert 单回合或 Restore 版本，且不会把「口头完成」当成已改项目 | P0 |
| US-07 | 作为 Builder，我 Stop 后已完成工作仍在；服务重启后可从中断点恢复 | P0 |
| US-08 | 作为 Builder，长对话后关键约束仍可通过项目内 `.atoms/*.md` 保持 | P0 |
| US-09 | 作为 Builder，忙碌时我追加的消息会排队且不打断当前执行 | P0 |
| US-10 | 作为运营者，我只需配置免费聚合 baseURL，无需在前端暴露 Key | P0 |
| US-11 | 作为 Builder，我能导出当前项目源码 ZIP | P1 |
| US-12 | 作为 Builder，我能一键发布到固定预览子域 | P2 |
| US-13 | 作为 Builder，产物可接 Database / Auth / Storage | P2 |

## 4. 能力矩阵

图例：✅ 首期必须 · 🔧 首期有接口/stub · ❌ 首期不做

| 能力 | 首期 | 说明 |
|------|------|------|
| NL → 代码 → 预览闭环 | ✅ | 产品定义 |
| Team Mode 八角色注册 | ✅ | 主路径 Mike→Emma→Bob→Alex；Iris/David 条件进入 |
| Sarah / Adrian 实装 | 🔧 | 注册 + stub，明确未接通 |
| Engineer Mode（仅 Alex） | 🔧 | 保留模式开关；默认 Team |
| Build / Goal 双模式 | ✅ | Goal 强制 Plan card |
| question / Plan / Version / tool / activity 卡片 | ✅ | |
| `@` 点名 | ✅ | |
| `#` 引用文件 | ✅ | 首期只做文件引用；密钥/模型引用 P1 |
| 消息队列 + Stop | ✅ | |
| Checkpoint 中断恢复 | ✅ | |
| 文件工具 + run_command | ✅ | |
| install / build / preview | ✅ | |
| resolve_issue 修复闭环 | ✅ | 上限 N 次，失败显式暴露 |
| Patch + Snapshot 版本 | ✅ | 不可变追加 |
| Revert / Restore | ✅ | |
| `.atoms/` 项目记忆 | ✅ | 生成物工作区内维护 |
| 记忆压缩（摘要） | ✅ | 简化：截断 + 最近 N 轮 + 可选摘要 |
| Terminal ≠ Console | ✅ | |
| Docker 沙箱 | ❌ | P1 |
| 公网发布 / 域名 / 安全扫描 | ❌ | P2，预留接口 |
| Atoms Cloud 五模块 | ❌ | P2 |
| 双钱包 / Credits | ❌ | 首期本地无限或简单 RPM 限流 |
| Remix / 分享 / Discover | ❌ | P2 |
| 真实 Google Ads / SEO 自动化 | ❌ | P2+ |
| 多用户鉴权 / Workspace | ❌ | P1 |

## 5. 功能需求明细

### 5.1 输入与工作流

- 支持自然语言 prompt；可选附件（首期：图片/文本，二进制大文件可延后）。
- 控制轴（首期子集）：
  - **产物形态**：Web（默认）；App/Video 延后。
  - **构建策略**：Build | Goal。
  - **协作拓扑**：Team（默认）| Engineer。
- `workflow_kind` 至少：`normal`；`deep_research` 可标 P1（强制 Iris）。
- 非法组合由 Mode Guard 拒绝并返回可读原因。

### 5.2 多角色 SOP

| 角色 | ID | 职责 | 首期工具面 |
|------|-----|------|------------|
| Mike | `mike` | Team Leader：brief、计划、委派、合并追问 | 无写盘；可 web_search（若接通） |
| Emma | `emma` | Product Manager：范围、用户故事、验收标准 | 写项目记忆文档 |
| Bob | `bob` | Architect：模块划分、数据模型、技术约束 | 写 ARCHITECTURE 类文档；只读代码 |
| Alex | `alex` | Engineer：实现、依赖、构建、修复 | 全量文件与终端工具 |
| David | `david` | Data Analyst：数据/文档分析 | 读文件；分析类命令 |
| Iris | `iris` | Deep Researcher：调研报告 | web_search / browse（若接通） |
| Sarah | `sarah` | SEO | stub |
| Adrian | `adrian` | Ads | stub |

**权威中间表示**：Mike 产出的 brief 为唯一任务契约：

```ts
type Brief = {
  sections: string[]           // 要做什么
  constraints: string[]        // 必须保持为真
  quality_rules: string[]      // 质量门槛
  assignees: RoleId[]          // 建议执行顺序
  acceptance: string[]         // 如何验收
}
```

专家**不得**各自重新解释原始用户 prompt 作为权威来源；应以 brief + 项目记忆 + 当前文件树为准。

### 5.3 编排与会话

- **不变量**：`project_id === chat_id`（逻辑上同一实体）。
- 每 chat **至多一个活跃任务**；其余用户消息入队（enqueue / reorder / pause / clear）。
- Stop：取消活跃任务与可选清空后续队列（可配置）；保留已落盘变更。
- Checkpoint：至少记录 `{project_id, phase, brief, queue_cursor, workspace_hash, updated_at}`，服务重启后可加载。

### 5.4 工具与执行

首期工具契约：

| 工具 | 权限 | 说明 |
|------|------|------|
| `list_files` | 读 | glob |
| `read_file` | 读 | 可选行范围 |
| `write_file` | 写 | 建/覆写 |
| `edit_file` | 写 | 定点替换 |
| `run_command` | 执行 | cwd 限制在 workspace 内；超时 |
| `install_deps` | 执行 | pnpm/npm |
| `build` | 执行 | 构建并回传错误 |
| `preview` | 执行 | 启动/刷新预览，返回 URL |
| `resolve_issue` | 写 | 消费 Issue Report 触发修复回合 |
| `web_search` | 读 | 可选；依赖聚合或独立搜索服务 |

**高权限写**（未来 DB/Auth/Secret）一律只经工具层；首期无旁路管理后台 DDL。

### 5.5 版本与状态信号

- **Patch**：每个产生文件变更的 turn 记录 diff，支撑消息级 Revert。
- **Snapshot**：任务交付单元结束时打版本（语义化 label，可由模型建议、由服务签发）。
- **Version card** 仅在「工作区相对上一版本有真实文件变更且快照成功」时由 Snapshot Service 发出。
- 模型自然语言「已完成」**不**构成状态变更证据。

### 5.6 记忆与上下文

三层：

| 层 | 载体 | 首期策略 |
|----|------|----------|
| 短期 | 当前对话原始轮次 | 按预算保留最近轮次 |
| 中期 | 摘要 + 保留事实 | 超预算时截断旧轮 + 可选一次摘要调用 |
| 长期 | 生成项目内 `.atoms/ATOMS.md`、`PROGRESS.md`、`ARCHITECTURE.md` | 阶段边界更新；带 `last_updated` frontmatter |

冲突优先级（约定）：

1. 当前用户明确指令  
2. brief.constraints / 项目记忆显式约束  
3. 工作区实际代码  
4. 压缩摘要  
5. 更早原始轮次  

### 5.7 预览与可观测

- Preview：iframe 加载 server 代理的 workspace dev server。
- Terminal：Agent 侧命令与工具输出（SSE）。
- Console：产物运行时日志（与 Terminal 分通道）。
- 文件树 + 简易编辑器：只读优先，编辑可 P1。

### 5.8 AI 接入

- 仅 server 侧通用 OpenAI 兼容客户端：  
  `POST {LLM_BASE_URL}/chat/completions`（默认 `https://ittoolplus.cn/api/openai/v1`）。
- 通过 `.env` 配置 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，可接入主流兼容大模型，无需改代码。
- 前端不持有任何 API Key。
- 上游 503 / 超时：向上抛错；编排可有限次重试；**禁止**伪造成功回复。

## 6. 非功能需求

| ID | 类别 | 要求 |
|----|------|------|
| NF-01 | 可靠性 | 工具调用与版本写入可审计（持久化日志）；失败路径显式 |
| NF-02 | 流式体验 | Chat / Terminal 使用 SSE；首 token 尽量快 |
| NF-03 | 安全 | workspace 路径沙箱（禁止 `..` 逃逸）；命令 cwd 锁定 |
| NF-04 | 可恢复 | checkpoint 可跨进程恢复未完成任务元数据 |
| NF-05 | 可测 | shared schema（Brief、Card、Tool）可单测；编排可用假 LLM |
| NF-06 | 性能 | 单机同时活跃项目数可配置（默认 1～3）；超出排队或拒绝 |
| NF-07 | 可运维 | `/healthz`；LLM 连通性探测（如 free-status 代理） |

## 7. 首期验收标准（Definition of Done for P0）

演示路径必须跑通：

1. 本地启动 `apps/web` + `apps/server`，配置指向可用的免费聚合。
2. 新建项目，输入一句 Web 应用需求（Team + Goal 或 Build）。
3. UI 可见 Mike 及至少 Emma/Bob/Alex 之一的协作消息与 brief/Plan 过程。
4. 工作区生成可识别的前端项目（Vite + React + TS 约定）。
5. Preview iframe 展示可交互页面（非空白、非纯错误页）。
6. 人为引入编译错误后，Resolve 能触发至少一轮修复尝试并回报结果。
7. Revert 或 Restore 能把文件恢复到先前状态。
8. Stop 后已写入文件仍在；重启 server 后能读到 checkpoint / 会话历史。

文档阶段（本 1.1）验收：本文件 + `docs/architecture.md` + `.atoms/*` + `.wiki.md` 齐备，且第 8 节清单全覆盖。

## 8. task01 中间过程覆盖清单

| 关键词 | 需求落点 | 架构模块（见 architecture.md） |
|--------|----------|--------------------------------|
| 多角色 | §5.2 | Role Runtime |
| 多智能体协作 | §5.2、S1 | Orchestrator + brief 交接 |
| 需求分析 | Emma、question card | PM Role |
| 拆解 | brief.sections / assignees | Leader Role |
| 规划 | Plan card、Goal 模式 | Workflow + Leader |
| 执行 | Alex + 工具 | Tool Executor |
| 反思 | 构建/预览结果评估 | Fix Loop / Critic 步骤 |
| 修复 | resolve_issue、MAX_FIX_ATTEMPTS | Fix Loop |
| 回退 | Revert / Restore | Patch + Snapshot |
| 中断恢复 | Stop、checkpoint | Orchestrator |
| 会话 | project≈chat | Session 模型 |
| 上下文 | Prompt 分层 S0–S6 | Prompt Assembler |
| 记忆 | 三层 + `.atoms/` | Memory Compactor + 项目文档 |

## 9. 分期路线

| 阶段 | 目标 | 信号 |
|------|------|------|
| **P0** | Team Mode NL→预览；版本；修复；checkpoint | 5～10 分钟内做出可预览页 |
| **P1** | Docker 沙箱；`#` Keys；导出 ZIP；Engineer Mode 打磨；深研工作流 | 迭代成功率明显上升 |
| **P2** | 发布；简单托管；Cloud 能力子集；Remix | 可持续使用而非一次性 demo |
| **P3** | SEO/Ads 实装；多用户；计量 | 商业化准备 |

## 10. 开放问题（不阻塞 1.1）

| ID | 问题 | 暂定 |
|----|------|------|
| Q1 | 免费小模型能否稳定产出可用多文件项目 | 用强约束脚手架模板降低生成自由度 |
| Q2 | 多专家串行 vs 有限并行 | P0 **串行交接**；并行标 P1 |
| Q3 | SQLite 是否足够 | P0 SQLite；迁移 Postgres 留接口 |
| Q4 | 预览端口分配策略 | 每项目固定偏移端口池 |
