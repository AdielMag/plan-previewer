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
  agentQuestions: [],   // rounds pushed by the agent via `--ask`
  askAnswers: {},       // { "<roundId>:<questionId>": { value } }
  askCursor: 0,         // which pending question the footer strip is showing
  askDeferred: false,   // user chose "Answer later"
  planApproved: false,
  selections: {}, // { [choiceTitle]: { selectedText, cleanTitle, isRecommended } }
  draftAnswers: {}, // { [questionTitle]: answerText }
  nextQuestionId: 1,
  popover: { visible: false, x: 0, y: 0, text: '', range: null },
  footerComment: '',
  status: 'in_review', // 'in_review', 'approved', 'changes_requested'
  serverAlive: true,
  widthMode: 'wide',
  viewMode: 'full',
  collapsedSections: new Set(),
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

  const savedViewMode = localStorage.getItem('plan-previewer-view-mode') || 'summary';
  setViewMode(savedViewMode);

  const savedCollapseLeft = localStorage.getItem('plan-previewer-collapse-left') === 'true';
  const savedCollapseRight = localStorage.getItem('plan-previewer-collapse-right') === 'true';
  setSidebarCollapsed('left', savedCollapseLeft);
  setSidebarCollapsed('right', savedCollapseRight);
}

function updateViewModeButtons(mode) {
  document.querySelectorAll('.view-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('plan-previewer-view-mode', mode);

  const layout = document.getElementById('appLayout');
  if (layout) {
    layout.setAttribute('data-view-mode', mode);
  }

  updateViewModeButtons(mode);
  renderMarkdown();
}

function extractPlanViews(content) {
  if (!content || typeof content !== 'string') {
    return { hasDualViews: false, summaryContent: '', fullContent: content || '' };
  }

  // Normalize newlines
  const text = content.replace(/\r\n/g, '\n');

  // 1. Check line-level comment delimiters: <!-- SUMMARY --> and <!-- FULL -->
  const summaryStartIdx = text.search(/^[ \t]*<!--\s*(?:SECTION:\s*)?SUMMARY\s*-->[ \t]*$/im);
  const fullStartIdx = text.search(/^[ \t]*<!--\s*(?:SECTION:\s*)?FULL\s*-->[ \t]*$/im);

  if (summaryStartIdx !== -1 && fullStartIdx !== -1) {
    let summaryContent = '';
    let fullContent = '';

    if (summaryStartIdx < fullStartIdx) {
      const summarySlice = text.slice(summaryStartIdx);
      const summaryAfterHeader = summarySlice.replace(/^[ \t]*<!--\s*(?:SECTION:\s*)?SUMMARY\s*-->[ \t]*\n/im, '');
      const summaryEndMatch = summaryAfterHeader.search(/^[ \t]*<!--\s*(?:\/|END\s+|END_)(?:SECTION:\s*)?SUMMARY\s*-->[ \t]*$/im);

      if (summaryEndMatch !== -1) {
        summaryContent = summaryAfterHeader.slice(0, summaryEndMatch).trim();
      } else {
        const fullRelIdx = summaryAfterHeader.search(/^[ \t]*<!--\s*(?:SECTION:\s*)?FULL\s*-->[ \t]*$/im);
        summaryContent = fullRelIdx !== -1 ? summaryAfterHeader.slice(0, fullRelIdx).trim() : summaryAfterHeader.trim();
      }

      const fullSlice = text.slice(fullStartIdx);
      const fullAfterHeader = fullSlice.replace(/^[ \t]*<!--\s*(?:SECTION:\s*)?FULL\s*-->[ \t]*\n/im, '');
      const fullEndMatch = fullAfterHeader.search(/^[ \t]*<!--\s*(?:\/|END\s+|END_)(?:SECTION:\s*)?FULL\s*-->[ \t]*$/im);

      fullContent = fullEndMatch !== -1 ? fullAfterHeader.slice(0, fullEndMatch).trim() : fullAfterHeader.trim();
    } else {
      const fullSlice = text.slice(fullStartIdx);
      const fullAfterHeader = fullSlice.replace(/^[ \t]*<!--\s*(?:SECTION:\s*)?FULL\s*-->[ \t]*\n/im, '');
      const fullEndMatch = fullAfterHeader.search(/^[ \t]*<!--\s*(?:\/|END\s+|END_)(?:SECTION:\s*)?FULL\s*-->[ \t]*$/im);
      fullContent = fullEndMatch !== -1 ? fullAfterHeader.slice(0, fullEndMatch).trim() : fullAfterHeader.trim();

      const summarySlice = text.slice(summaryStartIdx);
      const summaryAfterHeader = summarySlice.replace(/^[ \t]*<!--\s*(?:SECTION:\s*)?SUMMARY\s*-->[ \t]*\n/im, '');
      const summaryEndMatch = summaryAfterHeader.search(/^[ \t]*<!--\s*(?:\/|END\s+|END_)(?:SECTION:\s*)?SUMMARY\s*-->[ \t]*$/im);
      summaryContent = summaryEndMatch !== -1 ? summaryAfterHeader.slice(0, summaryEndMatch).trim() : summaryAfterHeader.trim();
    }

    return {
      hasDualViews: true,
      summaryContent,
      fullContent
    };
  }

  // 2. Check data-view attributes: <div data-view="summary">...</div> and <div data-view="full">...</div>
  const summaryDivMatch = text.match(/<(?:div|section)[^>]*data-view=["']summary["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);
  const fullDivMatch = text.match(/<(?:div|section)[^>]*data-view=["']full["'][^>]*>([\s\S]*?)<\/(?:div|section)>/i);

  if (summaryDivMatch && fullDivMatch) {
    return {
      hasDualViews: true,
      summaryContent: summaryDivMatch[1].trim(),
      fullContent: fullDivMatch[1].trim()
    };
  }

  // Single-view fallback
  return {
    hasDualViews: false,
    summaryContent: content,
    fullContent: content
  };
}

function getActiveViewMarkdown(rawMarkdown) {
  const views = extractPlanViews(rawMarkdown);
  state.hasDualViews = views.hasDualViews;
  if (!views.hasDualViews) {
    return rawMarkdown;
  }
  return state.viewMode === 'summary' ? views.summaryContent : views.fullContent;
}

function applyCurrentViewMode() {
  const layout = document.getElementById('appLayout');
  if (layout) {
    layout.setAttribute('data-view-mode', state.viewMode);
  }

  const isSummary = state.viewMode === 'summary';
  const banner = document.getElementById('summaryModeBanner');
  if (banner) {
    const textEl = banner.querySelector('.summary-banner-left span');
    if (textEl) {
      if (state.hasDualViews) {
        textEl.innerHTML = '<strong>Executive Summary:</strong> Showing concise high-level plan. Switch to Full Plan for technical specs & code.';
      } else {
        textEl.innerHTML = '<strong>Summary View:</strong> Showing high-level strategy, decisions & milestones.';
      }
    }
  }

  const container = document.getElementById('renderedOutput');
  if (!container) return;

  // In legacy single-view plans without separate text sections:
  if (!state.hasDualViews) {
    // 1. Details accordions: close in summary, open in full
    container.querySelectorAll('details').forEach((d) => {
      if (isSummary) {
        d.removeAttribute('open');
      } else {
        d.setAttribute('open', '');
      }
    });

    // 2. Code blocks: collapse in summary, expand in full
    container.querySelectorAll('.code-block-wrapper.is-long').forEach((wrapper) => {
      const btn = wrapper.querySelector('.btn-expand-code span');
      const svg = wrapper.querySelector('.btn-expand-code svg');
      if (isSummary) {
        wrapper.classList.add('code-collapsed');
        if (btn) btn.textContent = 'Show more lines';
        if (svg) svg.style.transform = 'rotate(0deg)';
      } else {
        wrapper.classList.remove('code-collapsed');
        if (btn) btn.textContent = 'Show less';
        if (svg) svg.style.transform = 'rotate(180deg)';
      }
    });

    // 3. Sub-sections (H3): collapse in summary, expand in full
    container.querySelectorAll('h3').forEach((h3) => {
      h3.classList.toggle('section-collapsed', isSummary);
      let curr = h3.nextElementSibling;
      while (curr && !['H1', 'H2', 'H3'].includes(curr.tagName.toUpperCase())) {
        curr.classList.toggle('section-node-hidden', isSummary);
        curr = curr.nextElementSibling;
      }
    });
  }
}

function collapseAllSections() {
  const container = document.getElementById('renderedOutput');
  if (!container) return;

  // Close all details accordions
  container.querySelectorAll('details').forEach((details) => {
    details.removeAttribute('open');
  });

  // Collapse all long code blocks
  container.querySelectorAll('.code-block-wrapper.is-long').forEach((wrapper) => {
    wrapper.classList.add('code-collapsed');
    const btn = wrapper.querySelector('.btn-expand-code span');
    const svg = wrapper.querySelector('.btn-expand-code svg');
    if (btn) btn.textContent = 'Show more lines';
    if (svg) svg.style.transform = 'rotate(0deg)';
  });

  // Collapse all H2 and H3 sections
  container.querySelectorAll('h2, h3').forEach((heading) => {
    heading.classList.add('section-collapsed');
    const isH2 = heading.tagName.toLowerCase() === 'h2';
    const stopTags = isH2 ? ['H1', 'H2'] : ['H1', 'H2', 'H3'];
    let curr = heading.nextElementSibling;
    while (curr && !stopTags.includes(curr.tagName.toUpperCase())) {
      curr.classList.add('section-node-hidden');
      curr = curr.nextElementSibling;
    }
  });

  showAgentUpdateToast('All sections & details collapsed');
}

function expandAllSections() {
  const container = document.getElementById('renderedOutput');
  if (!container) return;

  // Open all details accordions
  container.querySelectorAll('details').forEach((details) => {
    details.setAttribute('open', '');
  });

  // Expand all long code blocks
  container.querySelectorAll('.code-block-wrapper.is-long').forEach((wrapper) => {
    wrapper.classList.remove('code-collapsed');
    const btn = wrapper.querySelector('.btn-expand-code span');
    const svg = wrapper.querySelector('.btn-expand-code svg');
    if (btn) btn.textContent = 'Show less';
    if (svg) svg.style.transform = 'rotate(180deg)';
  });

  // Expand all H2 and H3 sections
  container.querySelectorAll('h2, h3').forEach((heading) => {
    heading.classList.remove('section-collapsed');
    const isH2 = heading.tagName.toLowerCase() === 'h2';
    const stopTags = isH2 ? ['H1', 'H2'] : ['H1', 'H2', 'H3'];
    let curr = heading.nextElementSibling;
    while (curr && !stopTags.includes(curr.tagName.toUpperCase())) {
      curr.classList.remove('section-node-hidden');
      curr = curr.nextElementSibling;
    }
  });

  showAgentUpdateToast('All sections & details expanded');
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

      const mtimeChanged = Boolean(data.mtime && state.lastMtime && data.mtime !== state.lastMtime);
      const versionChanged = Boolean(data.fileVersion && state.fileVersion && data.fileVersion > state.fileVersion);

      if (!state.serverAlive) {
        state.serverAlive = true;
        updateSubmitButtonsEnabled();
      }

      if (mtimeChanged || versionChanged || !state.lastMtime) {
        state.fileVersion = data.fileVersion || state.fileVersion;
        state.lastMtime = data.mtime || state.lastMtime;

        const planRes = await fetch('/api/plan?t=' + Date.now());
        const planData = await planRes.json();

        if (planData.success) {
          const contentChanged = planData.content !== state.content;
          const hasNewAgentResponse = Boolean(
            planData.agentResponses &&
            planData.agentResponses.length > (state.agentResponses ? state.agentResponses.length : 0)
          );
          const prevAskCount = (state.agentQuestions || []).reduce((s, r) => s + r.questions.length, 0);
          const nextQuestions = planData.agentQuestions || state.agentQuestions || [];
          const nextAskCount = nextQuestions.reduce((s, r) => s + r.questions.length, 0);
          const hasNewAgentQuestions = nextAskCount > prevAskCount;

          state.agentResponses = planData.agentResponses || state.agentResponses;
          state.planApproved = Boolean(planData.planApproved);

          if (hasNewAgentQuestions) {
            // Preserve local 'answered' marks for rounds already submitted.
            const answeredIds = new Set(
              (state.agentQuestions || []).filter((r) => r.status === 'answered').map((r) => r.roundId)
            );
            state.agentQuestions = nextQuestions.map((r) =>
              answeredIds.has(r.roundId) ? { ...r, status: 'answered' } : r
            );
            renderAgentAskPanel();
            renderQuestionsSidebar();
            updateSubmitButtonsEnabled();
            showAgentUpdateToast(`${state.callerAgent.name} asked you a question \u2014 answer it below`);
          }

          // Only address pending requests when the agent actually updated content or sent a response
          if (contentChanged || hasNewAgentResponse || hasNewAgentQuestions) {
            const diffSummary = contentChanged ? summarizeDiff(state.content, planData.content) : null;
            const latestResponse = (state.agentResponses && state.agentResponses.length)
              ? state.agentResponses[state.agentResponses.length - 1].text
              : '';

            state.feedbackHistory.forEach((item) => {
              if (item.status === 'pending') {
                item.status = 'addressed';
                item.addressedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                item.diffSummary = diffSummary;
                item.agentNote = latestResponse;
              }
            });

            state.content = planData.content;
            renderMarkdown();
            renderQuestionsSidebar();
            updateSubmitButtonsEnabled();
            showAgentUpdateToast('Plan updated live by agent!');
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

function isWaitingForAgent() {
  return state.feedbackHistory.some((item) => item.status === 'pending');
}

function updateActionButtonsState() {
  const requestBtn = document.getElementById('btnRequestChanges');
  if (!requestBtn) return;

  // Hidden while the agent's questions are pending - nothing to update.
  if (hasPendingAsks()) {
    requestBtn.style.display = 'none';
    return;
  }
  requestBtn.style.display = '';

  if (!state.serverAlive) {
    requestBtn.disabled = true;
    requestBtn.classList.add('btn-disabled');
    requestBtn.title = 'Waiting for the agent to respond...';
    return;
  }

  if (isWaitingForAgent()) {
    requestBtn.disabled = true;
    requestBtn.classList.add('btn-disabled');
    requestBtn.title = 'Waiting for the agent to address your last request…';
    return;
  }

  const commentVal = document.getElementById('footerComment')?.value.trim() || '';
  const hasSelections = Object.keys(state.selections).length > 0;
  const hasAnswers = Object.keys(state.draftAnswers).length > 0;
  const hasQuestions = state.questions.length > 0;
  const hasPendingActivity = Boolean(commentVal || hasSelections || hasAnswers || hasQuestions);

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

  const waiting = isWaitingForAgent();

  updateSendAnswersButton();

  // While the agent is waiting on answers, "Send answers" is the ONLY action:
  // Request changes / Approve are hidden entirely, not just disabled.
  const askPending = hasPendingAsks();
  requestBtn.style.display = askPending ? 'none' : '';
  approveBtn.style.display = askPending ? 'none' : '';
  if (askPending) return;

  if (!state.serverAlive) {
    approveBtn.disabled = true;
    approveBtn.classList.add('btn-disabled');
    approveBtn.title = 'Waiting for the agent to respond...';
  } else if (waiting) {
    approveBtn.disabled = true;
    approveBtn.classList.add('btn-disabled');
    approveBtn.title = 'Waiting for the agent to address your last request…';
  } else {
    approveBtn.disabled = false;
    approveBtn.classList.remove('btn-disabled');
    approveBtn.title = 'Approve plan and start execution';
  }

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
    const res = await fetch('/api/plan?t=' + Date.now());
    const data = await res.json();
    if (data.success) {
      state.filename = data.filename || 'plan.md';
      state.filePath = data.filePath || '';
      state.content = data.content || '';
      state.fileVersion = data.fileVersion || state.fileVersion;
      state.callerAgent = data.callerAgent || state.callerAgent;
      state.sessionContext = data.sessionContext || extractPlanGoal(data.content);
      state.agentResponses = data.agentResponses || [];
      state.agentQuestions = data.agentQuestions || [];
      state.planApproved = Boolean(data.planApproved);

      // Mark previous pending feedback items as addressed
      state.feedbackHistory.forEach((item) => {
        if (item.status === 'pending') {
          item.status = 'addressed';
          item.addressedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
      });

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
      renderAgentAskPanel();
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
  document.title = state.sessionContext ? `${state.sessionContext} · Plan Previewer` : 'Plan Previewer';

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

  const activeMarkdown = getActiveViewMarkdown(state.content);

  let rawHtml = '';
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    try {
      if (typeof marked.setOptions === 'function') {
        marked.setOptions({ gfm: true, breaks: false });
      }
      rawHtml = marked.parse(activeMarkdown);
    } catch (e) {
      console.warn('Marked.js error, falling back:', e);
      rawHtml = simpleMarkdownParse(activeMarkdown);
    }
  } else {
    rawHtml = simpleMarkdownParse(activeMarkdown);
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

  // Process Details & Summary elements
  try { processDetailsElements(output); } catch (e) { console.warn('Details processing error:', e); }

  // Process and highlight code blocks
  try { processCodeBlocks(output); } catch (e) { console.warn('Code blocks processing error:', e); }

  // Process file diff badges and risk tags
  try { processVisualBadges(output); } catch (e) {}

  // Process task checkboxes & update progress bar
  try { processCheckboxes(); } catch (e) {}

  // Attach heading fold toggle listeners
  try { attachHeadingFoldListeners(output); } catch (e) {}

  // Generate Table of Contents navigation sidebar
  try { generateTableOfContents(output); } catch (e) {}

  // Apply current View Mode
  try { applyCurrentViewMode(); } catch (e) {}

  // Initialize scroll-spy active state
  try { setTimeout(updateTocScrollSpy, 50); } catch (e) {}
}

function attachHeadingFoldListeners(container) {
  container.querySelectorAll('h2, h3').forEach((heading) => {
    if (heading.dataset.foldAttached === 'true') return;
    heading.dataset.foldAttached = 'true';
    heading.classList.add('foldable-heading');

    if (!heading.querySelector('.heading-fold-icon')) {
      const foldIcon = document.createElement('span');
      foldIcon.className = 'heading-fold-icon';
      foldIcon.title = 'Click to toggle section';
      foldIcon.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;
      heading.prepend(foldIcon);
    }

    heading.addEventListener('click', (e) => {
      // If clicking an interactive child element (like a link), do not toggle
      if (e.target.closest('a, input, button:not(.heading-fold-icon)')) return;
      const isH2 = heading.tagName.toLowerCase() === 'h2';
      const stopTags = isH2 ? ['H1', 'H2'] : ['H1', 'H2', 'H3'];
      const isNowCollapsed = heading.classList.toggle('section-collapsed');

      let curr = heading.nextElementSibling;
      while (curr && !stopTags.includes(curr.tagName.toUpperCase())) {
        curr.classList.toggle('section-node-hidden', isNowCollapsed);
        curr = curr.nextElementSibling;
      }
    });
  });
}

function processDetailsElements(container) {
  container.querySelectorAll('details').forEach((details) => {
    details.classList.add('styled-details');

    let summary = details.querySelector('summary');
    if (!summary) {
      summary = document.createElement('summary');
      summary.textContent = 'Technical Details';
      details.prepend(summary);
    }
    summary.classList.add('styled-summary');

    // Add custom styled chevron icon if not present
    if (!summary.querySelector('.details-chevron')) {
      const chevron = document.createElement('span');
      chevron.className = 'details-chevron';
      chevron.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
      `;
      summary.prepend(chevron);
    }

    // Add badge indicator if it has code / files
    if (!summary.querySelector('.details-badge')) {
      const text = summary.textContent.toLowerCase();
      let badgeText = '';
      if (text.includes('deep dive') || text.includes('technical')) badgeText = 'Technical';
      else if (text.includes('file')) badgeText = 'Files';
      else if (text.includes('test') || text.includes('verif')) badgeText = 'Testing';
      else if (details.querySelector('pre, code')) badgeText = 'Code';
      else if (details.querySelector('ul, ol')) badgeText = 'Details';

      if (badgeText) {
        const badge = document.createElement('span');
        badge.className = 'details-badge';
        badge.textContent = badgeText;
        summary.appendChild(badge);
      }
    }
  });
}

function processCodeBlocks(container) {
  container.querySelectorAll('pre').forEach((pre) => {
    // If inside a mermaid diagram or already processed, skip
    if (pre.closest('.mermaid') || pre.classList.contains('mermaid') || pre.dataset.codeProcessed === 'true') {
      return;
    }
    pre.dataset.codeProcessed = 'true';

    const code = pre.querySelector('code');
    if (!code) return;

    if (typeof hljs !== 'undefined' && !code.classList.contains('language-mermaid')) {
      try { hljs.highlightElement(code); } catch (e) {}
    }

    const codeText = code.textContent.trim();
    const lines = codeText.split('\n');
    const lineCount = lines.length;

    // Detect language class
    let lang = 'CODE';
    if (code && code.className) {
      const langMatch = code.className.match(/language-([a-zA-Z0-9_\-]+)/);
      if (langMatch && langMatch[1] && langMatch[1] !== 'undefined' && !langMatch[1].startsWith('hljs')) {
        lang = langMatch[1].toUpperCase();
      }
    }

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    pre.parentNode.insertBefore(wrapper, pre);
    wrapper.appendChild(pre);

    // Create Header bar
    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
      <div class="code-meta-left">
        <span class="code-lang-tag">${escapeHtml(lang)}</span>
        <span class="code-line-count">${lineCount} ${lineCount === 1 ? 'line' : 'lines'}</span>
      </div>
      <button class="code-btn-copy" type="button" title="Copy code to clipboard">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <span>Copy</span>
      </button>
    `;

    const copyBtn = header.querySelector('.code-btn-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(codeText);
        copyBtn.classList.add('copied');
        copyBtn.querySelector('span').textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.querySelector('span').textContent = 'Copy';
        }, 2000);
      } catch (err) {
        console.warn('Copy failed:', err);
      }
    });

    wrapper.prepend(header);

    // If more than 14 lines, make it collapsible
    if (lineCount > 14) {
      wrapper.classList.add('is-long');

      const overlay = document.createElement('div');
      overlay.className = 'code-expand-overlay';
      overlay.innerHTML = `
        <button class="btn-expand-code" type="button">
          <span>Show all ${lineCount} lines</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      `;

      const expandBtn = overlay.querySelector('.btn-expand-code');
      expandBtn.addEventListener('click', () => {
        const isCollapsed = wrapper.classList.contains('code-collapsed');
        setCodeBlockCollapsed(wrapper, !isCollapsed, lineCount);
      });

      wrapper.appendChild(overlay);
    }
  });
}

function processGitHubAlerts(container) {
  let choiceGroupIdx = 0;
  let choiceNumber = 0;
  let questionNumber = 0;

  container.querySelectorAll('blockquote').forEach((bq) => {
    const text = bq.textContent.trim();
    const alertMatch = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|CHOICE|QUESTION)\](?:\s+(.+))?/i);

    if (alertMatch) {
      const alertType = alertMatch[1].toLowerCase();
      const titleText = alertMatch[2] ? alertMatch[2].trim() : alertType.toUpperCase();

      if (alertType === 'choice') {
        renderInteractiveChoiceCard(bq, titleText, choiceGroupIdx++, ++choiceNumber);
        return;
      }

      if (alertType === 'question') {
        renderInteractiveQuestionCard(bq, titleText, ++questionNumber);
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

/* Decisions Tray: groups consecutive [!CHOICE]/[!QUESTION] blocks into one flat, organized container */
function getOrCreateDecisionsTray(bq) {
  const prev = bq.previousElementSibling;
  if (prev && prev.classList && prev.classList.contains('decisions-tray')) {
    return prev;
  }

  const tray = document.createElement('div');
  tray.className = 'decisions-tray';
  tray.innerHTML = `
    <div class="decisions-tray-header">
      <div class="decisions-tray-title">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        <span>Decisions</span>
        <span class="decisions-tray-count">0 of 0 resolved</span>
      </div>
      <span class="decisions-tray-hint">Resolve before execution</span>
    </div>
    <div class="decisions-tray-body"></div>`;
  bq.before(tray);
  return tray;
}

function updateDecisionsTrayCount(tray) {
  const rows = tray.querySelectorAll('.decision-row');
  const answered = tray.querySelectorAll('.decision-row.row-answered').length;
  const countEl = tray.querySelector('.decisions-tray-count');
  if (countEl) countEl.textContent = `${answered} of ${rows.length} resolved`;
}

function truncateText(text, max) {
  const clean = (text || '').trim();
  return clean.length > max ? clean.slice(0, max).trim() + '\u2026' : clean;
}

function renderInteractiveChoiceCard(bq, title, groupIdx, decisionNumber) {
  const tray = getOrCreateDecisionsTray(bq);
  const rowsContainer = tray.querySelector('.decisions-tray-body');

  const row = document.createElement('div');
  row.className = 'decision-row row-collapsed';
  row.id = `choice_card_${groupIdx}`;
  row.dataset.choiceTitle = title;

  const header = document.createElement('div');
  header.className = 'decision-row-header';

  const badge = document.createElement('span');
  badge.className = 'decision-badge decision-badge-choice';
  badge.textContent = `D${decisionNumber}`;
  header.appendChild(badge);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'decision-row-title';
  const nameEl = document.createElement('div');
  nameEl.className = 'decision-row-name';
  nameEl.textContent = title;
  const subEl = document.createElement('div');
  subEl.className = 'decision-row-sub';
  titleWrap.appendChild(nameEl);
  titleWrap.appendChild(subEl);
  header.appendChild(titleWrap);

  const statusBadge = document.createElement('span');
  statusBadge.className = 'card-status-badge unanswered';
  statusBadge.textContent = 'Not answered';
  header.appendChild(statusBadge);

  const chevron = document.createElement('span');
  chevron.className = 'decision-row-chevron';
  chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
  header.appendChild(chevron);

  header.addEventListener('click', (e) => {
    if (e.target.closest('.btn-clear-choice')) return;
    row.classList.toggle('row-collapsed');
  });
  row.appendChild(header);

  const body = document.createElement('div');
  body.className = 'decision-row-body';

  const items = bq.querySelectorAll('li');
  const paragraph = bq.querySelector('p');
  const optionTitles = [];

  if (paragraph) {
    const qText = paragraph.innerHTML.replace(/\[!CHOICE\][^\n<]*/gi, '').trim();
    if (qText) {
      const qDiv = document.createElement('div');
      qDiv.className = 'decision-row-question';
      qDiv.innerHTML = qText;
      body.appendChild(qDiv);
    }
  }

  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'choice-options-list';

  const existingSelection = state.selections[title];
  const hasExisting = Boolean(existingSelection && existingSelection.selectedText);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear-choice';
  clearBtn.textContent = 'Clear';

  function updateSubtitle() {
    const sel = state.selections[title];
    subEl.textContent = sel && sel.selectedText
      ? truncateText(sel.selectedText, 70)
      : optionTitles.join(' \u00b7 ');
  }

  function updateCardState(selectedVal) {
    if (selectedVal) {
      statusBadge.className = 'card-status-badge answered';
      statusBadge.textContent = 'Selected';
      row.classList.add('row-answered');
      state.selections[title] = { selectedText: selectedVal, cardId: row.id };
    } else {
      statusBadge.className = 'card-status-badge unanswered';
      statusBadge.textContent = 'Not answered';
      row.classList.remove('row-answered');
      delete state.selections[title];
    }
    updateSubtitle();
    updateDecisionsTrayCount(tray);
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
    const { title: optTitle, description: optDesc, isRecommended, isDefaultChecked, cleanText } = parseChoiceItemData(rawText);
    optionTitles.push(optTitle);

    const isSelected = (hasExisting && existingSelection.selectedText === cleanText) || (!hasExisting && isDefaultChecked);

    const optLabel = document.createElement('label');
    optLabel.className = 'choice-option-item';
    if (isSelected) {
      optLabel.classList.add('selected');
      statusBadge.className = 'card-status-badge answered';
      statusBadge.textContent = 'Selected';
      row.classList.add('row-answered');
      state.selections[title] = { selectedText: cleanText, cardId: row.id };
    }

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `choice_group_${groupIdx}`;
    radio.value = cleanText;
    radio.checked = isSelected;
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

  const clearRow = document.createElement('div');
  clearRow.className = 'decision-row-clear';
  clearRow.appendChild(clearBtn);
  body.appendChild(clearRow);

  updateSubtitle();

  row.appendChild(body);
  rowsContainer.appendChild(row);
  updateDecisionsTrayCount(tray);
  bq.remove();
}

function renderInteractiveQuestionCard(bq, title, decisionNumber) {
  const tray = getOrCreateDecisionsTray(bq);
  const rowsContainer = tray.querySelector('.decisions-tray-body');

  const row = document.createElement('div');
  row.className = 'decision-row row-collapsed';
  row.id = `question_card_${Math.random().toString(36).slice(2, 8)}`;
  row.dataset.questionTitle = title;

  const header = document.createElement('div');
  header.className = 'decision-row-header';

  const badge = document.createElement('span');
  badge.className = 'decision-badge decision-badge-question';
  badge.textContent = `Q${decisionNumber}`;
  header.appendChild(badge);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'decision-row-title';
  const nameEl = document.createElement('div');
  nameEl.className = 'decision-row-name';
  nameEl.textContent = title;
  const subEl = document.createElement('div');
  subEl.className = 'decision-row-sub';
  titleWrap.appendChild(nameEl);
  titleWrap.appendChild(subEl);
  header.appendChild(titleWrap);

  const statusBadge = document.createElement('span');
  statusBadge.className = 'card-status-badge unanswered';
  statusBadge.textContent = 'Unanswered';
  header.appendChild(statusBadge);

  const chevron = document.createElement('span');
  chevron.className = 'decision-row-chevron';
  chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`;
  header.appendChild(chevron);

  header.addEventListener('click', () => {
    row.classList.toggle('row-collapsed');
  });
  row.appendChild(header);

  const body = document.createElement('div');
  body.className = 'decision-row-body';

  const paragraph = bq.querySelector('p');
  let questionText = '';
  if (paragraph) {
    questionText = paragraph.innerHTML.replace(/\[!QUESTION\][^\n<]*/gi, '').trim();
    if (questionText) {
      const qDiv = document.createElement('div');
      qDiv.className = 'decision-row-question';
      qDiv.innerHTML = questionText;
      body.appendChild(qDiv);
    }
  }

  const textarea = document.createElement('textarea');
  textarea.className = 'question-card-textarea';
  textarea.placeholder = 'Type your answer or preference for the agent here\u2026';
  textarea.rows = 2;

  function updateSubtitle() {
    const draft = state.draftAnswers[title];
    subEl.textContent = draft && draft.answer
      ? truncateText(draft.answer, 70)
      : truncateText(paragraph ? paragraph.textContent.replace(/^\[!QUESTION\][^\n]*/i, '') : '', 70);
  }

  if (state.draftAnswers[title] && state.draftAnswers[title].answer) {
    textarea.value = state.draftAnswers[title].answer;
    statusBadge.className = 'card-status-badge answered';
    statusBadge.textContent = 'Answered';
    row.classList.add('row-answered');
  }

  let debounceTimer = null;
  textarea.addEventListener('input', () => {
    const val = textarea.value.trim();
    if (val) {
      statusBadge.className = 'card-status-badge answered';
      statusBadge.textContent = 'Answered';
      row.classList.add('row-answered');
      state.draftAnswers[title] = { answer: val, cardId: row.id };
    } else {
      statusBadge.className = 'card-status-badge unanswered';
      statusBadge.textContent = 'Unanswered';
      row.classList.remove('row-answered');
      delete state.draftAnswers[title];
    }
    updateSubtitle();
    updateDecisionsTrayCount(tray);
    updateActionButtonsState();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      renderQuestionsSidebar();
    }, 200);
  });

  body.appendChild(textarea);
  updateSubtitle();

  row.appendChild(body);
  rowsContainer.appendChild(row);
  updateDecisionsTrayCount(tray);
  bq.remove();
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
    item.dataset.tocTarget = id;
    item.textContent = heading.textContent.replace(/^(#+\s*|\[!(NOTE|TIP|WARNING|CHOICE|QUESTION)\])/, '').trim();

    item.addEventListener('click', () => {
      // If inside a details accordion, auto-open it
      const parentDetails = heading.closest('details');
      if (parentDetails) {
        parentDetails.setAttribute('open', '');
      }

      // If heading was collapsed, expand it
      if (heading.classList.contains('section-collapsed')) {
        heading.classList.remove('section-collapsed');
        const isH2 = heading.tagName.toLowerCase() === 'h2';
        const stopTags = isH2 ? ['H1', 'H2'] : ['H1', 'H2', 'H3'];
        let curr = heading.nextElementSibling;
        while (curr && !stopTags.includes(curr.tagName.toUpperCase())) {
          curr.classList.remove('section-node-hidden');
          curr = curr.nextElementSibling;
        }
      }

      scrollAndHighlight(id);
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

function updateTocScrollSpy() {
  const scrollArea = document.getElementById('docScrollArea');
  const tocList = document.getElementById('tocList');
  if (!scrollArea || !tocList) return;

  const headings = document.querySelectorAll('#renderedOutput h1[id], #renderedOutput h2[id], #renderedOutput h3[id]');
  if (!headings.length) return;

  const refTop = scrollArea.getBoundingClientRect().top + 120;
  let activeId = headings[0].id;
  headings.forEach((h) => {
    if (h.getBoundingClientRect().top <= refTop) activeId = h.id;
  });

  tocList.querySelectorAll('.toc-item').forEach((item) => {
    item.classList.toggle('toc-active', item.dataset.tocTarget === activeId);
  });
}

function setupEventListeners() {
  const scrollArea = document.getElementById('docScrollArea');
  const popover = document.getElementById('selectionPopover');

  // Scroll-spy: highlight the active section in the Outline sidebar while scrolling
  scrollArea.addEventListener('scroll', () => {
    window.requestAnimationFrame(updateTocScrollSpy);
  }, { passive: true });

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

  // View Mode switcher (Summary / Full)
  const btnViewSummary = document.getElementById('btnViewSummary');
  if (btnViewSummary) {
    btnViewSummary.addEventListener('click', () => setViewMode('summary'));
  }

  const btnViewFull = document.getElementById('btnViewFull');
  if (btnViewFull) {
    btnViewFull.addEventListener('click', () => setViewMode('full'));
  }

  const btnSwitchToFull = document.getElementById('btnSwitchToFull');
  if (btnSwitchToFull) {
    btnSwitchToFull.addEventListener('click', () => setViewMode('full'));
  }

  // TOC sidebar Collapse/Expand all buttons
  const btnCollapseAll = document.getElementById('btnCollapseAll');
  if (btnCollapseAll) {
    btnCollapseAll.addEventListener('click', collapseAllSections);
  }

  const btnExpandAll = document.getElementById('btnExpandAll');
  if (btnExpandAll) {
    btnExpandAll.addEventListener('click', expandAllSections);
  }

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

  document.addEventListener('keydown', handleAskKeydown);

  // Notify server when tab is closed or navigated away
  window.addEventListener('pagehide', () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/shutdown', JSON.stringify({ reason: 'tab_closed' }));
      } else {
        fetch('/api/shutdown', { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch (e) {}
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

/* ------------------------------------------------------------------ *
 * Agent Questions ("asks") - the agent pushes questions into THIS tab
 * instead of asking in the CLI, and the user answers them right here.
 * ------------------------------------------------------------------ */

function pendingAskRounds() {
  return (state.agentQuestions || []).filter((r) => r.status !== 'answered');
}

function hasPendingAsks() {
  return pendingAskRounds().length > 0;
}

function askKey(roundId, questionId) {
  return `${roundId}:${questionId}`;
}

function flattenPendingAsks() {
  const items = [];
  pendingAskRounds().forEach((round) => {
    round.questions.forEach((q) => {
      items.push({ roundId: round.roundId, key: askKey(round.roundId, q.id), q });
    });
  });
  return items;
}

function answeredAskCount() {
  return flattenPendingAsks().filter((it) => {
    const a = state.askAnswers[it.key];
    return a && a.value;
  }).length;
}

/**
 * Footer takeover: while the agent waits on answers, the comment box is
 * replaced by a CLI-style questionnaire strip. Every question - including
 * multiple-choice ones - always offers a free-text answer.
 */
function renderAskFooter() {
  const strip = document.getElementById('footerAskMode');
  const inputRow = document.getElementById('footerInputRow');
  const bar = document.querySelector('.footer-bar');
  if (!strip || !inputRow) return;

  const items = flattenPendingAsks();

  if (items.length === 0 || state.askDeferred) {
    strip.style.display = 'none';
    strip.innerHTML = '';
    inputRow.style.display = '';
    if (bar) bar.classList.remove('footer-ask-active');
    return;
  }

  if (bar) bar.classList.add('footer-ask-active');

  if (state.askCursor >= items.length) state.askCursor = items.length - 1;
  if (state.askCursor < 0) state.askCursor = 0;

  const item = items[state.askCursor];
  const q = item.q;
  const entry = state.askAnswers[item.key] || {};
  const agentName = state.callerAgent.name || 'Agent';
  const agentStyle = getAgentAvatarStyle(state.callerAgent);
  const agentSymbol = getAgentAvatarSymbol(state.callerAgent);
  const isChoice = q.type === 'choice' && q.options && q.options.length > 0;
  const optionLabels = isChoice ? q.options.map((o) => o.label) : [];
  const isCustom = Boolean(entry.value) && !optionLabels.includes(entry.value);

  let html = `
    <div class="ask-strip-header">
      <div class="agent-avatar-sm" style="${agentStyle}">${agentSymbol}</div>
      <span class="ask-strip-who">${escapeHtml(agentName)} asks</span>
      <div class="ask-strip-tabs">`;

  items.forEach((it, i) => {
    const done = state.askAnswers[it.key] && state.askAnswers[it.key].value;
    html += `<button type="button" class="ask-tab${i === state.askCursor ? ' ask-tab-active' : ''}${done ? ' ask-tab-done' : ''}"
      onclick="gotoAsk(${i})" title="${escapeHtml(it.q.title || '')}">Q${i + 1}</button>`;
  });

  html += `
      </div>
      <span class="ask-strip-count">${answeredAskCount()}/${items.length} answered</span>
      <button type="button" class="ask-strip-later" onclick="deferAsks()" title="Hide the questions and restore the comment box (Esc)">Answer later</button>
    </div>
    <div class="ask-strip-body">
      <div class="ask-strip-title">${escapeHtml(q.title || 'Question')}</div>
      <div class="ask-strip-question">${escapeHtml(q.question || '')}</div>`;

  if (isChoice) {
    html += '<div class="ask-strip-options">';
    q.options.forEach((opt, i) => {
      const selected = entry.value === opt.label;
      html += `
        <button type="button" class="ask-option-row${selected ? ' ask-option-row-selected' : ''}" onclick="pickAskOption(${i})">
          <span class="ask-option-key">${i + 1}</span>
          <span class="ask-option-main">
            <span class="ask-option-label">${escapeHtml(opt.label)}${opt.recommended ? '<span class="ask-option-rec">Recommended</span>' : ''}</span>
            ${opt.description ? `<span class="ask-option-desc">${escapeHtml(opt.description)}</span>` : ''}
          </span>
        </button>`;
    });

    html += `
      <div class="ask-option-row ask-option-other${isCustom ? ' ask-option-row-selected' : ''}">
        <span class="ask-option-key">${q.options.length + 1}</span>
        <input type="text" class="ask-other-input" id="askOtherInput" placeholder="Or write your own answer\u2026"
          value="${isCustom ? escapeHtml(entry.value) : ''}" oninput="setAskAnswer('${escapeHtml(item.key)}', this.value)">
      </div>
    </div>`;
  } else {
    html += `
      <textarea class="ask-strip-textarea" id="askTextInput" rows="2" placeholder="Type your answer for the agent\u2026"
        oninput="setAskAnswer('${escapeHtml(item.key)}', this.value)">${escapeHtml(entry.value || '')}</textarea>`;
  }

  const sendEnabled = state.serverAlive && answeredAskCount() > 0;

  html += `
    </div>
    <div class="ask-strip-actions">
      <span class="ask-strip-hint">1-9 pick \u00b7 type to write your own \u00b7 \u2190 \u2192 switch question \u00b7 Ctrl+Enter send</span>
      <button type="button" class="ask-nav-btn" onclick="stepAsk(-1)" ${state.askCursor === 0 ? 'disabled' : ''}>\u2190 Prev</button>
      <button type="button" class="ask-nav-btn" onclick="stepAsk(1)" ${state.askCursor >= items.length - 1 ? 'disabled' : ''}>Next \u2192</button>
      <button type="button" class="footer-btn btn-answers${sendEnabled ? '' : ' btn-disabled'}" id="btnAskSend" ${sendEnabled ? '' : 'disabled'} onclick="sendAskAnswers()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        <span>Send answers (${answeredAskCount()}/${items.length})</span>
      </button>
    </div>`;

  strip.innerHTML = html;
  strip.style.display = 'block';
  inputRow.style.display = 'none';
}

/** Single entry point used by the polling / fetch paths. */
function renderAgentAskPanel() {
  renderAskFooter();
}

window.gotoAsk = function (index) {
  state.askCursor = index;
  renderAskFooter();
};

window.stepAsk = function (delta) {
  state.askCursor += delta;
  renderAskFooter();
};

window.deferAsks = function () {
  state.askDeferred = true;
  renderAskFooter();
  renderQuestionsSidebar();
  updateSubmitButtonsEnabled();
};

window.resumeAsks = function () {
  state.askDeferred = false;
  const items = flattenPendingAsks();
  const firstUnanswered = items.findIndex((it) => !(state.askAnswers[it.key] && state.askAnswers[it.key].value));
  state.askCursor = firstUnanswered === -1 ? 0 : firstUnanswered;
  renderAskFooter();
  renderQuestionsSidebar();
  updateSubmitButtonsEnabled();
};

window.pickAskOption = function (optionIndex) {
  const items = flattenPendingAsks();
  const item = items[state.askCursor];
  if (!item) return;
  const opt = item.q.options[optionIndex];
  if (!opt) return;
  const current = state.askAnswers[item.key];
  if (current && current.value === opt.label) {
    delete state.askAnswers[item.key];
  } else {
    state.askAnswers[item.key] = { value: opt.label };
  }
  // Auto-advance to the next question, like the CLI questionnaire does.
  if (state.askAnswers[item.key] && state.askCursor < items.length - 1) state.askCursor += 1;
  renderAskFooter();
  renderQuestionsSidebar();
};

window.setAskAnswer = function (key, value) {
  const val = (value || '').trim();
  if (!val) delete state.askAnswers[key];
  else state.askAnswers[key] = { value: val };

  // Update counters in place so typing never steals focus from the input.
  const items = flattenPendingAsks();
  const sendBtn = document.getElementById('btnAskSend');
  if (sendBtn) {
    const label = sendBtn.querySelector('span');
    if (label) label.textContent = `Send answers (${answeredAskCount()}/${items.length})`;
    const enabled = state.serverAlive && answeredAskCount() > 0;
    sendBtn.disabled = !enabled;
    sendBtn.classList.toggle('btn-disabled', !enabled);
  }
  const countEl = document.querySelector('.ask-strip-count');
  if (countEl) countEl.textContent = `${answeredAskCount()}/${items.length} answered`;
  const activeTab = document.querySelector('.ask-tab-active');
  if (activeTab) activeTab.classList.toggle('ask-tab-done', Boolean(val));
  const otherRow = document.querySelector('.ask-option-other');
  if (otherRow) otherRow.classList.toggle('ask-option-row-selected', Boolean(val));
  document.querySelectorAll('.ask-option-row-selected').forEach((el) => {
    if (!el.classList.contains('ask-option-other')) el.classList.remove('ask-option-row-selected');
  });
  renderQuestionsSidebar();
};

window.sendAskAnswers = function () {
  if (!state.serverAlive || answeredAskCount() === 0) return;
  submitFeedback('answered');
};

function collectAgentAnswers() {
  return flattenPendingAsks().map(({ roundId, key, q }) => {
    const entry = state.askAnswers[key];
    const value = entry ? entry.value : '';
    return {
      roundId,
      id: q.id,
      type: q.type,
      title: q.title,
      question: q.question,
      ...(q.type === 'choice' ? { selected: value } : { answer: value }),
    };
  });
}

function updateSendAnswersButton() {
  // The send button lives inside the footer strip and is rendered with it.
  renderAskFooter();
}

function markAsksAnswered(answers) {
  const roundIds = new Set(answers.map((a) => a.roundId));
  (state.agentQuestions || []).forEach((round) => {
    if (roundIds.has(round.roundId)) round.status = 'answered';
  });
  answers.forEach((a) => delete state.askAnswers[askKey(a.roundId, a.id)]);
  state.askDeferred = false;
  state.askCursor = 0;
  renderAskFooter();
}

/** CLI-parity keyboard control for the footer questionnaire. */
function handleAskKeydown(e) {
  if (!hasPendingAsks() || state.askDeferred) return;

  const strip = document.getElementById('footerAskMode');
  if (!strip || strip.style.display === 'none') return;

  const items = flattenPendingAsks();
  const item = items[state.askCursor];
  if (!item) return;

  const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);

  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    window.sendAskAnswers();
    return;
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    window.deferAsks();
    return;
  }

  if (typing) return;

  if (/^[1-9]$/.test(e.key) && item.q.type === 'choice') {
    const idx = parseInt(e.key, 10) - 1;
    const optionCount = (item.q.options || []).length;
    if (idx < optionCount) {
      e.preventDefault();
      window.pickAskOption(idx);
    } else if (idx === optionCount) {
      e.preventDefault();
      const input = document.getElementById('askOtherInput');
      if (input) input.focus();
    }
    return;
  }

  if (e.key === 'ArrowRight') {
    e.preventDefault();
    window.stepAsk(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    window.stepAsk(-1);
  }
}

function renderQuestionsSidebar() {
  const list = document.getElementById('questionsList');
  const badge = document.getElementById('sidebarBadge');

  const selectionKeys = Object.keys(state.selections);
  const draftAnswerKeys = Object.keys(state.draftAnswers);
  const totalDraftCount = selectionKeys.length + draftAnswerKeys.length + state.questions.length;
  const totalHistoryCount = state.feedbackHistory.length;
  const pendingAskCount = pendingAskRounds().reduce((sum, r) => sum + r.questions.length, 0);
  const totalItems = totalDraftCount + totalHistoryCount + pendingAskCount;

  badge.textContent = totalItems;

  if (totalItems === 0) {
    list.innerHTML = `
      <div class="empty-sidebar">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>Pick an option, answer a question, or highlight text to start a reply.</span>
      </div>`;
    return;
  }

  let html = '';

  // 1. Render "Pending this turn" panel (draft choices, answers & text notes)
  if (totalDraftCount > 0) {
    html += `
      <div class="draft-selections-box">
        <div class="draft-selections-header">
          <span>Pending this turn</span>
        </div>
        <div class="draft-items-list">`;

    selectionKeys.forEach((title) => {
      const item = state.selections[title];
      html += `
        <div class="draft-selection-pill pill-choice" onclick="scrollAndHighlight('${item.cardId}')" title="Design Choice: Click to scroll to this card">
          <span class="pill-dot"></span>
          <span class="pill-content">
            <span class="pill-title">${escapeHtml(title.toUpperCase())}</span>
            <span class="pill-body">${escapeHtml(item.selectedText)}</span>
          </span>
        </div>`;
    });

    draftAnswerKeys.forEach((title) => {
      const item = state.draftAnswers[title];
      html += `
        <div class="draft-selection-pill pill-choice" onclick="scrollAndHighlight('${item.cardId}')" title="Question Answer: Click to scroll to this card">
          <span class="pill-dot"></span>
          <span class="pill-content">
            <span class="pill-title">${escapeHtml(title.toUpperCase())} · ANSWER</span>
            <span class="pill-body">${escapeHtml(item.answer)}</span>
          </span>
        </div>`;
    });

    state.questions.forEach((q) => {
      html += `
        <div class="draft-selection-pill pill-note" onclick="scrollToNote(${q.id})" title="Note on selection: Click to scroll to this card">
          <span class="pill-dot"></span>
          <span class="pill-content">
            <span class="pill-title">NOTE ON SELECTION</span>
            <span class="pill-body">${escapeHtml(q.text)}</span>
          </span>
          <button class="btn-delete-chat-item" onclick="event.stopPropagation(); deleteQuestion(${q.id})" title="Delete note">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
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
              <span class="typing-dots"><span></span><span></span><span></span></span>
            </div>
          </div>`;
      } else {
        const responseTime = item.addressedAt || item.timestamp;
        const diff = item.diffSummary;
        const note = item.agentNote;
        const detailsId = `diff_details_${item.id}`;
        const hasDetails = Boolean(diff);
        const summaryLine = note
          ? null
          : `Plan was updated live by <strong>${escapeHtml(agentName)}</strong>.`;

        html += `
          <div class="chat-bubble bubble-agent bubble-response">
            <div class="bubble-header">
              <div class="agent-avatar-sm" style="${agentStyle}">${agentSymbol}</div>
              <span class="bubble-sender">${escapeHtml(agentName)}</span>
              <span class="bubble-tag bubble-tag-done">Updated</span>
              <span class="bubble-time">${responseTime}</span>
            </div>
            <div class="bubble-response-content">
              ${note ? `<div class="agent-authored-note">${escapeHtml(note)}</div>` : ''}
              ${summaryLine ? `<div class="diff-metadata-row">${summaryLine}</div>` : ''}
              ${
                hasDetails
                  ? `<button type="button" class="btn-toggle-details" onclick="toggleDiffDetails('${detailsId}', this)">
                      <span>Show what changed</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
                    </button>
                    <div class="diff-details-panel" id="${detailsId}" style="display:none;">
                      <div class="diff-metadata-row">
                        <span>Plan modified:</span>
                        <span class="diff-added">+${diff.added}</span> / <span class="diff-removed">-${diff.removed}</span> lines
                      </div>
                      ${diff.headings.length ? `<div class="diff-headings-row">Sections touched: ${diff.headings.map(h => `<span class="diff-heading-chip">${escapeHtml(h)}</span>`).join('')}</div>` : ''}
                    </div>`
                  : ''
              }
            </div>
          </div>`;
      }
    });

    html += '</div>';
  }

  // 3. The agent's pending questions belong at the BOTTOM of the stream -
  // they are the newest message in the conversation.
  if (pendingAskCount > 0) {
    const agentName = state.callerAgent.name || 'Agent';
    const agentStyle = getAgentAvatarStyle(state.callerAgent);
    const agentSymbol = getAgentAvatarSymbol(state.callerAgent);
    const items = flattenPendingAsks();
    const answered = answeredAskCount();

    html += `
      <div class="chat-stream chat-stream-tail">
        <div class="chat-bubble bubble-agent bubble-ask" onclick="resumeAsks()">
          <div class="bubble-header">
            <div class="agent-avatar-sm" style="${agentStyle}">${agentSymbol}</div>
            <span class="bubble-sender">${escapeHtml(agentName)}</span>
            <span class="bubble-tag bubble-tag-ask">Asked you</span>
            <span class="bubble-time">${answered}/${items.length}</span>
          </div>
          <div class="bubble-body-text">Needs your input on ${items.length} thing${items.length === 1 ? '' : 's'}:</div>
          <div class="ask-bubble-list">`;

    items.forEach((it, i) => {
      const entry = state.askAnswers[it.key];
      const value = entry && entry.value ? entry.value : '';
      html += `
            <div class="ask-bubble-item${value ? ' ask-bubble-item-done' : ''}" onclick="event.stopPropagation(); gotoAskFromSidebar(${i})">
              <span class="ask-bubble-index">${i + 1}</span>
              <span class="ask-bubble-text">
                <span class="ask-bubble-title">${escapeHtml(it.q.title || 'Question')}</span>
                <span class="ask-bubble-answer">${value ? escapeHtml(value) : 'Awaiting your answer'}</span>
              </span>
            </div>`;
    });

    html += `
          </div>
          <button type="button" class="ask-bubble-cta" onclick="event.stopPropagation(); resumeAsks()">Answer now →</button>
        </div>
      </div>`;
  }

  list.innerHTML = html;

  // Keep the newest message visible, like a real chat.
  list.scrollTop = list.scrollHeight;
}

window.gotoAskFromSidebar = function (index) {
  state.askDeferred = false;
  state.askCursor = index;
  renderAskFooter();
  updateSubmitButtonsEnabled();
  const strip = document.getElementById('footerAskMode');
  if (strip) {
    strip.classList.remove('highlight-flash');
    void strip.offsetWidth;
    strip.classList.add('highlight-flash');
    setTimeout(() => strip.classList.remove('highlight-flash'), 1200);
  }
};

function scrollToNote(id) {
  const root = document.getElementById('renderedOutput');
  const mark = root && root.querySelector(`.commark[data-comment-id="${id}"]`);
  if (!mark) return;
  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  mark.classList.remove('highlight-flash');
  void mark.offsetWidth;
  mark.classList.add('highlight-flash');
  setTimeout(() => mark.classList.remove('highlight-flash'), 1500);
}
window.scrollToNote = scrollToNote;

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

window.toggleDiffDetails = function(detailsId, btnEl) {
  const panel = document.getElementById(detailsId);
  if (!panel) return;
  const isHidden = panel.style.display === 'none' || !panel.style.display;
  panel.style.display = isHidden ? 'block' : 'none';
  if (btnEl) {
    btnEl.classList.toggle('expanded', isHidden);
    const label = btnEl.querySelector('span');
    if (label) label.textContent = isHidden ? 'Hide what changed' : 'Show what changed';
  }
};

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
  const answers = collectAgentAnswers();

  if (status === 'answered') {
    const answered = answers.filter((a) => a.selected || a.answer);
    if (answered.length === 0) return;

    state.feedbackHistory.push({
      id: Date.now(),
      type: 'answers',
      text:
        (comment ? `${comment}\n\n` : '') +
        answered.map((a) => `${a.title || a.question}: ${a.selected || a.answer}`).join('\n'),
      status: 'pending',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });

    markAsksAnswered(answers);
    if (commentInput) commentInput.value = '';
    renderQuestionsSidebar();
    updateSubmitButtonsEnabled();
  }

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
      updateSubmitButtonsEnabled();
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
    answers,
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
        // The session intentionally stays open after approval, so the agent can
        // ask execution-phase questions in THIS tab instead of a new one.
        state.planApproved = true;
        state.status = 'approved';
        updateStatusPill('approved');
        document.getElementById('modalTitle').textContent = 'Plan Approved!';
        document.getElementById('modalMessage').textContent =
          `Approval sent to ${state.callerAgent.name}. Keep this tab open \u2014 the agent will post progress and any questions right here.`;
        document.getElementById('successModal').classList.add('active');

        setTimeout(() => {
          const modal = document.getElementById('successModal');
          if (modal) modal.classList.remove('active');
        }, 3000);
      } else if (status === 'answered') {
        showAgentUpdateToast('Answers sent to agent!');
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
  updateSubmitButtonsEnabled();
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
