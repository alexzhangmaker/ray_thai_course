# vCourse.ThaiNotes - SideApp 伴侣屏特性说明

## 1. 概述

SideApp 是为泰语听写助手（`Pages/appDictation.html`）增量实现的"哑终端"式第二屏幕联动特性：
- **主操作台（iMac / 电脑端）**：运行业务逻辑、播放泰语音频、导师评分把关、SM-2 算法调度。
- **手机伴侣屏（iPhone / 移动端）**：通过局域网扫码即用，作为第二块屏幕被动同步听写状态、音频播放波形、以及翻开后的泰语拼写与例句精讲。
- **纯被动渲染**：Side App 无任何业务逻辑，不发号命令，只响应来自主端的渲染指令（`render.full`, `render.patch`, `render.navigate`, `render.effect`）。

---

## 2. 架构与数据流

```
┌─────────────────────────────────────────┐          ┌─────────────────────────────────────────┐
│        主操作台 (iMac Web App)           │          │          手机伴侣屏 (iPhone Web)         │
│                                         │          │                                         │
│   Pages/appDictation.html               │          │   Pages/sideapp/index.html              │
│   - UI / 状态管理 / 导师评分             │          │   - 被动状态渲染 (renderer.js)          │
│   - SideAppBridge (bridge.js)           │          │   - 断线重连 WS 客户端 (wsClient.js)    │
│   - 配对面板 (pairingPanel.js)          │          │                                         │
└────────────────────┬────────────────────┘          └────────────────────▲────────────────────┘
                     │                                                    │
                     │ HTTP POST /sideapp/broadcast                       │ WS /sideapp/ws
                     ▼                                                    │ (单向广播)
┌─────────────────────────────────────────────────────────────────────────┴────────────────────┐
│                                 Node.js 后台服务 (BEServices)                                │
│   - BEServices/sideapp/index.js        # Express 路由注册与局域网 IP 发现                      │
│   - BEServices/sideapp/sessionStore.js # 主会话生命周期、4位配对码生成与校验                  │
│   - BEServices/sideapp/wsHub.js        # WebSocket 连接池、快照暂存与广播中转                 │
│   - BEServices/sideapp/protocol.js     # 协议规范 (v1.0)、Envelope 构造与 JSON Patch Diff/Apply│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 使用指引

### 3.1 启动主操作台并开启伴侣屏
1. 在 iMac 浏览器打开：`http://localhost:3002/Pages/appDictation.html`（或局域网 IP `http://192.168.1.120:3002/Pages/appDictation.html`）。
2. 在页面顶部右上角点击 **伴侣屏** 胶囊按钮。
3. 在弹出的配对面板中，打开 **"伴侣屏联动特性"** 开关。
4. 面板将自动展示：
   - **4位大字配对码**（如 `A3F9`，带一键复制）。
   - **局域网直连二维码**（本地离线生成，支持手机相机或微信直接扫码）。
   - **直达链接**（如 `http://192.168.1.120:3002/sideapp?code=A3F9`）。
   - **实时在线设备列表**（手机连接后自动显示已连接设备 IP）。

### 3.2 手机端接入
1. 确保 iPhone 与 iMac 连接在**同一 Wi-Fi 局域网**。
2. 用 iPhone 相机扫描面板中的二维码，或在 Safari 输入 `http://<iMac-IP>:3002/sideapp`。
3. 2 秒内即自动完成握手并同步首屏状态。

### 3.3 教学使用场景
- **步骤 1：听音默写（Writing）**
  - iMac 播放纯正泰语音频。
  - 手机伴侣屏同步播放声波跳动动效，泰语原词与释义严格隐藏，学生专注于实体纸张书写。
- **步骤 2：翻开核对（Revealed）**
  - 导师在 iMac 按 `[Space]` 翻开核对。
  - 手机端毫秒级同步呈现超大号泰文原词、精准音标、中文释义及完整的配套例句精讲。
- **步骤 3：评分与练习结算**
  - 导师在 iMac 评定分数（0/3/4/5），自适应推进下一词。
  - 练习结束后，手机端同步显示成绩总览与生词回顾表。

---

## 4. 通信协议 (Protocol v1.0)

所有消息均采用信封（Envelope）规范包装：

```json
{
  "seq": 1,
  "type": "render.patch",
  "protocolVersion": "1.0",
  "timestamp": 1712345678901,
  "payload": { }
}
```

| 消息类型 (`type`) | 方向 | 作用与 Payload |
| --- | --- | --- |
| `session.welcome` | 后台 → 手机 | 连接成功欢迎帧：`{ protocolVersion: "1.0", deviceId: "...", sessionId: "..." }` |
| `render.full` | 主端 → 手机 | 全量渲染（首次连接、断线重连、视图切换）：`{ view: "viewSession", state: { ... } }` |
| `render.patch` | 主端 → 手机 | 增量补丁更新：`{ ops: [{ path: "phase", value: "revealed" }, ...] }` |
| `render.navigate` | 主端 → 手机 | 视图路由导航：`{ view: "viewSummary", state: { ... } }` |
| `render.effect` | 主端 → 手机 | 一次性动效播放：`{ name: "audio-playing", duration: 1500 }` |
| `session.error` | 主端 → 手机 | 状态通知：`{ code: "MASTER_CLOSED", message: "..." }` |
| `ping` / `pong` | 双向 | 心跳探测（20~25s 间隔） |

---

## 5. 自动化测试

项目内置完整的单元与端到端集成测试套件：

```bash
# 运行 SideApp 协议、Diff 算法、会话存储与 WebSocket 端到端测试
node --test BEServices/sideapp/tests/sideapp.test.js
```

测试覆盖内容：
- Envelope 信封生成与协议版本校验
- `computePatch` 递归计算对象与数组差异
- `setByPath` 安全路径赋值与属性删除
- `SessionStore` 会话创建、4位配对码换 Token、设备在线跟踪与状态快照缓存
- WebSocket 连接握手、401 非法鉴权拦截、广播消息转发、重连快照即时下发与 Master 关闭广播

---

## 6. 特性开关与平滑降级

- **默认安全**：未开启时，主操作台无任何后台长连接或广播开销，行为与改造前完全一致。
- **降级容错**：若局域网网络断开或后台未启动，主操作台静默降级，正常支持所有泰语听写与 SM-2 复习评测功能。
