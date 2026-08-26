# 灵

桌面虚拟人物：透明置顶的 Live2D 伙伴，用 MiniMax-M2 聊天，记住你的喜好，也能帮忙做一些本机小事。

## 运行

```bash
npm install
npm run dev
```

第一次打开后，在设置里粘贴 MiniMax API Key。国内默认接口是 `https://api.minimaxi.com/v1`，模型 `MiniMax-M2`。

Key 保存在项目里的 `data/` 目录，并用系统加密（Windows DPAPI）。该目录已加入 gitignore，不会提交。

## 使用

- 单击人物：打开 / 收起聊天
- 拖动人物：移动窗口
- 右键：聊天、设置、隐藏、退出
- 系统托盘：打开聊天、设置、退出
- 聊天框边缘可拉伸
- 直接说需求即可。例如「把 D:\\work\\总结.docx 转成 pdf」，或「做一个待办网页」。灵能读写文件、运行命令、创建和修改项目。默认工作目录是项目里的 `LingProjects`。系统目录不会写入。转 PDF 需要 Microsoft Office 或 LibreOffice。聊天框可以点「图」、粘贴或拖入图片；看图会使用 MiniMax-M3。
- 记忆分成两份 markdown，都在项目目录：长期记忆 `memory/long-term.md`，短期记忆 `memory/short-term/日期.md`。每次对话会导入长期记忆 + 近两天短期记忆作为上下文。直接改这些文件即可。设置、聊天记录和图片缓存在 `data/`。
