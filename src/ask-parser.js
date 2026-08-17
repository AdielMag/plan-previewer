/**
 * Parsing / normalization helpers for agent-authored questions ("asks").
 *
 * Agents must never ask the user questions in the CLI/chat while a plan review
 * is in flight - they push them into the live previewer instead, either with
 * `--ask="..."`, `--ask-file=<json|md>`, or by dropping a `.plan-questions.json`
 * next to the plan file. This module turns all of those inputs into one
 * normalized shape the server and browser understand.
 *
 * Normalized question:
 * {
 *   id: string,
 *   type: 'choice' | 'text',
 *   title: string,
 *   question: string,
 *   options: [{ label, description, recommended }]   // choice only
 * }
 */

let autoIdCounter = 0;

function nextAutoId(prefix = 'q') {
  autoIdCounter += 1;
  return `${prefix}${autoIdCounter}_${Date.now().toString(36)}`;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalizes a single raw question spec (object or plain string).
 * @returns {object|null} normalized question, or null when unusable.
 */
export function normalizeQuestion(raw) {
  if (!raw) return null;

  if (typeof raw === 'string') {
    const text = cleanString(raw);
    if (!text) return null;
    return {
      id: nextAutoId('ask'),
      type: 'text',
      title: 'Agent Question',
      question: text,
      options: [],
    };
  }

  if (typeof raw !== 'object') return null;

  const question = cleanString(raw.question) || cleanString(raw.text) || cleanString(raw.prompt);
  const title = cleanString(raw.title) || cleanString(raw.label) || 'Agent Question';

  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions
    .map((opt) => {
      if (typeof opt === 'string') {
        const label = cleanString(opt);
        return label ? { label, description: '', recommended: false } : null;
      }
      if (!opt || typeof opt !== 'object') return null;
      const label = cleanString(opt.label) || cleanString(opt.value) || cleanString(opt.title);
      if (!label) return null;
      return {
        label,
        description: cleanString(opt.description),
        recommended: Boolean(opt.recommended || opt.default),
      };
    })
    .filter(Boolean);

  const type = (raw.type === 'choice' || options.length > 0) ? 'choice' : 'text';
  if (!question && !title) return null;

  return {
    id: cleanString(raw.id) || nextAutoId('ask'),
    type,
    title,
    question: question || title,
    options: type === 'choice' ? options : [],
  };
}

/**
 * Normalizes an arbitrary list (or single item) of question specs.
 */
export function normalizeQuestions(input) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  return list.map(normalizeQuestion).filter(Boolean);
}

/**
 * Parses markdown containing `> [!QUESTION] Title` / `> [!CHOICE] Title` blocks
 * into normalized question specs. Option lines use the same `- ( )` / `- (x)`
 * radio syntax as the rich-plan-formatting skill.
 */
export function parseAskMarkdown(markdown) {
  if (!markdown || typeof markdown !== 'string') return [];

  const lines = markdown.split(/\r?\n/);
  const questions = [];
  let current = null;

  const flush = () => {
    if (current) {
      questions.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    const blockquote = line.match(/^\s*>\s?(.*)$/);
    if (!blockquote) {
      flush();
      continue;
    }
    const body = blockquote[1].trim();

    const header = body.match(/^\[!(QUESTION|CHOICE)\]\s*(.*)$/i);
    if (header) {
      flush();
      current = {
        id: nextAutoId('ask'),
        type: header[1].toLowerCase() === 'choice' ? 'choice' : 'text',
        title: cleanString(header[2]) || 'Agent Question',
        question: '',
        options: [],
      };
      continue;
    }

    if (!current) continue;

    const option = body.match(/^[-*]\s*\(([ xX])\)\s*(.+)$/);
    if (option) {
      const recommended = option[1].toLowerCase() === 'x' || /\[recommended\]/i.test(option[2]);
      let label = option[2].replace(/\s*\[recommended\]\s*/i, '').trim();
      let description = '';
      const bold = label.match(/^\*\*([^*]+)\*\*\s*[:\-–—]?\s*(.*)$/);
      if (bold) {
        label = bold[1].trim();
        description = bold[2].trim();
      }
      current.type = 'choice';
      current.options.push({ label, description, recommended });
      continue;
    }

    const questionLine = body.replace(/^\*\*Question\*\*\s*[:\-]?\s*/i, '').trim();
    if (questionLine) {
      current.question = current.question ? `${current.question}\n${questionLine}` : questionLine;
    }
  }

  flush();

  return questions
    .map((q) => ({ ...q, question: q.question || q.title }))
    .filter((q) => q.question);
}

/**
 * Parses the content of an --ask-file: JSON array/object, or markdown blocks.
 */
export function parseAskFileContent(content) {
  const text = cleanString(content);
  if (!text) return [];

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.questions) ? parsed.questions : [parsed]);
      return normalizeQuestions(list);
    } catch (err) {
      // fall through to markdown parsing
    }
  }

  const fromMarkdown = parseAskMarkdown(text);
  if (fromMarkdown.length > 0) return normalizeQuestions(fromMarkdown);

  // Last resort: treat each non-empty line as a free-text question.
  return normalizeQuestions(text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean));
}

/**
 * Parses a single `--ask=<value>` CLI argument. Accepts plain text shorthand
 * or an inline JSON object/array for choice questions.
 */
export function parseAskArg(value) {
  const text = cleanString(value);
  if (!text) return [];
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return normalizeQuestions(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      // Not valid JSON - fall back to treating it as literal question text.
    }
  }
  return normalizeQuestions(text);
}

/**
 * Builds a question round object stored on the server.
 */
export function buildQuestionRound(questions, { roundId, fileVersion }) {
  return {
    roundId,
    askedAt: new Date().toISOString(),
    fileVersion,
    status: 'pending',
    questions,
    answers: [],
  };
}
