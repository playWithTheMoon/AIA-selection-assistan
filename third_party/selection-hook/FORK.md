# Fork 说明（必读）

本目录是 [0xfullex/selection-hook](https://github.com/0xfullex/selection-hook) **v2.0.1**（MIT）的本地 fork，
为主仓库的「划词替换回填」功能（上游 issue #7）提供上游没有的能力。
除本文件外，`README.md` 为上游原文，未改动。

## 为什么 fork

替换回填需要：① 记住划词发生在哪个窗口；② 替换前按窗口精确复核选区；③ 向该窗口发粘贴键；
④ 发键前把焦点显式还给目标窗口。上游 API 只暴露「鼠标底下窗口」的读选区，无 hwnd、无发键、无回焦——故 fork。

## 改动清单（相对上游 v2.0.1）

| 文件 | 改动 |
|---|---|
| `src/windows/selection_hook.cc` | ① `TextSelectionInfo` 加 `hwnd` 字段（构造/clear 清零）；② `GetSelectedText` 统一记录来源 hwnd（事件、getCurrentSelection、getSelectionOfWindow 三条路径都带上）；③ `CreateSelectionResultObject` 输出 `hwnd`（JS number）；④ 新增 `GetSelectionOfWindow`（按 hwnd 读选区，绕开鼠标启发式，带全屏守卫与 `IsWindow` 校验）；⑤ 新增 `SendCtrlV` / `SendPasteKey`（照上游 `SendCopyKey` 的 `SendInput` 模板：读物理修饰键、防 Ctrl+V 冲突、先释放 Alt/Shift、对称 down/up 序列一次投递）；⑥ 新增 `FocusWindow`（`IsWindow` 校验 + `SetForegroundWindow`，失败返回 false 不做前台锁 hack，由调用方降级）；⑦ `Init` 注册三个新方法；⑧ `SendCtrlV` 加可选目标 hwnd + 发键前 `GetForegroundWindow()` 归属校验（校验与注入原子执行——封死"选区校验后、发键前切窗口"的误贴窗口，`nullptr` 保持旧行为），`SendPasteKey` 同步接受可选 hwnd |
| `index.js` | ① `getSelectionOfWindow(hwnd)` / `sendPasteKey(hwnd?)` / `focusWindow(hwnd)` 三个包装（照 `getCurrentSelection` 的守卫与 try-catch 模式）；② `#formatSelectionData` 在 Windows 平台透传 `hwnd`（无则 null） |
| `index.d.ts` | 同步声明：`TextSelectionData.hwnd?`、两个新方法（`sendPasteKey` 后加可选 `hwnd` 参数） |
| `prebuilds/win32-x64/selection-hook.node` | **本地重编译产物**（替换上游原版；其余 5 平台 prebuild 保留上游原样） |

## 跨平台行为

C++ 改动仅在 `src/windows/`。macOS/Linux 平台：`hwnd` 恒为 `null`；
调用 `getSelectionOfWindow` 会经 JS catch 走 `error` 事件并返回 null，`sendPasteKey` 返回 false——不炸，但无功能。
本 fork 随主仓库目前以 Windows 为主。

## 信任与重编

- 仓库里的 `.node` 是 NAPI 预编译（ABI 无关，node/electron 通用），`pnpm install` 零编译直接用——**不需要 C++ 工具链**。
- 想自己重编或审计：进本目录 `npm install`（需 VS Build Tools + Python），`npx node-gyp rebuild`，
  把 `build/Release/selection-hook.node` 覆盖到 `prebuilds/win32-x64/`。
- 改动约 150 行，全部带 `[fork]` 注释标记，与上游 diff 干净；上游未来若原生支持同能力可回收此 fork。
