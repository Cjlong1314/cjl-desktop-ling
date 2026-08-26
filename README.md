# 灵

桌面虚拟人物：透明置顶的 Live2D 伙伴，用 MiniMax-M2 聊天，记住你的喜好，也能帮忙做一些本机小事。

## 运行

```bash
npm install
npm run dev
```

第一次打开后，在设置里粘贴 MiniMax API Key。国内默认接口是 `https://api.minimaxi.com/v1`，模型 `MiniMax-M2`。

Key 只保存在本机用户目录，并用系统加密（Windows DPAPI），不会写入项目文件。

## 使用

- 单击人物：打开 / 收起聊天
- 拖动人物：移动窗口
- 右键：聊天、设置、隐藏、退出
- 系统托盘：显示、设置、退出
- 聊天框边缘可拉伸
- 直接说需求即可，例如「把 D:\\work\\总结.docx 转成 pdf」「读一下桌面上的笔记.txt 并改得更通顺」。灵可以读写任意位置的文本文件、查找、复制、转 PDF、打开文件。系统目录（Windows、Program Files）不会写入。转 PDF 需要 Microsoft Office 或 LibreOffice。
