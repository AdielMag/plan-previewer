// Plan Previewer Client Application

let state = {
  filename: 'plan.md',
  filePath: '',
  content: '',
  fileVersion: 1,
  callerAgent: { id: 'claude', name: 'Claude Code', icon: '🤖', badge: 'Claude Code', color: '#D97706', accentColor: '#F59E0B' },
  sessionContext: 'Plan Overview',
  questions: [],
  feedbackHistory: [],
  agentResponses: [],
  selections: {}, // { [choiceTitle]: { selectedText, cleanTitle, isRecommended } }
  draftAnswers: {}, // { [questionTitle]: answerText }
  nextQuestionId: 1,
  popover: { visible: false, x: 0, y: 0, text: '', range: null },
  footerComment: '',
  status: 'in_review', // 'in_review', 'approved', 'changes_requested'
  serverAlive: true,
  widthMode: 'wide',
  collapseLeft: false,
  collapseRight: false
};

let currentTheme = 'light';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  initTheme();
  initLayoutSettings();
  setupEventListeners();
  startHeartbeat();
  startFilePolling();
  await fetchPlanData();
}

function initTheme() {
  const saved = localStorage.getItem('plan-previewer-theme');
  if (saved === 'dark' || saved === 'light') {
    currentTheme = saved;
  } else {
    currentTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  applyTheme(currentTheme);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('plan-previewer-theme', theme);

  const hlThemeLink = document.getElementById('highlightTheme');
  if (hlThemeLink) {
    if (theme === 'dark') {
      hlThemeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css';
    } else {
      hlThemeLink.href = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css';
    }
  }

  const sunIcon = document.querySelector('#btnThemeToggle .icon-sun');
  const moonIcon = document.querySelector('#btnThemeToggle .icon-moon');
  const themeLabel = document.getElementById('themeLabelText');

  if (theme === 'dark') {
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'inline-block';
    if (themeLabel) themeLabel.textContent = 'Dark';
  } else {
    if (sunIcon) sunIcon.style.display = 'inline-block';
    if (moonIcon) moonIcon.style.display = 'none';
    if (themeLabel) themeLabel.textContent = 'Light';
  }

  if (window.mermaid) {
    window.mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose'
    });
  }
}

function toggleTheme() {
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
  renderMarkdown();
}

function initLayoutSettings() {
  const savedWidth = localStorage.getItem('plan-previewer-width-mode') || 'wide';
  setWidthMode(savedWidth);

  const savedCollapseLeft = localStorage.getItem('plan-previewer-collapse-left') === 'true';
  const savedCollapseRight = localStorage.getItem('plan-previewer-collapse-right') === 'true';
  setSidebarCollapsed('left', savedCollapseLeft);
  setSidebarCollapsed('right', savedCollapseRight);
}

function setWidthMode(mode) {
  state.widthMode = mode;
  const layout = document.getElementById('appLayout');
  if (layout) layout.setAttribute('data-width-mode', mode);
  localStorage.setItem('plan-previewer-width-mode', mode);

  document.querySelectorAll('.width-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.width === mode);
  });
}

function setSidebarCollapsed(side, collapsed) {
  const layout = document.getElementById('appLayout');
  if (!layout) return;

  if (side === 'left') {
    state.collapseLeft = collapsed;
    layout.classList.toggle('collapse-left', collapsed);
    localStorage.setItem('plan-previewer-collapse-left', String(collapsed));
    const btn = document.getElementById('btnToggleToc');
    if (btn) btn.classList.toggle('collapsed', collapsed);
  } else if (side === 'right') {
    state.collapseRight = collapsed;
    layout.classList.toggle('collapse-right', collapsed);
    localStorage.setItem('plan-previewer-collapse-right', String(collapsed));
    const btn = document.getElementById('btnToggleActivity');
    if (btn) btn.classList.toggle('collapsed', collapsed);
  }
}

function startHeartbeat() {
  setInterval(() => {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  }, 2000);
}

