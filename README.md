# 灵

桌面虚拟人物：透明置顶的 Live2D 伙伴，用 OpenAI 兼容接口聊天，记住你的喜好，也能帮忙做一些本机小事。

## 运行

```bash
npm install
npm run dev
```

第一次打开后，在设置里填写 API Key、接口地址和模型。默认是 MiniMax 国内。也可以选 OpenAI、xAI、DeepSeek，或 **Cursor（使用 cursor.com 后台的 crsr_ Key）**。Cursor 走 Agent，不是普通聊天补全接口。

Key 保存在项目里的 `data/` 目录，并用系统加密（Windows DPAPI）。该目录已加入 gitignore，不会提交。

## 使用

- 单击人物：互动；点击人物非头部区域可打开独立聊天窗口
- 拖动人物：移动虚拟形象窗口
- 右键 / 系统托盘：打开聊天、显示灵、设置、退出
- 聊天窗口与虚拟形象窗口相互独立，关闭聊天不会隐藏灵
- 聊天框边缘可拉伸
- 直接说需求即可。核心是：你提需求，灵就动手去做。例如「下午 3 点提醒我吃药」「把 D:\\work\\总结.docx 转成 pdf」「做一个待办网页」。有现成能力会直接用；没有就读写文件、运行命令去试。默认工作目录是项目里的 `LingProjects`。系统目录不会写入。转 PDF 需要 Microsoft Office 或 LibreOffice。聊天框可以点「图」、粘贴或拖入图片。
- 记忆分成两份 markdown，都在项目目录：长期记忆 `memory/long-term.md`，短期记忆 `memory/short-term/日期.md`。每次对话会导入长期记忆 + 近两天短期记忆作为上下文。直接改这些文件即可。设置、聊天记录和图片缓存在 `data/`。
