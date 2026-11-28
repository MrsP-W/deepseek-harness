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

The shell is a light workbench: a session rail, a workflow column, and a code column, with a warm gray ground, cream cards, near-black text, and one quiet blue. The palette is scoped to this shell. Sending the draft starts a turn on the desktop Session. Steps follow that Session's `todo/write` list, or each turn when the list is absent. The trace follows `tool/call` and `tool/result`. The code column shows text from `write`, `edit`, and an `apply_patch` add-file. Dragging the boundary, or pressing Left or Right on it, changes the workflow width. The width stays inside the measured shell and leaves at least 200px for the code column when the shell is wide enough, including the desktop minimum window of 520px. The workflow header and the editor tab bar are macOS window-drag rows. This is Session activity, not the workflow engine.

When the desktop process exposes `generationMonitor`, the same shell watches local Codex and Antigravity logs. The overview is a left icon rail for Overview, Sources, and Settings, a top bar with the title, watching status, search, and day or night, then a highlight card, a live code output for the file that session is writing, the session list with an all / Codex / Antigravity filter, and that session's event feed. The highlight card shows status, the current step, files changed in the run, elapsed time, and status counts. The view is read-only. It refreshes about every 1.5 seconds and when a log grows. It does not start, stop, or approve a session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

One registration fills the `workbench` slot declared by ui-layout and registers the `workbench` locale. It follows the Session this composer started, or the Session retained as the desktop main view, and folds that Session's event window into the shell. The component measures its own box and clamps the workflow track to the space that remains after the 56px rail and the code column's floor. The desktop main process lists and tails allowed Codex rollout files and Antigravity transcripts. The shell polls that bridge and folds complete JSONL lines into sessions.

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

- **The monitor does not control Codex or Antigravity.** It has no allow, deny, jump, or stop action.
- **The code column reads an allowed local file only when a monitored write or edit has no text in the log.** It still does not apply every `apply_patch` update hunk. Paths outside the home directory, and auth, cookie, Application Support, archived-session, and sqlite files, are not read.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