function summarizeDiff(oldContent, newContent) {
  if (typeof Diff === 'undefined' || !Diff.diffLines) return null;

  const parts = Diff.diffLines(oldContent || '', newContent || '');
  let added = 0;
  let removed = 0;
  const changedHeadings = new Set();

  parts.forEach((part) => {
    if (!part.added && !part.removed) return;
    const lines = part.value.split('\n').filter((l) => l.length > 0);
    if (part.added) added += lines.length;
    if (part.removed) removed += lines.length;
    lines.forEach((line) => {
      const m = line.match(/^\s{0,3}(#{1,2})\s+(.+)$/);
      if (m) changedHeadings.add(m[2].trim());
    });
  });

  if (added === 0 && removed === 0) return null;

  return {
    added,
    removed,
    headings: Array.from(changedHeadings).slice(0, 5),
  };
}

function startFilePolling() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/version');
      const data = await res.json();

      if (!state.serverAlive) {
        state.serverAlive = true;
        state.fileVersion = data.fileVersion || 1;
        updateSubmitButtonsEnabled();

        const planRes = await fetch('/api/plan');
        const planData = await planRes.json();
        if (planData.success) {
          const contentChanged = planData.content !== state.content;
          state.agentResponses = planData.agentResponses || state.agentResponses;
          if (contentChanged) {
            const diffSummary = summarizeDiff(state.content, planData.content);
            const latestResponse = (state.agentResponses && state.agentResponses.length)
              ? state.agentResponses[state.agentResponses.length - 1].text
              : '';

            state.feedbackHistory.forEach(item => {
              if (item.status === 'pending') {
                item.status = 'addressed';
                item.addressedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                item.diffSummary = diffSummary;
                item.agentNote = latestResponse;
              }
            });
            await fetchPlanData();
            showAgentUpdateToast('Plan updated live by agent!');
            renderQuestionsSidebar();
          }
        }
        return;
      }

      // Same server instance running: check if external edit changed plan content
      if (data.fileVersion && data.fileVersion > state.fileVersion) {
        state.fileVersion = data.fileVersion;

        const planRes = await fetch('/api/plan');
        const planData = await planRes.json();

        if (planData.success) {
          state.agentResponses = planData.agentResponses || state.agentResponses;
          if (planData.content !== state.content) {
            const diffSummary = summarizeDiff(state.content, planData.content);
            const latestResponse = (state.agentResponses && state.agentResponses.length)
              ? state.agentResponses[state.agentResponses.length - 1].text
              : '';

            state.feedbackHistory.forEach(item => {
              if (item.status === 'pending') {
                item.status = 'addressed';
                item.addressedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                item.diffSummary = diffSummary;
                item.agentNote = latestResponse;
              }
            });

            await fetchPlanData();
            showAgentUpdateToast('Plan updated live by agent!');
            renderQuestionsSidebar();
          }
        }
      }
    } catch (err) {
      if (state.serverAlive) {
        state.serverAlive = false;
        updateSubmitButtonsEnabled();
      }
    }
  }, 1000);
}

function updateActionButtonsState() {
  const requestBtn = document.getElementById('btnRequestChanges');
  if (!requestBtn) return;

  const commentVal = document.getElementById('footerComment')?.value.trim() || '';
  const hasSelections = Object.keys(state.selections).length > 0;
  const hasAnswers = Object.keys(state.draftAnswers).length > 0;
  const hasQuestions = state.questions.length > 0;
  const hasPendingActivity = Boolean(commentVal || hasSelections || hasAnswers || hasQuestions);

  if (!state.serverAlive) {
    requestBtn.disabled = true;
    requestBtn.classList.add('btn-disabled');
    requestBtn.title = 'Waiting for the agent to respond...';
    return;
  }

  requestBtn.disabled = !hasPendingActivity;
  requestBtn.classList.toggle('btn-disabled', !hasPendingActivity);
  requestBtn.title = hasPendingActivity
    ? 'Transmit requested changes & selections to agent'
    : 'Select an option, answer a question, leave a text note, or type a comment to request changes';
}

function updateSubmitButtonsEnabled() {
  const requestBtn = document.getElementById('btnRequestChanges');
  const approveBtn = document.getElementById('btnApprovePlan');
  if (!requestBtn || !approveBtn) return;

  approveBtn.disabled = !state.serverAlive;
  approveBtn.title = state.serverAlive ? 'Approve plan and start execution' : 'Waiting for the agent to respond...';

  updateActionButtonsState();
}

function showAgentUpdateToast(msg) {
  const banner = document.getElementById('agentToastBanner');
  const msgSpan = document.getElementById('toastMessage');
  if (banner && msgSpan) {
    msgSpan.textContent = msg;
    banner.style.display = 'flex';
    setTimeout(() => {
      banner.style.display = 'none';
    }, 4000);
  }
}

async function fetchPlanData() {
  try {
    const res = await fetch('/api/plan');
    const data = await res.json();
    if (data.success) {
      state.filename = data.filename || 'plan.md';
      state.filePath = data.filePath || '';
      state.content = data.content || '';
      state.fileVersion = data.fileVersion || state.fileVersion;
      state.callerAgent = data.callerAgent || state.callerAgent;
      state.sessionContext = data.sessionContext || extractPlanGoal(data.content);
      state.agentResponses = data.agentResponses || [];

      // Save to localStorage as fallback so page is NEVER blank
      if (state.content) {
        try {
          localStorage.setItem('plan-previewer-cached-content', state.content);
          localStorage.setItem('plan-previewer-cached-meta', JSON.stringify({
            filename: state.filename,
            filePath: state.filePath,
            sessionContext: state.sessionContext,
            callerAgent: state.callerAgent
          }));
        } catch (e) {}
      }

      updateHeader();
      renderMarkdown();
      renderQuestionsSidebar();
    }
  } catch (err) {
    console.warn('Could not fetch live plan data (server may be offline):', err);
    // Restore from localStorage cache so the plan is never empty
    const cachedContent = localStorage.getItem('plan-previewer-cached-content');
    if (cachedContent && !state.content) {
      state.content = cachedContent;
      try {
        const meta = JSON.parse(localStorage.getItem('plan-previewer-cached-meta') || '{}');
        if (meta.filename) state.filename = meta.filename;
        if (meta.filePath) state.filePath = meta.filePath;
        if (meta.sessionContext) state.sessionContext = meta.sessionContext;
        if (meta.callerAgent) state.callerAgent = meta.callerAgent;
      } catch (e) {}
      updateHeader();
      renderMarkdown();
      renderQuestionsSidebar();
    }
  }
}

