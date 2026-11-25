/**
 * Static editor placeholder for the desktop workbench shell.
 * Line numbers and the annotation rows are part of the empty-shell layout.
 */

/** File path shown in the workflow trace and the editor tab. */
export const SAMPLE_FILE = 'src/lib/split.ts'

/** 1-based cursor line shown in the editor status bar. */
export const CURSOR_LINE = '18'

/** 1-based cursor column shown in the editor status bar. */
export const CURSOR_COLUMN = '1'

/** 1-based source rows that carry the static "written by the workflow" note. */
export const ANNOTATED_LINES = new Set([16, 22])

/** Static TypeScript file. Tool names and this source stay verbatim. */
export const SAMPLE_CODE = [
  '// Splits a payment amount among recipients based on configured rules.',
  'export interface SplitRule {',
  "  type: 'percentage' | 'fixed' | 'ratio';",
  '  value: number;',
  '  recipientId: string;',
  '}',
  '',
  'export interface PaymentSplitRequest {',
  '  totalAmount: number;',
  '  currency: string;',
  '  rules: SplitRule[];',
  '}',
  '',
  'export async function splitPayment(totalAmount: number): Promise<number> {',
  '  if (totalAmount <= 0) {',
  "    throw new Error('amount');",
  '  }',
  '  let remaining = totalAmount;',
  '  for (const rule of rules) {',
  '    switch (rule.type) {',
  "      case 'percentage':",
  '        amount = Math.round(totalAmount * (rule.value / 100));',
  '        break;',
  '    }',
  '  }',
  '  return remaining;',
  '}',
]
