# AuditHound Studio — 前端

AuditHound（智能合约审计流水线）的 Web 前端 + 本地 API 中间件。

## 这是什么

- `src/` React SPA 前端源码（Dashboard / Review Hub / Workflow Studio 等）
- `dist/` 已构建的静态产物（可直接托管）
- `server/` 本地 API 中间件（Vite 插件形态，负责读写审计数据、触发任务）
- `shared/` 前后端共享类型

## 重要：目录位置约束

API 中间件通过相对路径 `AUDIT_ROOT = ui/../..` 定位审计数据，因此本仓库**必须克隆/放置为工作区的 `ui/` 子目录**：

```
<workspace>/          ← 工作区根（内含 output/ 等数据目录）
└── ui/               ← 本仓库
    ├── src/  dist/  server/ ...
```

## 运行

```bash
npm install        # 或 npm ci
npm run dev        # 开发模式，http://127.0.0.1:4173
npm run build      # 构建 → dist/
npm run preview    # 以构建产物 + API 中间件运行（生产推荐）
```

## 依赖说明

- Node.js ≥ 20（建议 22）
- API 中间件读取工作区根的 `output/`（审计结果）、`.audithound/`（状态），并需要 Python3（任务执行层用到 `scripts/*.py`）
- 鉴权：设置环境变量 `AUDITHOUND_BASIC_AUTH_USER` / `AUDITHOUND_BASIC_AUTH_PASS` 启用 Basic Auth（**公网部署必须设置**，API 含任务触发能力）

## 没有数据目录会怎样

前端能启动、界面可看，但所有 `/api/*` 请求 404，列表为空——需要配合审计数据工作区使用。