function extractPlanGoal(content) {
  if (!content) return 'Plan Overview';
  const match = content.match(/^#\s+(.+)$/m);
  return match && match[1] ? match[1].trim() : 'Plan Overview';
}

function updateHeader() {
  const agentName = state.callerAgent.name || 'Claude Code';
  const avatar = document.getElementById('agentAvatar');
  avatar.textContent = getAgentAvatarSymbol(state.callerAgent);
  avatar.style.cssText = getAgentAvatarStyle(state.callerAgent);

  document.getElementById('agentName').textContent = agentName;
  document.getElementById('pathLine').textContent = `${state.filename} · ${state.filePath}`;
  document.getElementById('goalTitle').textContent = state.sessionContext;

  updateStatusPill(state.status);
}

function updateStatusPill(status) {
  const pill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');

  pill.className = 'status-pill';

  if (status === 'approved') {
    pill.classList.add('status-approved');
    statusText.textContent = 'Approved';
  } else if (status === 'changes_requested') {
    pill.classList.add('status-changes');
    statusText.textContent = 'Changes requested';
  } else {
    pill.classList.add('status-review');
    statusText.textContent = 'Awaiting review';
  }
}

function simpleMarkdownParse(md) {
  if (!md) return '';
  let html = '';
  const lines = md.split(/\r?\n/);
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBuffer = [];
  let inList = false;
  let inBlockquote = false;
  let bqBuffer = [];

  function flushBlockquote() {
    if (bqBuffer.length > 0) {
      html += `<blockquote>${simpleMarkdownParse(bqBuffer.join('\n'))}</blockquote>\n`;
      bqBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        flushBlockquote();
        if (inList) { html += '</ul>\n'; inList = false; }
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
        codeBuffer = [];
      } else {
        inCodeBlock = false;
        html += `<pre><code class="language-${codeBlockLang}">${escapeHtml(codeBuffer.join('\n'))}</code></pre>\n`;
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Blockquotes
    if (line.startsWith('>')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      bqBuffer.push(line.replace(/^>\s?/, ''));
      continue;
    } else {
      flushBlockquote();
    }

    // Horizontal rules
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      if (inList) { html += '</ul>\n'; inList = false; }
      html += '<hr>\n';
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) { html += '</ul>\n'; inList = false; }
      const level = headingMatch[1].length;
      html += `<h${level}>${formatInlineMarkdown(headingMatch[2])}</h${level}>\n`;
      continue;
    }

    // Lists & task lists
    const taskMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      if (!inList) { html += '<ul>\n'; inList = true; }
      const checked = taskMatch[1].toLowerCase() === 'x' ? 'checked' : '';
      html += `<li><input type="checkbox" ${checked} disabled> ${formatInlineMarkdown(taskMatch[2])}</li>\n`;
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      if (!inList) { html += '<ul>\n'; inList = true; }
      html += `<li>${formatInlineMarkdown(listMatch[1])}</li>\n`;
      continue;
    }

    if (inList && line.trim() === '') {
      html += '</ul>\n';
      inList = false;
      continue;
    }

    // Tables
    if (line.includes('|') && line.trim().startsWith('|')) {
      if (inList) { html += '</ul>\n'; inList = false; }
      // Table rows
      if (line.includes('---')) continue; // delimiter row
      const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
      html += `<tr>${cells.map(c => `<td>${formatInlineMarkdown(c)}</td>`).join('')}</tr>\n`;
      continue;
    }

    // Paragraphs
    if (line.trim() !== '') {
      html += `<p>${formatInlineMarkdown(line)}</p>\n`;
    }
  }

  flushBlockquote();
  if (inList) { html += '</ul>\n'; inList = false; }
  return html;
}

