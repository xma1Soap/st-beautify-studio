# 酒馆美化工坊（ST Beautify Studio）

SillyTavern 美化正则的桌面编辑器：导入、编辑、实时预览（手机 / 电脑）、导出回酒馆。

## 现在能做什么（第 1 阶段）

- 导入：把正则 JSON、预设、角色卡 PNG、工程文件拖进窗口，或点「导入正则」
- 编辑：「替换内容」页用代码编辑器改 HTML；「正则设置」页改名称、查找正则、修剪、作用范围、选项、宏、深度，并显示每处匹配和捕获组
- 预览：按酒馆的顺序执行正则；```html 代码块按酒馆助手的方式渲染成卡片；可切换 📱 手机（360 / 390 / 430 宽）和 🖥 电脑
- 测试消息：自动按正则生成能命中的示例文本
- 保存：工程文件 `*.美化工程.json`（Ctrl+S / Ctrl+Shift+S / Ctrl+O）；关掉程序也会自动暂存
- 导出：「导出当前」导出单条，「导出全部」导出成数组，都能直接在酒馆「正则 → 导入」里用

## 开发

需要 Node 20+、Rust（stable-msvc）、VS Build Tools（C++）。

```bash
npm install
npm run dev          # 只在浏览器里跑界面：http://localhost:1420
npx tauri dev        # 桌面窗口 + 热更新
npx tauri build      # 打包
```

打包结果：

- 免安装 exe：`src-tauri/target/release/st-beautify-studio.exe`
- 安装包：`src-tauri/target/release/bundle/nsis/*.exe`

## 代码结构

| 文件 | 作用 |
|---|---|
| `src/lib/engine.ts` | 正则引擎（照搬酒馆的执行逻辑）、示例文本生成 |
| `src/lib/render.ts` | 预览页面：消息气泡、前端卡 iframe、酒馆助手接口的简单模拟 |
| `src/lib/importer.ts` | 读取各种文件里的正则、导出格式 |
| `src/lib/files.ts` | 打开 / 保存文件（桌面版走系统对话框，浏览器里走下载） |
| `src/store.ts` | 全局状态和自动暂存 |
| `src/components/` | 界面：顶栏、正则列表、编辑器、预览 |
| `src-tauri/` | 桌面外壳（Rust），只有读写文件两个命令 |

## 之后的阶段

2. 改现成美化：自动提取颜色做调色板、点选元素改样式
3. 组件式搭建：拖拽、缩放、图案库、字段绑定、自动生成正则
4. 撤销 / 重做、图片管理、发布安装包
