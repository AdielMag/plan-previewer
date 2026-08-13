// Plan Previewer Client Application logic matching Claude Design Handoff

let state = {
  filename: 'plan.md',
  filePath: '',
  content: '',
  fileVersion: 1,
  callerAgent: { id: 'claude', name: 'Claude Code', icon: '🤖', badge: 'Claude Code' },
  sessionContext: 'Plan Overview',
  questions: [],
  feedbackHistory: [],
  nextQuestionId: 1,
  popover: { visible: false, x: 0, y: 0, text: '', range: null },
  footerComment: '',
  status: 'in_review', // 'in_review', 'approved', 'changes_requested'
  serverAlive: true
};

let currentTheme = 'light';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  initTheme();

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

function startHeartbeat() {
  setInterval(() => {
    fetch('/api/heartbeat', { method: 'POST' }).catch(() => {});
  }, 2000);

  window.addEventListener('beforeunload', () => {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/shutdown');
    }
  });
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
          if (contentChanged) {
            const diffSummary = summarizeDiff(state.content, planData.content);
            state.feedbackHistory.forEach(item => {
              if (item.status === 'pending') {
                item.status = 'addressed';
                item.addressedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                item.diffSummary = diffSummary;
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

        if (planData.success && planData.content !== state.content) {
          const diffSummary = summarizeDiff(state.content, planData.content);
          state.feedbackHistory.forEach(item => {
            if (item.status === 'pending') {
              item.status = 'addressed';
              item.addressedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              item.diffSummary = diffSummary;
            }
          });

          await fetchPlanData();
          showAgentUpdateToast('Plan updated live by agent!');
          renderQuestionsSidebar();
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

function updateSubmitButtonsEnabled() {
  const requestBtn = document.getElementById('btnRequestChanges');
  const approveBtn = document.getElementById('btnApprovePlan');
  if (!requestBtn || !approveBtn) return;

  // While the server is down (agent is addressing feedback, or a
  // wait-timeout retry cycle is in progress), there's nothing listening to
  // submit to - disable submission instead of letting it fail.
  requestBtn.disabled = !state.serverAlive;
  approveBtn.disabled = !state.serverAlive;
  requestBtn.title = state.serverAlive ? '' : 'Waiting for the agent to respond...';
  approveBtn.title = state.serverAlive ? '' : 'Waiting for the agent to respond...';
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
      state.filename = data.filename;
      state.filePath = data.filePath;
      state.content = data.content;
      state.fileVersion = data.fileVersion || state.fileVersion;
      state.callerAgent = data.callerAgent || state.callerAgent;
      state.sessionContext = data.sessionContext || extractPlanGoal(data.content);

      updateHeader();
      renderMarkdown();
      renderQuestionsSidebar();
    }
  } catch (err) {
    console.error('Failed to load plan data:', err);
  }
}

function extractPlanGoal(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match && match[1] ? match[1].trim() : 'Plan Overview';
}

function updateHeader() {
  const agentName = state.callerAgent.name || 'Claude Code';
  const initial = agentName.trim().charAt(0).toUpperCase() || 'C';
  
  const avatar = document.getElementById('agentAvatar');
  avatar.textContent = initial;

  if (state.callerAgent.id === 'antigravity') {
    avatar.style.background = 'linear-gradient(135deg, #4285F4, #34A853)';
  } else {
    avatar.style.background = 'linear-gradient(135deg, oklch(72% 0.13 195), oklch(60% 0.14 250))';
  }

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

async function renderMarkdown() {
  const output = document.getElementById('renderedOutput');

  marked.setOptions({
    gfm: true,
    breaks: false
  });

  let rawHtml = marked.parse(state.content);
  output.innerHTML = rawHtml;

  // Process GitHub callout alerts & interactive Choice/Question cards
  processGitHubAlerts(output);

  // Process image placeholders
  output.querySelectorAll('img').forEach((img) => {
    const div = document.createElement('div');
    div.className = 'img-slot';
    div.textContent = '◇ ' + (img.alt || 'Diagram placeholder');
    img.replaceWith(div);
  });

  // Render Mermaid diagrams
  await processMermaidDiagrams(output);

  // Highlight code blocks
  output.querySelectorAll('pre code').forEach((block) => {
    if (!block.classList.contains('language-mermaid')) {
      hljs.highlightElement(block);
    }
  });

  // Process file diff badges and risk tags
  processVisualBadges(output);

  // Process task checkboxes & update progress bar
  processCheckboxes();

  // Generate Table of Contents navigation sidebar
  generateTableOfContents(output);
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

function renderInteractiveChoiceCard(bq, title, groupIdx) {
  const card = document.createElement('div');
  card.className = 'github-alert alert-choice interactive-choice-card';
  card.dataset.choiceTitle = title;

  const header = document.createElement('div');
  header.className = 'alert-title';
  header.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg><span>DESIGN CHOICE: ${title}</span>`;
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

  items.forEach((li) => {
    const text = li.textContent.trim();
    const cleanText = text.replace(/^\([ xX]\)\s*/, '');

    const optLabel = document.createElement('label');
    optLabel.className = 'choice-option-item';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `choice_group_${groupIdx}`;
    radio.value = cleanText;
    radio.checked = false; // No option picked by default

    // Deselect capability: clicking an active option deselects it
    optLabel.addEventListener('click', (e) => {
      e.preventDefault();
      const wasChecked = radio.checked;

      // Clear all radios in this choice card
      optionsContainer.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);
      optionsContainer.querySelectorAll('.choice-option-item').forEach(el => el.classList.remove('selected'));

      if (!wasChecked) {
        radio.checked = true;
        optLabel.classList.add('selected');
      }
    });

    optLabel.appendChild(radio);

    const span = document.createElement('span');
    span.innerHTML = cleanText;
    optLabel.appendChild(span);

    optionsContainer.appendChild(optLabel);
  });

  body.appendChild(optionsContainer);
  card.appendChild(body);
  bq.replaceWith(card);
}

function renderInteractiveQuestionCard(bq, title) {
  const card = document.createElement('div');
  card.className = 'github-alert alert-question interactive-question-card';
  card.dataset.questionTitle = title;

  const header = document.createElement('div');
  header.className = 'alert-title';
  header.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><span>OPEN QUESTION: ${title}</span>`;
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
    { text: '[LOW RISK]', class: 'badge-low-risk' }
  ];

  container.querySelectorAll('h1, h2, h3, h4, h5, p, li').forEach((el) => {
    let html = el.innerHTML;
    badgeMap.forEach((badge) => {
      if (html.includes(badge.text)) {
        const span = `<span class="inline-badge ${badge.class}">${badge.text.replace(/\[|\]/g, '')}</span>`;
        html = html.split(badge.text).join(span);
      }
    });
    el.innerHTML = html;
  });
}

function processCheckboxes() {
  const output = document.getElementById('renderedOutput');
  let totalTasks = 0;
  let completedTasks = 0;

  output.querySelectorAll('li').forEach((li) => {
    const text = li.innerHTML.trim();
    if (text.startsWith('[ ]') || text.startsWith('[x]') || text.startsWith('[X]')) {
      totalTasks++;
      const isChecked = text.startsWith('[x]') || text.startsWith('[X]');
      if (isChecked) completedTasks++;

      li.classList.add('task-item');
      
      const cleanText = text.replace(/^\[[ xX]\]/, '');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isChecked;
      checkbox.addEventListener('change', () => toggleTaskInMarkdown(cleanText.trim(), checkbox.checked));

      li.innerHTML = '';
      li.appendChild(checkbox);
      
      const label = document.createElement('span');
      label.innerHTML = cleanText;
      if (isChecked) label.style.textDecoration = 'line-through';
      li.appendChild(label);
    }
  });

  // Update header progress bar
  const progressHeader = document.getElementById('headerProgress');
  const progressText = document.getElementById('progressText');
  const progressFill = document.getElementById('progressFill');

  if (totalTasks > 0) {
    const pct = Math.round((completedTasks / totalTasks) * 100);
    progressText.textContent = `${pct}% Complete (${completedTasks}/${totalTasks})`;
    progressFill.style.width = `${pct}%`;
    progressHeader.style.display = 'flex';
  } else {
    progressHeader.style.display = 'none';
  }
}

function generateTableOfContents(container) {
  const tocList = document.getElementById('tocList');
  if (!tocList) return;

  const headings = container.querySelectorAll('h1, h2, h3');
  tocList.innerHTML = '';

  if (headings.length === 0) {
    tocList.innerHTML = '<div class="empty-toc">No outline available</div>';
    return;
  }

  headings.forEach((heading, idx) => {
    const id = heading.id || `heading-${idx}`;
    heading.id = id;

    const level = heading.tagName.toLowerCase();
    const item = document.createElement('a');
    item.className = `toc-item toc-${level}`;
    item.href = `#${id}`;
    item.textContent = heading.textContent.replace(/^(#+\s*|\[!(NOTE|TIP|WARNING|CHOICE|QUESTION)\])/, '').trim();

    item.addEventListener('click', (e) => {
      e.preventDefault();
      heading.scrollIntoView({ behavior: 'smooth' });
    });

    tocList.appendChild(item);
  });
}

function toggleTaskInMarkdown(taskSubstring, isNowChecked) {
  let lines = state.content.split('\n');
  let updated = false;

  lines = lines.map((line) => {
    if (!updated && line.includes(taskSubstring.substring(0, 20))) {
      if (isNowChecked) {
        line = line.replace('- [ ]', '- [x]').replace('* [ ]', '* [x]');
      } else {
        line = line.replace(/- \[[xX]\]/, '- [ ]').replace(/\* \[[xX]\]/, '* [ ]');
      }
      updated = true;
    }
    return line;
  });

  state.content = lines.join('\n');
  saveMarkdownToServer();
  renderMarkdown();
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

  // Theme Switcher button
  const themeToggle = document.getElementById('btnThemeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  // Close session button
  document.getElementById('btnHeaderClose').addEventListener('click', goBackAndClose);
  document.getElementById('btnModalClose').addEventListener('click', closeTab);

  // Footer Actions
  updateSubmitButtonsEnabled();

  document.getElementById('btnRequestChanges').addEventListener('click', () => {
    if (!state.serverAlive) return;
    state.status = 'changes_requested';
    updateStatusPill(state.status);
    submitFeedback('changes_requested');
  });

  document.getElementById('btnApprovePlan').addEventListener('click', () => {
    if (!state.serverAlive) return;
    state.status = 'approved';
    updateStatusPill(state.status);
    submitFeedback('approved');
  });
}

function closePopover() {
  state.popover = { visible: false, x: 0, y: 0, text: '', range: null };
  document.getElementById('selectionPopover').style.display = 'none';
}

function submitQuestionFromPopover() {
  const input = document.getElementById('popoverInput');
  const questionText = input.value.trim();
  if (!questionText) return;

  const { range, text } = state.popover;
  const id = state.nextQuestionId;

  try {
    if (range) {
      const mark = document.createElement('span');
      mark.className = 'commark';
      mark.dataset.commentId = id;
      range.surroundContents(mark);

      const badge = document.createElement('sup');
      badge.className = 'commark-badge';
      badge.textContent = id;
      mark.after(badge);
    }
  } catch (e) {}

  const question = {
    id,
    quote: text.length > 90 ? text.slice(0, 90) + '…' : text,
    text: questionText,
  };

  state.questions.push(question);
  state.nextQuestionId = id + 1;

  window.getSelection().removeAllRanges();
  closePopover();
  renderQuestionsSidebar();
}

function getAgentAvatarStyle(agent) {
  if (!agent) return 'background: linear-gradient(135deg, #2563eb, #0284c7);';
  if (agent.id === 'antigravity') {
    return 'background: linear-gradient(135deg, #4285F4, #34A853);';
  }
  if (agent.id === 'claude') {
    return 'background: linear-gradient(135deg, #D97706, #F59E0B);';
  }
  return `background: linear-gradient(135deg, ${agent.color || '#2563eb'}, ${agent.accentColor || '#0284c7'});`;
}

function getAgentAvatarSymbol(agent) {
  if (!agent) return '🤖';
  if (agent.id === 'antigravity') return '⚡';
  if (agent.icon) return agent.icon;
  const initial = (agent.name || 'A').trim().charAt(0).toUpperCase();
  return initial;
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

  const totalItems = state.questions.length + state.feedbackHistory.length;
  badge.textContent = totalItems;

  if (totalItems === 0) {
    list.innerHTML = `
      <div class="empty-sidebar">
        <div class="empty-icon">💬</div>
        <div class="empty-title">Activity Feed Empty</div>
        <div class="empty-sub">Select text in the plan to ask a question, or submit comments below.</div>
      </div>`;
    return;
  }

  let html = '<div class="chat-stream">';

  const agentName = state.callerAgent.name || 'Agent';
  const agentStyle = getAgentAvatarStyle(state.callerAgent);
  const agentSymbol = getAgentAvatarSymbol(state.callerAgent);

  // Render submitted feedback history entries and agent responses/typing status
  state.feedbackHistory.forEach((item) => {
    // User Chat Bubble
    html += `
      <div class="chat-bubble bubble-user">
        <div class="bubble-header">
          <div class="user-avatar-sm">You</div>
          <span class="bubble-sender">You</span>
          <span class="bubble-tag">Requested Changes</span>
          <span class="bubble-time">${item.timestamp}</span>
        </div>
        <div class="bubble-body-text">${escapeHtml(item.text)}</div>
      </div>
    `;

    // Agent Chat Bubble: Typing state or Response
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
            <div class="typing-dots" title="Waiting for response from ${escapeHtml(agentName)}">
              <span class="dot"></span>
              <span class="dot"></span>
              <span class="dot"></span>
            </div>
          </div>
        </div>
      `;
    } else {
      const responseTime = item.addressedAt || item.timestamp;
      const diff = item.diffSummary;
      const bodyText = diff
        ? `Plan updated by <strong>${escapeHtml(agentName)}</strong> - <span class="diff-stat"><span class="diff-added">+${diff.added}</span> / <span class="diff-removed">-${diff.removed}</span> lines</span>${
            diff.headings.length
              ? `<div class="diff-sections">Changed: ${diff.headings.map((h) => `<code>${escapeHtml(h)}</code>`).join(', ')}</div>`
              : ''
          }`
        : `Plan was updated live by <strong>${escapeHtml(agentName)}</strong> to address your requested changes.`;
      html += `
        <div class="chat-bubble bubble-agent bubble-response">
          <div class="bubble-header">
            <div class="agent-avatar-sm" style="${agentStyle}">${agentSymbol}</div>
            <span class="bubble-sender">${escapeHtml(agentName)}</span>
            <span class="bubble-time">${responseTime}</span>
          </div>
          <div class="bubble-response-content">
            <div class="response-status-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Plan Updated</span>
            </div>
            <div class="response-body-text">${bodyText}</div>
          </div>
        </div>
      `;
    }
  });

  // Render section questions as User Chat Bubbles
  state.questions.forEach((q) => {
    html += `
      <div class="chat-bubble bubble-user bubble-question">
        <div class="bubble-header">
          <div class="user-avatar-sm">You</div>
          <span class="bubble-sender">You</span>
          <span class="bubble-tag">Question</span>
          <button class="btn-delete-chat-item" onclick="deleteQuestion(${q.id})" title="Delete question">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="chat-quote">"${escapeHtml(q.quote)}"</div>
        <div class="bubble-body-text">${escapeHtml(q.text)}</div>
      </div>
    `;
  });

  html += '</div>';
  list.innerHTML = html;
  list.scrollTop = list.scrollHeight;
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

  renderQuestionsSidebar();
};

async function saveMarkdownToServer() {
  try {
    const res = await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: state.content })
    });
    const data = await res.json();
    if (data.success && data.fileVersion) {
      state.fileVersion = data.fileVersion;
    }
  } catch (err) {
    console.error('Failed to save markdown to server:', err);
  }
}

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

    // Clear the footer comment textarea immediately
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
      // Synchronize fileVersion from server response so client polling won't falsely trigger an agent update
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
    // The server most likely isn't reachable anymore (e.g. it was mid-exit,
    // or a wait-timeout retry cycle hadn't reconnected yet). Roll back the
    // optimistic history entry instead of leaving a "Waiting for agent
    // response..." card for a submission that never actually went through.
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

  setTimeout(() => {
    try {
      window.location.href = 'about:blank';
    } catch (e) {}
  }, 150);
}
