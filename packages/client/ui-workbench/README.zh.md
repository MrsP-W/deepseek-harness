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

外壳是浅色工作台：会话栏、工作流栏和代码栏，使用近白底、近黑文字和一处克制的蓝。这套配色只作用于本外壳。工作流栏显示静态步骤、静态执行轨迹和草稿输入。代码栏显示占位文件 `src/lib/split.ts`。草稿留在页面内。拖动分界，或在分界上按左方向键或右方向键，会改变工作流栏宽度。宽度保持在已测量的外壳之内；外壳足够宽时，包括桌面最小窗口 520px，代码栏至少保留 200px。工作流标题和编辑器标签栏是 macOS 窗口拖拽行。外壳不读取会话事件或工作流引擎。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

一次注册填入 ui-layout 声明的 `workbench` slot，并注册 `workbench` 文案。组件测量自身盒子，并把工作流轨道限制在 56px 会话栏和代码栏下限之后剩余的空间内。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-layout](../ui-layout/README.zh.md)——声明 `workbench` slot，并在桌面文档中渲染它。

-----

<a id="model-experience"></a>
## 模型体验

无。外壳是静态呈现，不会进入模型请求。

#### KV 缓存效应

无。本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制是当前外壳。它们不是实时轨迹接线的任务积压。

- **步骤、轨迹和编辑器文件都是占位内容**——草稿只在页面内，会话栏图标不会打开其他页面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
