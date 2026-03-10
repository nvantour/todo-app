const SPLIT_PATTERNS = [
  /\s+en\s+(?:ook\s+)?/i,
  /\s+ook\s+/i,
  /\s+daarnaast\s+/i,
  /\s*,\s+en\s+/i,
  /\s*,\s+/,
  /\s*;\s+/,
  /\s*\d+[.)]\s+/,
];

export function parseVoiceText(text) {
  if (!text || !text.trim()) return [];

  let items = [text.trim()];

  for (const pattern of SPLIT_PATTERNS) {
    const newItems = [];
    for (const item of items) {
      const parts = item.split(pattern).filter(p => p && p.trim().length > 2);
      if (parts.length > 1) {
        newItems.push(...parts.map(p => p.trim()));
      } else {
        newItems.push(item);
      }
    }
    if (newItems.length > items.length) {
      items = newItems;
      break;
    }
  }

  return items
    .map(item => item.trim())
    .filter(item => item.length > 2)
    .map(item => item.charAt(0).toUpperCase() + item.slice(1));
}
