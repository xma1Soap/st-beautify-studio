// The guidance that comes with the tool (can be turned off in the settings).
// Facts about SillyTavern come from PLAN.md, 五 and 九 (checked against ST's source and tested).

export const BUILTIN_SKILL = `# 酒馆美化指南（内置）

## 酒馆正则怎么生效
- 查找正则是 JS 正则，写成 /…/flags。替换内容里 $1 $2 是捕获组，{{match}} 是整段匹配。
- 「仅格式显示」(markdownOnly)：只改显示，不改聊天记录、不发给 AI。美化几乎都该勾它。「仅格式提示词」(promptOnly)：只改发给 AI 的内容，常用来在旧楼层删掉状态栏省 token。
- 作用范围 placement：1 用户输入，2 AI 输出。楼层深度 minDepth / maxDepth：0 是最新一楼，空着不限。
- 多条正则按列表顺序依次执行，前一条的输出是后一条的输入。
- 字段顺序不固定、可能缺字段时，每个字段用一个前瞻单独去找，不要写成固定顺序的一长串。

## 替换出来的 HTML 会经过酒馆的消息格式化
- 压成一行，不要空行和缩进换行：空行会变成段落，未知标签里的换行会变成 <br>。
- 每一行里的 * 和 " 必须成对，否则「自动修 Markdown」会在行尾补一个。例如别写 calc(var(--v) * 1%)，改用 transform: scaleX(calc(var(--v) / 100))。
- <style> 块会保留：class 名会被自动加 custom- 前缀（HTML 和样式里同时改，照常对得上），选择器会被限定在消息里。<style> 不能带属性，@import 会被删。
- 不要用 id（每条消息都有一份，会重复）。标签页用单选框 + :has()（不靠 id），折叠用 <details><summary>。
- :has() 等伪类的括号不要嵌套；属性选择器的值里不能有「.」。
- <script>、onclick 等事件会被删掉。需要脚本时写成前端卡（见下）。
- 外链图片、外链字体、<style> 里带 http 的网址默认会被「禁止外部媒体」拦掉；写在标签上的 style="background:url(…)" 不受影响；base64 内嵌图片可以。
- 能用：渐变、阴影、圆角、clip-path、滤镜、@keyframes 动画、:hover、@media、@container、SVG、data-xxx="$2" 配合 [data-xxx="…"] 按值换样式、style="--v:$3" 配合 calc() 按数值算长度和颜色、:empty 隐藏没写的字段。
- 动画名和 class 名加一个独特前缀，避免和别的美化冲突。

## 手机和电脑
- 消息宽度从 360px（手机）到 1000px（电脑）都有。用百分比、flex、grid、clamp()，不要写死宽度。
- 手机单独排版用 @media (max-width: 600px) 或 @container。字号在手机上不小于 12px。

## 前端卡（需要脚本时）
- 替换内容写成 \`\`\`html 代码块，里面是完整的 HTML 页面。装了酒馆助手的酒馆会把它放进 iframe 显示，可以用 jQuery、lodash、Vue、Tailwind，以及酒馆助手的接口（getVariables、Mvu.getMvuData、eventOn、triggerSlash 等）。
- 高度跟随内容，不要用 height: 100vh；需要时写 min-height。
- 没装酒馆助手的人只会看到代码，所以纯展示的美化优先用普通 HTML + CSS。

## 怎么改
- 先用工具读当前的内容，再动手。改大段 HTML 里的一小处，用「按原文替换」的工具，不要整段重写。
- 改完调用检查工具，看正则有没有命中、有没有格式警告，有问题自己修好再结束。
- 保留用户原来的风格和结构，只改用户要求的地方；不确定的先问。
- 你的改动会先给用户看前后对比，用户点「应用」才生效。最后用一两句中文说明改了什么、怎么看效果。`;
