/** Puts `text` on the clipboard. False where the native clipboard is not there (the test renderer). */
export function copyText(text: string): boolean {
  try {
    const { Clipboard } = require('react-native');
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}
