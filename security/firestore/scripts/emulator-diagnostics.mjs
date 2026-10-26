// Firebase returns permission-denied for both rule denials and evaluation exhaustion.
// Check the emulator diagnostics as well as the client error, never the code alone.
export function expressionBudgetExceeded(text) {
  return /(?:maximum|max(?:imum)? number|limit|too many|exceed(?:ed|s|ing)?)[^\n]{0,180}expressions?[^\n]{0,180}(?:reach|exceed|1[,.]?000|evaluat)|expressions?[^\n]{0,180}(?:limit|exceed|1[,.]?000)|(?:1[,.]?000)[^\n]{0,100}expressions?/i.test(text);
}

export function currentLogText(previous, current) {
  // Handle both a truncated log and a log appended by the current process.
  return current.startsWith(previous) ? current.slice(previous.length) : current;
}
