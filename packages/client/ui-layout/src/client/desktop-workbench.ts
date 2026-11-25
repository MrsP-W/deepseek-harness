/**
 * Desktop document marker for the workbench shell.
 * The desktop application index sets the flag before the client starts.
 * The Web app leaves it unset and keeps the three-column frame.
 */

declare global {
  /**
   * True only in the desktop application document.
   * Absent in Web and in shell documents that do not opt in.
   */
  var __DSH_DESKTOP_WORKBENCH__: boolean | undefined
}

/**
 * Whether this document should render the workbench shell.
 * @returns True when the desktop index set the marker to true.
 */
export function isDesktopWorkbenchDocument(): boolean {
  return globalThis.__DSH_DESKTOP_WORKBENCH__ === true
}
