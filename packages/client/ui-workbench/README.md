---
description: "Desktop workbench shell for the Web client: a session rail, a workflow column, and a code column shown together."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

This package draws the desktop workbench shell. It occupies the layout frame's `workbench` slot. The frame renders that slot only after the desktop document sets `__DSH_DESKTOP_WORKBENCH__`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The shell is a light workbench: a session rail, a workflow column, and a code column, with off-white grounds, near-black text, and one quiet blue. The palette is scoped to this shell. Sending the draft starts a turn on the desktop Session. Steps follow that Session's `todo/write` list, or each turn when the list is absent. The trace follows `tool/call` and `tool/result`. The code column shows text from `write`, `edit`, and an `apply_patch` add-file. Dragging the boundary, or pressing Left or Right on it, changes the workflow width. The width stays inside the measured shell and leaves at least 200px for the code column when the shell is wide enough, including the desktop minimum window of 520px. The workflow header and the editor tab bar are macOS window-drag rows. This is Session activity, not the workflow engine.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One registration fills the `workbench` slot declared by ui-layout and registers the `workbench` locale. It follows the Session this composer started, or the Session retained as the desktop main view, and folds that Session's event window into the shell. The component measures its own box and clamps the workflow track to the space that remains after the 56px rail and the code column's floor.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-layout](../ui-layout/README.md) — declares the `workbench` slot and renders it for the desktop document.

-----

<a id="model-experience"></a>
## Model Experience

The composer sends the draft as one ordinary user message on the current desktop Session. It adds no prompt section of its own.

#### KV Cache effect

None. This package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The rail icons do not open other pages**, and the attachment button does not attach a file.
- **The code column is the text carried by the Session's write and edit calls** — it does not read the workspace filesystem on its own, and it does not apply every `apply_patch` update hunk.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