function formatInlineMarkdown(text) {
  if (!text) return '';
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

async function renderMarkdown() {
  const output = document.getElementById('renderedOutput');
  if (!output) return;

  if (!state.content) {
    const cachedContent = localStorage.getItem('plan-previewer-cached-content');
    if (cachedContent) {
      state.content = cachedContent;
    } else {
      output.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <p>No plan content loaded. Waiting for agent session...</p>
        </div>`;
      return;
    }
  }

  let rawHtml = '';
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    try {
      if (typeof marked.setOptions === 'function') {
        marked.setOptions({ gfm: true, breaks: false });
      }
      rawHtml = marked.parse(state.content);
    } catch (e) {
      console.warn('Marked.js error, falling back:', e);
      rawHtml = simpleMarkdownParse(state.content);
    }
  } else {
    rawHtml = simpleMarkdownParse(state.content);
  }

  output.innerHTML = rawHtml;

  // Process GitHub callout alerts & interactive Choice/Question cards
  try { processGitHubAlerts(output); } catch (e) { console.warn('Alert processing error:', e); }

  // Process image placeholders
  try {
    output.querySelectorAll('img').forEach((img) => {
      const div = document.createElement('div');
      div.className = 'img-slot';
      div.textContent = '◇ ' + (img.alt || 'Diagram placeholder');
      img.replaceWith(div);
    });
  } catch (e) {}

  // Render Mermaid diagrams
  try { await processMermaidDiagrams(output); } catch (e) { console.warn('Mermaid render error:', e); }

  // Highlight code blocks
  try {
    if (typeof hljs !== 'undefined') {
      output.querySelectorAll('pre code').forEach((block) => {
        if (!block.classList.contains('language-mermaid')) {
          hljs.highlightElement(block);
        }
      });
    }
  } catch (e) {}

  // Process file diff badges and risk tags
  try { processVisualBadges(output); } catch (e) {}

  // Process task checkboxes & update progress bar
  try { processCheckboxes(); } catch (e) {}

  // Generate Table of Contents navigation sidebar
  try { generateTableOfContents(output); } catch (e) {}
}

function processGitHubAlerts(container) {
  let choiceGroupIdx = 0;

  container.querySelectorAll('blockquote').forEach((bq) => {
    const text = bq.textContent.trim();
    const alertMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|CHOICE|QUESTION)\](?:\s+(.+))?/i);

    if (alertMatch) {
      const alertType = alertMatch[1].toLowerCase();
      const titleText = alertMatch[2] ? alertMatch[2].trim() : alertType.toUpperCase();

      if (alertType === 'choice') {
        renderInteractiveChoiceCard(bq, titleText, choiceGroupIdx++);
        return;
      }

      if (alertType === 'question') {
        renderInteractiveQuestionCard(bq, titleText);
        return;
      }

      bq.classList.add('github-alert', `alert-${alertType}`);
      
      const header = document.createElement('div');
      header.className = 'alert-title';
      
      let iconSvg = '';
      if (alertType === 'note') {
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
      } else if (alertType === 'tip') {
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8.5 14.5A5 5 0 1 1 15.5 14.5"/><path d="M12 6v-3"/><path d="M12 21v-2"/></svg>';
      } else if (alertType === 'important') {
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      } else if (alertType === 'warning') {
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
      } else if (alertType === 'caution') {
        iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      }

      header.innerHTML = `${iconSvg}<span>${titleText}</span>`;
      
      bq.innerHTML = bq.innerHTML.replace(/\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+[^\n<]+)?/gi, '');
      bq.prepend(header);
    }
  });
}

function parseChoiceItemData(rawText) {
  const trimmed = rawText.trim();
  const isDefaultChecked = /^\([xX]\)/.test(trimmed);
  const isRecommended = isDefaultChecked || /\[recommended\]/i.test(trimmed);

  let clean = trimmed.replace(/^\([ xX]\)\s*/, '').replace(/\s*\[recommended\]\s*/i, '').trim();
  let title = clean;
  let description = '';

  const boldMatch = clean.match(/^\*\*([^*]+)\*\*[:\-—]?\s*(.*)$/);
  if (boldMatch) {
    title = boldMatch[1].trim();
    description = boldMatch[2].trim();
  } else {
    const parenMatch = clean.match(/^([^(]+)\(([^)]+)\)\s*$/);
    if (parenMatch && parenMatch[1].trim().length > 0) {
      title = parenMatch[1].trim();
      description = parenMatch[2].trim();
    }
  }

  return { title, description, isRecommended, isDefaultChecked, cleanText: clean };
}

function renderInteractiveChoiceCard(bq, title, groupIdx) {
  const card = document.createElement('div');
  card.className = 'interactive-choice-card';
  card.id = `choice_card_${groupIdx}`;
  card.dataset.choiceTitle = title;

  // Header with title, status chip, and clear button
  const header = document.createElement('div');
  header.className = 'choice-card-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'choice-card-title-group';
  titleGroup.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
    <span>DESIGN CHOICE: ${escapeHtml(title)}</span>`;
  header.appendChild(titleGroup);

  const actions = document.createElement('div');
  actions.className = 'choice-card-actions';

  const statusBadge = document.createElement('span');
  statusBadge.className = 'card-status-badge unanswered';
  statusBadge.textContent = 'Not answered';
  actions.appendChild(statusBadge);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear-choice';
  clearBtn.textContent = 'Clear';
  clearBtn.style.display = 'none';
  actions.appendChild(clearBtn);

  header.appendChild(actions);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'choice-body';

  const items = bq.querySelectorAll('li');
  const paragraph = bq.querySelector('p');

  if (paragraph) {
    const qText = paragraph.innerHTML.replace(/\[!CHOICE\][^\n<]*/gi, '').trim();
    if (qText) {
      const qDiv = document.createElement('div');
      qDiv.className = 'choice-question-text';
      qDiv.innerHTML = qText;
      body.appendChild(qDiv);
    }
  }

  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'choice-options-list';

  function updateCardState(selectedVal) {
    if (selectedVal) {
      statusBadge.className = 'card-status-badge answered';
      statusBadge.textContent = 'Selected';
      clearBtn.style.display = 'inline-block';
      state.selections[title] = { selectedText: selectedVal, cardId: card.id };
    } else {
      statusBadge.className = 'card-status-badge unanswered';
      statusBadge.textContent = 'Not answered';
      clearBtn.style.display = 'none';
      delete state.selections[title];
    }
    updateActionButtonsState();
    renderQuestionsSidebar();
  }

  clearBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    optionsContainer.querySelectorAll('input[type="radio"]').forEach((r) => (r.checked = false));
    optionsContainer.querySelectorAll('.choice-option-item').forEach((el) => el.classList.remove('selected'));
    updateCardState(null);
  });

  items.forEach((li) => {
    const rawText = li.textContent.trim();
    const { title: optTitle, description: optDesc, isRecommended, cleanText } = parseChoiceItemData(rawText);

    const optLabel = document.createElement('label');
    optLabel.className = 'choice-option-item';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `choice_group_${groupIdx}`;
    radio.value = cleanText;
    radio.checked = false;
    radio.style.position = 'absolute';
    radio.style.opacity = '0';
    radio.style.pointerEvents = 'none';

    const indicator = document.createElement('div');
    indicator.className = 'choice-radio-indicator';
    indicator.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'choice-option-content';

    const headerRow = document.createElement('div');
    headerRow.className = 'choice-option-header-row';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'choice-option-title';
    titleSpan.textContent = optTitle;
    headerRow.appendChild(titleSpan);

    if (isRecommended) {
      const recBadge = document.createElement('span');
      recBadge.className = 'badge-recommended';
      recBadge.textContent = 'Recommended';
      headerRow.appendChild(recBadge);
    }
    contentDiv.appendChild(headerRow);

    if (optDesc) {
      const descSpan = document.createElement('span');
      descSpan.className = 'choice-option-desc';
      descSpan.textContent = optDesc;
      contentDiv.appendChild(descSpan);
    }

    optLabel.addEventListener('click', (e) => {
      e.preventDefault();
      const wasSelected = optLabel.classList.contains('selected');

      optionsContainer.querySelectorAll('input[type="radio"]').forEach((r) => (r.checked = false));
      optionsContainer.querySelectorAll('.choice-option-item').forEach((el) => el.classList.remove('selected'));

      if (!wasSelected) {
        radio.checked = true;
        optLabel.classList.add('selected');
        updateCardState(cleanText);
      } else {
        updateCardState(null);
      }
    });

    optLabel.appendChild(radio);
    optLabel.appendChild(indicator);
    optLabel.appendChild(contentDiv);
    optionsContainer.appendChild(optLabel);
  });

  body.appendChild(optionsContainer);
  card.appendChild(body);
  bq.replaceWith(card);
}

function renderInteractiveQuestionCard(bq, title) {
  const card = document.createElement('div');
  card.className = 'interactive-question-card';
  card.id = `question_card_${Math.random().toString(36).slice(2, 8)}`;
  card.dataset.questionTitle = title;

  const header = document.createElement('div');
  header.className = 'choice-card-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'choice-card-title-group question-card-title-group';
  titleGroup.innerHTML = `
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <span>OPEN QUESTION: ${escapeHtml(title)}</span>`;
  header.appendChild(titleGroup);

  const statusBadge = document.createElement('span');
  statusBadge.className = 'card-status-badge unanswered';
  statusBadge.textContent = 'Unanswered';
  header.appendChild(statusBadge);

  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'question-card-body';

  const paragraph = bq.querySelector('p');
  if (paragraph) {
    const qText = paragraph.innerHTML.replace(/\[!QUESTION\][^\n<]*/gi, '').trim();
    if (qText) {
      const qDiv = document.createElement('div');
      qDiv.className = 'choice-question-text';
      qDiv.innerHTML = qText;
      body.appendChild(qDiv);
    }
  }

  const textarea = document.createElement('textarea');
  textarea.className = 'question-card-textarea';
  textarea.placeholder = 'Type your answer or preference for the agent here…';
  textarea.rows = 2;

  let debounceTimer = null;
  textarea.addEventListener('input', () => {
    const val = textarea.value.trim();
    if (val) {
      statusBadge.className = 'card-status-badge answered';
      statusBadge.textContent = 'Answered';
      state.draftAnswers[title] = { answer: val, cardId: card.id };
    } else {
      statusBadge.className = 'card-status-badge unanswered';
      statusBadge.textContent = 'Unanswered';
      delete state.draftAnswers[title];
    }
    updateActionButtonsState();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderQuestionsSidebar();
    }, 200);
  });

  body.appendChild(textarea);
  card.appendChild(body);
  bq.replaceWith(card);
}

