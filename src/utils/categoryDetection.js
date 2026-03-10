export function detectCategory(text, categories) {
  const lower = text.toLowerCase();
  for (const category of categories) {
    for (const keyword of (category.keywords || [])) {
      if (lower.includes(keyword.toLowerCase())) {
        return category;
      }
    }
  }
  return null;
}
