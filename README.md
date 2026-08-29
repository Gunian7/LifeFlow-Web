# LifeFlow Web

LifeFlow 的主产品实验线：一个本地优先、无需登录、不会责备用户的今日时间线。

## 当前状态

- `packages/core`：平台无关 TypeScript 规则核心，当前包含 Planner 最小 tracer
- `apps/web`：Vite + React Web/PWA 首屏
- 本地任务添加、完成、撤销
- localStorage 持久化
- PWA manifest、service worker、离线 app shell

HarmonyOS 原型在另一个仓库中维护，不与本仓库耦合。

## 开发

```bash
npm install
npm run dev
npm test
npm run build
```

## 设计方向

LifeFlow 不追求把一天塞满。它的核心承诺是：给出可完成、可解释、可手动调整的时间线；排不下时明确说明冲突，不吞掉休息和缓冲。

AI 只能建议任务顺序，不能直接创建、移动或删除日程；最终排程由本地规则核心执行。

## 当前平台策略

Web/PWA 是主线；验证真实使用后再用 Capacitor 包装 Android。Mac 先用 Web/PWA，未来确实需要系统级能力时再评估 Tauri。HarmonyOS 工程作为既有原型保留。
