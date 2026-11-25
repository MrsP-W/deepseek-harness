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

The shell is a session rail, a workflow column, and a code column. The workflow column shows static steps, a static execution trace, and a draft field. The code column shows the placeholder file `src/lib/split.ts`. The draft stays in the page. Dragging the boundary, or pressing Left or Right on it, changes the workflow width. The width stays inside the measured shell and leaves at least 200px for the code column when the shell is wide enough, including the desktop minimum window of 520px. The workflow header and the editor tab bar are macOS window-drag rows. The shell does not read Session events or the workflow engine.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One registration fills the `workbench` slot declared by ui-layout and registers the `workbench` locale. The component measures its own box and clamps the workflow track to the space that remains after the 56px rail and the code column's floor.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-layout](../ui-layout/README.md) — declares the `workbench` slot and renders it for the desktop document.

-----

<a id="model-experience"></a>
## Model Experience

None. The shell is static presentation and does not reach a model request.

#### KV Cache effect

None. This package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are the current shell. They are not a backlog of live trajectory wiring.

- **Steps, the trace, and the editor file are placeholders** — the draft is local to the page, and the rail icons do not open other pages.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
