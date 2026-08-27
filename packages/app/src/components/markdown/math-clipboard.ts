export function getMathClipboardText(content: string, displayMode: boolean): string {
  return displayMode ? `$$${content}$$` : `$${content}$`;
}