async function processMermaidDiagrams(container) {
  if (!window.mermaid) return;

  const mermaidBlocks = container.querySelectorAll('pre code.language-mermaid');
  let idCounter = 0;

  for (const block of mermaidBlocks) {
    const pre = block.parentElement;
    const mermaidCode = block.textContent;

    const diagramDiv = document.createElement('div');
    diagramDiv.className = 'mermaid-container';
    const uniqueId = `mermaid-graph-${Date.now()}-${idCounter++}`;

    try {
      const { svg } = await window.mermaid.render(uniqueId, mermaidCode);
      diagramDiv.innerHTML = svg;
      pre.replaceWith(diagramDiv);
    } catch (err) {
      console.warn('Failed to render Mermaid diagram:', err);
    }
  }
}

function processVisualBadges(container) {
  const badgeMap = [
    { text: '[NEW]', class: 'badge-new' },
    { text: '[MODIFY]', class: 'badge-modify' },
    { text: '[DELETE]', class: 'badge-delete' },
    { text: '[HIGH RISK]', class: 'badge-high-risk' },
    { text: '[LOW RISK]', class: 'badge-low-risk' },
  ];

  container.querySelectorAll('h1, h2, h3, h4, li, p').forEach((el) => {
    let html = el.innerHTML;
    badgeMap.forEach((badge) => {
      if (html.includes(badge.text)) {
        html = html.replace(badge.text, `<span class="badge-tag ${badge.class}">${badge.text.replace(/[[\]]/g, '')}</span>`);
      }
    });
    el.innerHTML = html;
  });
}

