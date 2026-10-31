# 酒馆美化工坊（ST Beautify Studio）

给 SillyTavern 做角色卡和美化的工具，面向不会写代码的新人。有两种模式，在左上角切换：

## 现在能做什么

### MVU 角色卡（默认）

不用写代码，做一张带变量和状态栏的 MVU 角色卡（新版 MVU：zod 变量结构 + JSONPatch 更新）。

- 变量：左边加数字 / 文字 / 是否 / 选项 / 列表 / 分组 / 表格，或者从「＋ 模板」里挑一组现成的（时间地点、好感度、物品栏、任务、人物关系、角色状态、跑团属性……）；数字可以设范围和阶段（比如好感度 40 以上叫「朋友」）
- 每个变量写「什么时候变」，工具自动整理成给 AI 的规则和输出格式
- 预览：右边直接看到状态栏；「模拟 AI 回复」里贴一段 AI 的回复，能看到变量怎么变、哪条更新会被 MVU 拒绝
- 导出：「导出角色卡」得到一张 PNG 角色卡，在酒馆「导入角色」里直接用（需要装酒馆助手）；卡里的世界书、正则、脚本都自动写好
- 导入：把别人做的 MVU 卡拖进来，工具会读出变量；原卡里其它内容导出时原样保留
- 保存：工程文件 `*.MVU卡工程.json`；导出的卡里默认也藏一份，拖回工具就能接着改

### 正则美化

给纯文字的 AI 回复做美化正则。

- 导入：把正则 JSON、预设、角色卡 PNG、工程文件拖进窗口，或点「导入正则」
- 编辑：「替换内容」页用代码编辑器改 HTML；「正则设置」页改名称、查找正则、修剪、作用范围、选项、宏、深度，并显示每处匹配和捕获组
- 预览：按酒馆的顺序执行正则；```html 代码块按酒馆助手的方式渲染成卡片；可切换 📱 手机（360 / 390 / 430 宽）和 🖥 电脑
- 测试消息：自动按正则生成能命中的示例文本
- 保存：工程文件 `*.美化工程.json`（Ctrl+S / Ctrl+Shift+S / Ctrl+O）；关掉程序也会自动暂存
- 导出：「导出当前」导出单条，「导出全部」导出成数组，都能直接在酒馆「正则 → 导入」里用

## 下载和使用

有三种用法，功能一样：

| 版本 | 怎么拿到 | 适合 |
|---|---|---|
| 网页版 | 打开 `https://xma1soap.github.io/st-beautify-studio/`（需要先开启 GitHub Pages，见下） | 不想装软件 |
| 单文件网页版 | 下载 `st-beautify-studio-web.html`，双击用浏览器打开 | 发到群里给别人用、离线用 |
| 桌面版 | 下载 `st-beautify-studio-portable.exe`（免安装）或 `*-setup.exe`（安装包） | 常用、要直接存文件到电脑上 |

单文件网页版和桌面版都在 GitHub 的 **Actions** 页面：点最近一次成功的「桌面版（Windows）」，拉到底部的 Artifacts 下载 `windows`。推送 `v` 开头的标签（比如 `v0.2.0`）时还会自动建一个草稿版本，在 **Releases** 页面确认后发布。

网页版和单文件版保存时会下载文件，没法像桌面版那样直接覆盖原文件。

### 开启网页版

仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**，然后往 `main` 推送一次（或在 Actions 页面手动运行「网页版」）。

GitHub 免费账号的**私有仓库**开不了 Pages，要么把仓库改成公开，要么升级 GitHub Pro。开了之后网页是公开的，知道链接的人都能打开。

## 自动构建

| 构建 | 什么时候跑 | 产出 |
|---|---|---|
| 网页版（`.github/workflows/web.yml`） | 每次推送 | 检查能否构建、单文件网页版；`main` 上且已开启 Pages 时发布网页 |
| 桌面版（`.github/workflows/desktop.yml`） | 推送到 `main`、推送 `v*` 标签、手动运行、或其它分支提交说明里带 `[打包]` | Windows 免安装 exe、安装包、单文件网页版 |

私有仓库的 Windows 构建按 2 倍计时，所以桌面版不是每次推送都打包。

## 开发

需要 Node 20+、Rust（stable）。在 Windows 上打包还需要 VS Build Tools（C++）。

```bash
npm install
npm run dev            # 只在浏览器里跑界面：http://localhost:1420
npm run build:single   # 单文件网页版：dist-single/index.html
npm test               # 自动测试
npx tauri dev          # 桌面窗口 + 热更新
npx tauri build        # 打包
```

本地打包结果：

- 免安装 exe：`src-tauri/target/release/st-beautify-studio.exe`
- 安装包：`src-tauri/target/release/bundle/nsis/*.exe`

## 代码结构

| 文件 | 作用 |
|---|---|
| `src/mvu/` | MVU 卡：变量树、zod 变量结构、世界书和正则生成、状态栏、模拟更新、整卡导入导出、变量模板 |
| `src/components/mvu/` | MVU 卡界面：变量树、变量设置、角色卡页、预览和模拟 |
| `src/cardStore.ts` / `src/cardActions.ts` | MVU 卡的状态（撤销重做、自动暂存）和菜单操作 |
| `src/lib/engine.ts` | 正则引擎（照搬酒馆的执行逻辑）、示例文本生成 |
| `src/lib/render.ts` | 预览页面：消息气泡、前端卡 iframe、酒馆助手接口的简单模拟 |
| `src/lib/importer.ts` | 读取各种文件里的正则、导出格式 |
| `src/lib/png.ts` | 读写 PNG 角色卡里的数据 |
| `src/lib/files.ts` | 打开 / 保存文件（桌面版走系统对话框，浏览器里走下载） |
| `src/store.ts` | 正则美化模式的状态和自动暂存 |
| `src/components/` | 正则美化界面：顶栏、正则列表、编辑器、预览 |
| `src-tauri/` | 桌面外壳（Rust）：打开 / 保存对话框，只能读写用户在对话框里选过的文件 |

## 之后的阶段

完整规划见 [PLAN.md](PLAN.md)：主功能改成在画布上拖组件做美化，工具自动生成正则和给 AI 的格式说明，代码编辑降为进阶功能。
