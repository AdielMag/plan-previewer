/**
 * Helper utilities for parsing choice cards and building activity streams.
 */

/**
 * Parses an individual option line from a [!CHOICE] blockquote list item.
 *
 * @param {string} rawText The text content of the <li>
 * @returns {object} Parsed option metadata
 */
export function parseChoiceOptionText(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return {
      raw: '',
      clean: '',
      title: '',
      description: '',
      isRecommended: false,
      isDefaultChecked: false,
    };
  }

  const trimmed = rawText.trim();
  const isDefaultChecked = /^\([xX]\)/.test(trimmed);
  const hasRecommendedTag = /\[recommended\]/i.test(trimmed);
  const isRecommended = isDefaultChecked || hasRecommendedTag;

  // Strip radio markers: ( ), (x), (X)
  let clean = trimmed.replace(/^\([ xX]\)\s*/, '');
  // Strip [Recommended] tag from clean display text
  clean = clean.replace(/\s*\[recommended\]\s*/i, '').trim();

  let title = clean;
  let description = '';

  // Match bold titles: **Option A**: Description or **Option A** - Description
  const boldMatch = clean.match(/^\*\*([^*]+)\*\*[:\-—]?\s*(.*)$/);
  if (boldMatch) {
    title = boldMatch[1].trim();
    description = boldMatch[2].trim();
  } else {
    // Match paren descriptions: Option A (Fast in-memory cache)
    const parenMatch = clean.match(/^([^(]+)\(([^)]+)\)\s*$/);
    if (parenMatch && parenMatch[1].trim().length > 0) {
      title = parenMatch[1].trim();
      description = parenMatch[2].trim();
    }
  }

  return {
    raw: trimmed,
    clean,
    title,
    description,
    isRecommended,
    isDefaultChecked,
  };
}

/**
 * Normalizes user choices and answers for serialization and activity display.
 */
export function formatActivityChoiceLabel(choice) {
  if (!choice) return '';
  if (choice.type === 'choice') {
    return choice.selected ? `${choice.title}: ${choice.selected}` : `${choice.title}: (None selected)`;
  }
  if (choice.type === 'question') {
    return choice.answer ? `${choice.title}: "${choice.answer}"` : `${choice.title}: (Unanswered)`;
  }
  return choice.title || '';
}
