---
description: "Web 客户端的桌面工作台外壳：会话栏、工作流栏和代码栏同时显示。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

本包绘制桌面工作台外壳。它占据布局框架的 `workbench` slot。框架只在桌面文档设置 `__DSH_DESKTOP_WORKBENCH__` 之后渲染该 slot。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

外壳是浅色工作台：会话栏、工作流栏和代码栏，使用暖灰底、米色卡片、近黑文字和一处克制的蓝。这套配色只作用于本外壳。发送草稿会在桌面会话上开始一轮。步骤跟随该会话的 `todo/write` 列表；没有列表时，每一轮是一个步骤。轨迹跟随 `tool/call` 和 `tool/result`。代码栏显示 `write`、`edit` 和 `apply_patch` 新增文件里的文本。拖动分界，或在分界上按左方向键或右方向键，会改变工作流栏宽度。宽度保持在已测量的外壳之内；外壳足够宽时，包括桌面最小窗口 520px，代码栏至少保留 200px。工作流标题和编辑器标签栏是 macOS 窗口拖拽行。这是会话活动，不是工作流引擎。

桌面进程提供 `generationMonitor` 时，同一外壳监视本机 Codex 和反重力日志。总览把侧栏、当前会话卡片、实时代码卡片、会话列表和事件流放在同一屏里。会话名先用对话标题，再用提问，两者都没有时才用项目目录，不用日志文件名。代码卡片同时显示提问、读到的或修改前的文本，以及写出去的文本。某一侧还没有内容时，只显示这一侧的空状态。标签只显示最后的文件名。当前会话卡片显示状态、当前步骤、本次改动的文件、已进行时间和状态计数。这个视图是只读的。它大约每 1.5 秒刷新一次，日志增长时也会刷新。它不启动、停止或批准会话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

一次注册填入 ui-layout 声明的 `workbench` slot，并注册 `workbench` 文案。它跟随本输入框开始的会话，或作为桌面主视图保留的会话，并把该会话的事件窗口折叠进外壳。组件测量自身盒子，并把工作流轨道限制在 56px 会话栏和代码栏下限之后剩余的空间内。桌面主进程列出并尾读允许的 Codex rollout 文件和反重力记录。外壳轮询这条桥，并把完整的 JSONL 行折叠成会话。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-layout](../ui-layout/README.zh.md)——声明 `workbench` slot，并在桌面文档中渲染它。

-----

<a id="model-experience"></a>
## 模型体验

输入框把草稿作为当前桌面会话上的一条普通用户消息发送。它不另加自己的提示词段落。

#### KV 缓存效应

无。本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **监视器不控制 Codex 或反重力。** 它没有允许、拒绝、跳转或停止动作。
- **代码栏只在被监视的写入或编辑在日志里没有文本时，读取一个被允许的本地文件。** 它仍然不会套用每一个 `apply_patch` 更新块。主目录以外的路径，以及 auth、cookie、Application Support、归档会话和 sqlite 文件，不会被读取。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
