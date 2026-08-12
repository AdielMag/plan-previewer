// Plan Previewer Client Application logic matching Claude Design Handoff

let state = {
  filename: 'plan.md',
  filePath: '',
  content: '',
  fileVersion: 1,
  callerAgent: { id: 'claude', name: 'Claude Code', icon: '🤖', badge: 'Claude Code' },
  sessionContext: 'Plan Overview',
  questions: [],
  nextQuestionId: 1,
  popover: { visible: false, x: 0, y: 0, text: '', range: null },
  footerComment: '',
  status: 'in_review' // 'in_review', 'approved', 'changes_requested'
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

async function initApp() {
  setupEventListeners();
  startHeartbeat();
  startFilePolling();
  await fetchPlanData();
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

function startFilePolling() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/version');
      const data = await res.json();
      if (data.fileVersion && data.fileVersion > state.fileVersion) {
        state.fileVersion = data.fileVersion;
        await fetchPlanData();
      }
    } catch (err) {}
  }, 1000);
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

function renderMarkdown() {
  const output = document.getElementById('renderedOutput');

  marked.setOptions({
    gfm: true,
    breaks: false
  });

  let html = marked.parse(state.content);
  output.innerHTML = html;

  // Process image placeholders if diagram links are present
  output.querySelectorAll('img').forEach((img) => {
    const div = document.createElement('div');
    div.className = 'img-slot';
    div.textContent = '◇ ' + (img.alt || 'Diagram placeholder');
    img.replaceWith(div);
  });

  // Highlight code blocks
  output.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

  processCheckboxes();
}

function processCheckboxes() {
  const output = document.getElementById('renderedOutput');
  output.querySelectorAll('li').forEach((li) => {
    const text = li.innerHTML.trim();
    if (text.startsWith('[ ]') || text.startsWith('[x]') || text.startsWith('[X]')) {
      const isChecked = text.startsWith('[x]') || text.startsWith('[X]');
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

  // Close session button
  document.getElementById('btnHeaderClose').addEventListener('click', goBackAndClose);
  document.getElementById('btnModalClose').addEventListener('click', closeTab);

  // Footer Actions
  document.getElementById('btnRequestChanges').addEventListener('click', () => {
    state.status = 'changes_requested';
    updateStatusPill(state.status);
    submitFeedback('changes_requested');
  });

  document.getElementById('btnApprovePlan').addEventListener('click', () => {
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

function renderQuestionsSidebar() {
  const list = document.getElementById('questionsList');
  const badge = document.getElementById('sidebarBadge');

  badge.textContent = state.questions.length;

  if (state.questions.length === 0) {
    list.innerHTML = `<div class="empty-sidebar">Select text in the plan to ask the agent a question about it.</div>`;
    return;
  }

  list.innerHTML = state.questions.map((q) => `
    <div class="question-item-card">
      <div class="question-quote">"${q.quote}"</div>
      <div class="question-body-text">${q.text}</div>
      <div class="question-card-footer">
        <span class="question-status-tag">
          <span class="mini-dot"></span>Sent to agent
        </span>
        <button class="btn-delete-question" onclick="deleteQuestion(${q.id})">delete</button>
      </div>
    </div>
  `).join('');
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
    if (data.success) {
      state.fileVersion = data.fileVersion || state.fileVersion;
    }
  } catch (err) {
    console.error('Failed to save markdown to server:', err);
  }
}

async function submitFeedback(status) {
  const comment = document.getElementById('footerComment').value.trim();

  const payload = {
    status,
    comment,
    questions: state.questions.map(q => ({ section: q.quote, text: q.text })),
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
      document.getElementById('modalTitle').textContent =
        status === 'approved' ? 'Plan Approved!' : 'Changes Requested';
      document.getElementById('modalMessage').textContent =
        `Feedback transmitted back to ${state.callerAgent.name}. Closing tab...`;
      document.getElementById('successModal').classList.add('active');

      setTimeout(() => {
        closeTab();
      }, 1600);
    }
  } catch (err) {
    alert('Failed to transmit feedback to agent. Please try again.');
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