function processCheckboxes() {
  const total = document.querySelectorAll('input[type="checkbox"]').length;
  const checked = document.querySelectorAll('input[type="checkbox"]:checked').length;
  const headerProg = document.getElementById('headerProgress');

  if (total > 0 && headerProg) {
    headerProg.style.display = 'flex';
    const percent = Math.round((checked / total) * 100);
    document.getElementById('progressFill').style.width = `${percent}%`;
    document.getElementById('progressText').textContent = `${percent}% Complete`;
  }
}

function generateTableOfContents(container) {
  const tocList = document.getElementById('tocList');
  if (!tocList) return;
  tocList.innerHTML = '';

  const headings = container.querySelectorAll('h1, h2, h3');
  headings.forEach((heading, idx) => {
    const id = `section-${idx}`;
    heading.id = id;

    const item = document.createElement('div');
    item.className = `toc-item toc-${heading.tagName.toLowerCase()}`;
    item.textContent = heading.textContent.replace(/^(#+\s*|\[!(NOTE|TIP|WARNING|CHOICE|QUESTION)\])/, '').trim();

    item.addEventListener('click', () => {
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    tocList.appendChild(item);
  });
}

function scrollAndHighlight(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('highlight-flash');
  void el.offsetWidth; // Trigger reflow
  el.classList.add('highlight-flash');
  setTimeout(() => el.classList.remove('highlight-flash'), 1500);
}

function setupEventListeners() {
  const scrollArea = document.getElementById('docScrollArea');
  const popover = document.getElementById('selectionPopover');

  // Text selection listener for question popover
  scrollArea.addEventListener('mouseup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    const range = sel.getRangeAt(0);
    const output = document.getElementById('renderedOutput');
    if (!output.contains(range.commonAncestorContainer)) return;

    const rect = range.getBoundingClientRect();
    const text = sel.toString().trim();

    let x = rect.left + rect.width / 2 - 155;
    x = Math.max(12, Math.min(x, window.innerWidth - 322));
    let y = rect.bottom + 10;
    if (y > window.innerHeight - 150) y = rect.top - 140;

    state.popover = { visible: true, x, y, text, range: range.cloneRange() };

    popover.style.left = `${x}px`;
    popover.style.top = `${y}px`;
    document.getElementById('popoverQuote').textContent = `"${text.length > 90 ? text.slice(0, 90) + '…' : text}"`;
    document.getElementById('popoverInput').value = '';
    popover.style.display = 'block';

    setTimeout(() => document.getElementById('popoverInput').focus(), 30);
  });

  document.getElementById('btnPopoverCancel').addEventListener('click', closePopover);

  document.getElementById('popoverInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitQuestionFromPopover();
    } else if (e.key === 'Escape') {
      closePopover();
    }
  });

  document.getElementById('btnPopoverAsk').addEventListener('click', submitQuestionFromPopover);

  // Width mode switcher
  document.querySelectorAll('.width-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      setWidthMode(btn.dataset.width);
    });
  });

  // Sidebar toggle buttons
  const btnToggleToc = document.getElementById('btnToggleToc');
  if (btnToggleToc) {
    btnToggleToc.addEventListener('click', () => {
      setSidebarCollapsed('left', !state.collapseLeft);
    });
  }

  const btnToggleActivity = document.getElementById('btnToggleActivity');
  if (btnToggleActivity) {
    btnToggleActivity.addEventListener('click', () => {
      setSidebarCollapsed('right', !state.collapseRight);
    });
  }

  // Theme Switcher button
  const themeToggle = document.getElementById('btnThemeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Close session button
  document.getElementById('btnHeaderClose').addEventListener('click', goBackAndClose);
  document.getElementById('btnModalClose').addEventListener('click', closeTab);

  // Footer comment input listener
  const footerInput = document.getElementById('footerComment');
  if (footerInput) {
    footerInput.addEventListener('input', updateActionButtonsState);
  }

  // Footer Actions
  updateSubmitButtonsEnabled();

  document.getElementById('btnRequestChanges').addEventListener('click', () => {
    if (!state.serverAlive) return;
    submitFeedback('changes_requested');
  });

  document.getElementById('btnApprovePlan').addEventListener('click', () => {
    if (!state.serverAlive) return;
    submitFeedback('approved');
  });
}

function closePopover() {
  const popover = document.getElementById('selectionPopover');
  popover.style.display = 'none';
  state.popover.visible = false;
  window.getSelection().removeAllRanges();
}

