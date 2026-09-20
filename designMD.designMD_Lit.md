# Design Document & Prompt: 文学分析练习辅助桌面应用 (Literacy Analysis Practice Desktop App)

## 1. 项目概述与架构设计 (Overview & Architecture)
本项目旨在开发一款面向桌面端 (Desktop Web App) 的文学作品分析与练习辅助工具。系统采用**前后端分离**架构：
- **后端服务 (Backend)**：Node.js + Express + SQLite 数据库。负责存储多体裁文学作品（小说 Fiction、诗歌 Poetry、散文 Essay、戏剧 Drama）的通用 JSON 数据、用户练习记录、错题本及答题进度。
- **前端界面 (Frontend)**：基于原生 HTML5, Tailwind CSS, JavaScript (SPA 单页应用) 构建。通过动态组件渲染引擎，根据后端返回的 `genre`（体裁类型）字段自动适配对应的UI分析表单、讨论题及 5W1H 文本细读模块。

---

## 2. 后端数据结构与 SQLite 设计 (Database & API Spec)

### 2.1 SQLite 数据表结构
1. **`works` (作品与练习主表)**
   - `id` (INTEGER, Primary Key)
   - `exercise_id` (TEXT, Unique)
   - `genre` (TEXT): `fiction`, `poetry`, `essay`, `drama`
   - `title` (TEXT)
   - `author` (TEXT)
   - `description` (TEXT)
   - `content_json` (TEXT): 存储完整的结构化练习内容（即上文设计的通用多体裁 JSON）

2. **`user_progress` (用户答题与练习记录表)**
   - `id` (INTEGER, Primary Key)
   - `user_id` (TEXT): 学生或辅导员ID
   - `exercise_id` (TEXT)
   - `answers_json` (TEXT): 用户填写的答案数据
   - `score` (REAL)
   - `updated_at` (DATETIME)

### 2.2 核心 API 设计
- `GET /api/exercises`：获取所有可用的文学练习列表（支持按 `genre` 筛选）。
- `GET /api/exercises/:exercise_id`：获取特定文学作品的完整 JSON 结构（供前端动态渲染）。
- `POST /api/exercises/submit`：提交或保存用户的练习进度与答案。
- `GET /api/progress/:user_id`：获取指定用户的历史练习与错题记录（方便辅导员跟进）。

---

## 3. 前端界面设计与核心功能 (Frontend UI & Features)

### 3.1 核心视图模块
1. **作品广场与筛选面板 (Dashboard)**：支持按体裁（Fiction, Poetry, Essay）快速筛选文学作品卡片。
2. **动态渲染工作区 (Dynamic Exercise Workspace)**：
   - 根据作品的 `genre` 自动切换表单模板：
     - **Fiction 模板**：渲染冲突（Conflict）、人物（Characters）、场景（Setting）。
     - **Poetry 模板**：渲染意象（Imagery）、修辞手法（Poetic Devices）、韵律。
     - **Essay 模板**：渲染中心论点（Central Argument）、作者视角（Perspective）。
   - **通用模块**：底部挂载讨论题（Discussion Questions）输入框与 5W1H 语法细读填空。
3. **反复练习与比对模式 (Practice & Review Mode)**：
   - 支持“练习模式”（填写并保存答案）与“参考答案对照模式”（一键对比标准答案）。
   - 错题自动归档，支持反复重练。
4. **辅导员管理视图 (Tutor View)**：
   - 允许辅导员查看学生的提交记录、答题正确率与文本分析批改建议。

---

## 4. 给 Antigravity 的开发提示与执行指令 (Prompt for Antigravity)

请根据以下指令，在本地环境中启动并开发该桌面端 Web 应用：

1. **项目初始化**：
   - 创建 `server.js`，配置 Express 服务并初始化 SQLite 数据库 (`database.sqlite`)，实现上述两张表及基础 CRUD 接口。
   - 在数据库中预置包含 `fiction`（《ข้างหลังภาพ》）、`poetry`、`essay` 的多体裁示例 JSON 数据。
2. **前端单页应用 (SPA)**：
   - 采用纯净的 HTML + Tailwind CSS CDN + 原生 JavaScript 构建响应式 UI，无需复杂的 Webpack 配置，确保轻量快速。
   - 编写动态渲染引擎函数 `renderExercise(data)`：通过读取 `data.genre` 动态生成对应的文学分析输入表单。
3. **桌面端打包 (Optional)**：
   - 预留使用 Electron 或 Node 本地直接启动的接口，方便作为本地桌面工具运行。
