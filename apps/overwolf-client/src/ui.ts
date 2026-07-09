export function updateStatus(text: string, statusClass?: 'connected' | 'error' | 'init'): void {
  const el = document.getElementById('status');
  if (el) {
    el.textContent = text;
    el.className = statusClass || '';
  }
}

export function updateLastEvent(text: string): void {
  const el = document.getElementById('last-event');
  if (el) {
    el.textContent = text;
  }
}

let sendCount = 0;
export function incrementSends(): void {
  sendCount++;
  const el = document.getElementById('last-send');
  if (el) {
    el.textContent = String(sendCount);
  }
}

export function logConsole(message: string): void {
  const el = document.getElementById('console');
  if (el) {
    const timestamp = new Date().toLocaleTimeString();
    el.textContent = `[${timestamp}] ${message}\n` + (el.textContent || '');
  }
  console.log(message);
}

export function updateIndicator(text: string, active: boolean): void {
  const textEl = document.getElementById('indicator-text');
  const dotEl = document.getElementById('indicator-dot');
  if (textEl) {
    textEl.textContent = text;
  }
  if (dotEl) {
    if (active) {
      dotEl.classList.add('active');
    } else {
      dotEl.classList.remove('active');
    }
  }
}

// Dynamo Guide Integration
let currentBuilds: any[] = [];

export function showDynamoGuide(buildsData: any): void {
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');
  const selectEl = document.getElementById('build-select') as HTMLSelectElement;

  if (!emptyEl || !activeEl || !selectEl) return;

  emptyEl.style.display = 'none';
  activeEl.style.display = 'flex';

  currentBuilds = buildsData.builds || [];

  // Populate build dropdown
  selectEl.innerHTML = currentBuilds.map((b, idx) => `
    <option value="${idx}">${b.name}</option>
  `).join('');

  renderActiveBuild(0);
}

export function hideDynamoGuide(): void {
  const emptyEl = document.getElementById('guide-empty');
  const activeEl = document.getElementById('guide-active');

  if (!emptyEl || !activeEl) return;

  emptyEl.style.display = 'flex';
  activeEl.style.display = 'none';
}

function renderActiveBuild(idx: number): void {
  const build = currentBuilds[idx];
  if (!build) return;

  const descEl = document.getElementById('guide-build-desc');
  const earlyEl = document.getElementById('phase-early');
  const midEl = document.getElementById('phase-mid');
  const lateEl = document.getElementById('phase-late');

  if (descEl) {
    descEl.textContent = build.description;
  }

  const renderPhaseItems = (items: any[]) => {
    if (!items || items.length === 0) {
      return '<span style="color: var(--text-secondary); font-style: italic; font-size: 0.75rem;">No items</span>';
    }
    return items.map(i => `
      <div class="guide-item-row ${i.slotType}">
        <strong>${i.name}</strong>
        <span class="item-popularity">${i.popularity}%</span>
      </div>
    `).join('');
  };

  if (earlyEl) earlyEl.innerHTML = renderPhaseItems(build.earlyGame);
  if (midEl) midEl.innerHTML = renderPhaseItems(build.midGame);
  if (lateEl) lateEl.innerHTML = renderPhaseItems(build.lateGame);
}

// Bind to window for HTML element access
(window as any).switchActiveBuild = () => {
  const selectEl = document.getElementById('build-select') as HTMLSelectElement;
  if (selectEl) {
    const idx = parseInt(selectEl.value, 10);
    renderActiveBuild(idx);
  }
};