function submitQuestionFromPopover() {
  const input = document.getElementById('popoverInput');
  const text = input.value.trim();
  if (!text) return;

  const quote = state.popover.text;
  const questionId = state.nextQuestionId++;

  state.questions.push({
    id: questionId,
    quote,
    text,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  highlightTextSnippet(state.popover.range, questionId);
  closePopover();
  updateActionButtonsState();
  renderQuestionsSidebar();
}

function highlightTextSnippet(range, questionId) {
  if (!range) return;
  try {
    const mark = document.createElement('mark');
    mark.className = 'commark';
    mark.dataset.commentId = questionId;

    const spanBadge = document.createElement('span');
    spanBadge.className = 'commark-badge';
    spanBadge.textContent = 'Q';

    range.surroundContents(mark);
    mark.after(spanBadge);
  } catch (e) {
    console.warn('Could not highlight snippet directly:', e);
  }
}

function getAgentAvatarStyle(agent) {
  if (!agent) return 'background: linear-gradient(135deg, #2563eb, #0284c7);';
  if (agent.color && agent.accentColor) {
    return `background: linear-gradient(135deg, ${agent.color}, ${agent.accentColor});`;
  }
  return 'background: linear-gradient(135deg, #2563eb, #0284c7);';
}

function getAgentAvatarSymbol(agent) {
  if (!agent) return '🤖';
  if (agent.icon) return agent.icon;
  const initial = (agent.name || 'A').trim().charAt(0).toUpperCase();
  return initial || '🤖';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderQuestionsSidebar() {
  const list = document.getElementById('questionsList');
  const badge = document.getElementById('sidebarBadge');

  const selectionKeys = Object.keys(state.selections);
  const draftAnswerKeys = Object.keys(state.draftAnswers);
  const totalDraftCount = selectionKeys.length + draftAnswerKeys.length;
  const totalHistoryCount = state.questions.length + state.feedbackHistory.length;
  const totalItems = totalDraftCount + totalHistoryCount;

  badge.textContent = totalItems;

  if (totalItems === 0) {
    list.innerHTML = `
      <div class="empty-sidebar">
        <div class="empty-icon">💬</div>
        <div class="empty-title">Activity Feed Empty</div>
        <div class="empty-sub">Make design choices in the plan, select text to ask questions, or write overall comments below.</div>
      </div>`;
    return;
  }

  let html = '';

  // 1. Render Draft Selections & Answers Panel (if any active)
  if (totalDraftCount > 0) {
    html += `
      <div class="draft-selections-box">
        <div class="draft-selections-header">
          <span>Draft Choices (${totalDraftCount})</span>
        </div>
        <div class="draft-items-list">`;

    selectionKeys.forEach((title) => {
      const item = state.selections[title];
      html += `
        <div class="draft-selection-pill pill-choice" onclick="scrollAndHighlight('${item.cardId}')" title="Design Choice: Click to scroll to this card">
          <div>
            <span class="pill-title">Choice:</span>
            <span>${escapeHtml(item.selectedText)}</span>
          </div>
          <svg class="pill-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
    });

    draftAnswerKeys.forEach((title) => {
      const item = state.draftAnswers[title];
      html += `
        <div class="draft-selection-pill pill-question" onclick="scrollAndHighlight('${item.cardId}')" title="Question Answer: Click to scroll to this card">
          <div>
            <span class="pill-title">Answer:</span>
            <span>"${escapeHtml(item.answer)}"</span>
          </div>
          <svg class="pill-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </div>`;
    });

    html += `
        </div>
      </div>`;
  }

  // 2. Render Submitted History Stream
  if (totalHistoryCount > 0) {
    html += '<div class="chat-stream">';

    const agentName = state.callerAgent.name || 'Agent';
    const agentStyle = getAgentAvatarStyle(state.callerAgent);
    const agentSymbol = getAgentAvatarSymbol(state.callerAgent);

    state.feedbackHistory.forEach((item) => {
      // User requested changes bubble
      html += `
        <div class="chat-bubble bubble-user">
          <div class="bubble-header">
            <div class="user-avatar-sm">You</div>
            <span class="bubble-sender">You</span>
            <span class="bubble-tag">Requested Changes</span>
            <span class="bubble-time">${item.timestamp}</span>
          </div>
          <div class="bubble-body-text">${escapeHtml(item.text)}</div>
        </div>`;

      // Paired agent response bubble
      if (item.status === 'pending') {
        html += `
          <div class="chat-bubble bubble-agent bubble-typing">
            <div class="bubble-header">
              <div class="agent-avatar-sm" style="${agentStyle}">${agentSymbol}</div>
              <span class="bubble-sender">${escapeHtml(agentName)}</span>
              <span class="bubble-time">Just now</span>
            </div>
            <div class="typing-indicator">
              <span class="typing-label">${escapeHtml(agentName)} is updating the plan</span>
            </div>
          </div>`;
      } else {
        const responseTime = item.addressedAt || item.timestamp;
        const diff = item.diffSummary;
        const note = item.agentNote;

        html += `
          <div class="chat-bubble bubble-agent bubble-response">
            <div class="bubble-header">
              <div class="agent-avatar-sm" style="${agentStyle}">${agentSymbol}</div>
              <span class="bubble-sender">${escapeHtml(agentName)}</span>
              <span class="bubble-time">${responseTime}</span>
            </div>
            <div class="bubble-response-content">
              ${note ? `<div class="agent-authored-note">${escapeHtml(note)}</div>` : ''}
              ${
                diff
                  ? `<div class="diff-metadata-row">
                      <span>Plan modified:</span>
                      <span class="diff-added">+${diff.added}</span> / <span class="diff-removed">-${diff.removed}</span> lines
                      ${diff.headings.length ? `(sections: ${diff.headings.map(h => escapeHtml(h)).join(', ')})` : ''}
                    </div>`
                  : `<div class="diff-metadata-row">Plan was updated live by <strong>${escapeHtml(agentName)}</strong>.</div>`
              }
            </div>
          </div>`;
      }
    });

    // Section questions (highlighted text notes)
    state.questions.forEach((q) => {
      html += `
        <div class="chat-bubble bubble-user bubble-question pill-note">
          <div class="bubble-header">
            <div class="user-avatar-sm" style="background: #f59e0b; color: #000;">Note</div>
            <span class="bubble-sender" style="color: #d97706;">Text Note</span>
            <span class="bubble-tag" style="background: rgba(245, 158, 11, 0.15); color: #d97706;">Snippet</span>
            <button class="btn-delete-chat-item" onclick="deleteQuestion(${q.id})" title="Delete note">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="chat-quote">"${escapeHtml(q.quote)}"</div>
          <div class="bubble-body-text">${escapeHtml(q.text)}</div>
        </div>`;
    });

    html += '</div>';
  }

  list.innerHTML = html;
}

window.deleteQuestion = function(id) {
  state.questions = state.questions.filter((q) => q.id !== id);

  const root = document.getElementById('renderedOutput');
  const mark = root && root.querySelector(`.commark[data-comment-id="${id}"]`);
  if (mark) {
    const badge = mark.nextElementSibling;
    if (badge && badge.classList.contains('commark-badge')) badge.remove();
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }

  updateActionButtonsState();
  renderQuestionsSidebar();
};

window.scrollAndHighlight = scrollAndHighlight;

function collectChoicesAndAnswers() {
  const choices = [];

  // Choice Cards
  document.querySelectorAll('.interactive-choice-card').forEach((card) => {
    const title = card.dataset.choiceTitle || 'Design Choice';
    const checkedRadio = card.querySelector('input[type="radio"]:checked');
    const selected = checkedRadio ? checkedRadio.value : '';

    choices.push({
      type: 'choice',
      title,
      selected,
    });
  });

  // Question Cards
  document.querySelectorAll('.interactive-question-card').forEach((card) => {
    const title = card.dataset.questionTitle || 'Open Question';
    const textarea = card.querySelector('textarea');
    const answer = textarea ? textarea.value.trim() : '';

    choices.push({
      type: 'question',
      title,
      answer,
    });
  });

  return choices;
}

async function submitFeedback(status) {
  const commentInput = document.getElementById('footerComment');
  const comment = commentInput ? commentInput.value.trim() : '';
  const choices = collectChoicesAndAnswers();

  if (status === 'changes_requested') {
    if (comment || choices.length > 0) {
      const historyItem = {
        id: Date.now(),
        type: 'change_request',
        text: comment || (choices.length > 0 ? `Submitted ${choices.length} design choices` : 'Requested changes'),
        status: 'pending',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      state.feedbackHistory.push(historyItem);
    }

    if (commentInput) {
      commentInput.value = '';
    }

    renderQuestionsSidebar();
  }

  const payload = {
    status,
    comment,
    questions: state.questions.map(q => ({ section: q.quote, text: q.text })),
    choices,
    content: state.content
  };

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      if (data.fileVersion) {
        state.fileVersion = data.fileVersion;
      }

      if (status === 'approved') {
        document.getElementById('modalTitle').textContent = 'Plan Approved!';
        document.getElementById('modalMessage').textContent = `Feedback transmitted back to ${state.callerAgent.name}. Closing tab...`;
        document.getElementById('successModal').classList.add('active');

        setTimeout(() => {
          closeTab();
        }, 1200);
      } else {
        showAgentUpdateToast('Requested changes sent to agent! Waiting for response…');
      }
    }
  } catch (err) {
    if (status === 'changes_requested') {
      state.feedbackHistory = state.feedbackHistory.filter((item) => item.status !== 'pending');
      renderQuestionsSidebar();
    }
    state.status = 'in_review';
    updateStatusPill(state.status);
    state.serverAlive = false;
    updateSubmitButtonsEnabled();
    showAgentUpdateToast("Couldn't reach the agent - it may still be working. Try again in a moment.");
  }
}

async function goBackAndClose() {
  try {
    await fetch('/api/shutdown', { method: 'POST' });
  } catch (e) {}
  closeTab();
}

function closeTab() {
  try {
    window.close();
  } catch (e) {}

  try {
    window.opener = window;
    window.open('', '_self', '');
    window.close();
  } catch (e) {}

  try {
    window.top.close();
  } catch (e) {}

  // If browser security blocks window.close(), do NOT redirect to about:blank.
  // Instead, update the modal message so the user knows they can close the tab manually.
  const modalMsg = document.getElementById('modalMessage');
  if (modalMsg) {
    modalMsg.textContent = 'Plan approved! You can close this browser tab or keep it open for reference.';
  }
}
