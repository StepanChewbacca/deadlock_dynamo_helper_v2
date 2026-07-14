export interface DesktopBuildRowIdentity {
  action: string;
  itemName: string;
}

const ROOT_SELECTOR = '#live-build-desktop-root';
const PHASE_SELECTOR = '.live-build-phase';
const EMPTY_ROW_CLASS = 'live-build-empty-phase';

let observer: MutationObserver | undefined;
let deduplicationScheduled = false;

export function initializeDesktopBuildDeduplication(): void {
  if (
    observer ||
    typeof document === 'undefined' ||
    typeof MutationObserver !== 'function'
  ) {
    return;
  }

  const target = document.documentElement;
  if (!target) {
    return;
  }

  observer = new MutationObserver(() => {
    scheduleDesktopBuildDeduplication();
  });
  observer.observe(target, { childList: true, subtree: true });
  scheduleDesktopBuildDeduplication();
}

export function deduplicateDesktopBuildRows(): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.querySelector(ROOT_SELECTOR);
  if (!root) {
    return;
  }

  const phaseCards = Array.from(
    root.querySelectorAll<HTMLElement>(PHASE_SELECTOR),
  );
  const rows = phaseCards.flatMap((phaseCard) => getActionRows(phaseCard));
  const keepIndexes = new Set(
    selectUniqueBuildRowIndexes(
      rows.map((row) => ({
        action: readCellText(row, 1),
        itemName: readCellText(row, 2),
      })),
    ),
  );

  for (const [index, row] of rows.entries()) {
    if (!keepIndexes.has(index)) {
      row.remove();
    }
  }

  let nextIndex = 1;
  for (const phaseCard of phaseCards) {
    const tbody = phaseCard.querySelector<HTMLTableSectionElement>('tbody');
    if (!tbody) {
      continue;
    }

    const phaseRows = getActionRows(phaseCard);
    if (phaseRows.length === 0) {
      ensureEmptyPhaseRow(tbody);
    } else {
      removeEmptyPhaseRows(tbody);
      for (const row of phaseRows) {
        const indexCell = row.cells.item(0);
        const indexText = String(nextIndex);
        if (indexCell && indexCell.textContent !== indexText) {
          indexCell.textContent = indexText;
        }
        nextIndex += 1;
      }
    }

    updatePhaseCount(phaseCard, phaseRows.length);
  }

  updateBuildActionSummary(root, nextIndex - 1);
}

export function selectUniqueBuildRowIndexes(
  rows: readonly DesktopBuildRowIdentity[],
): number[] {
  const seenAcquisitionItems = new Set<string>();
  const indexes: number[] = [];

  for (const [index, row] of rows.entries()) {
    const action = normalizeIdentityPart(row.action).toUpperCase();
    const itemName = normalizeIdentityPart(row.itemName);
    const isAcquisition = action === 'BUY' || action === 'UPGRADE';

    if (!isAcquisition || !itemName) {
      indexes.push(index);
      continue;
    }

    if (seenAcquisitionItems.has(itemName)) {
      continue;
    }

    seenAcquisitionItems.add(itemName);
    indexes.push(index);
  }

  return indexes;
}

function scheduleDesktopBuildDeduplication(): void {
  if (deduplicationScheduled) {
    return;
  }

  deduplicationScheduled = true;
  queueMicrotask(() => {
    deduplicationScheduled = false;
    deduplicateDesktopBuildRows();
  });
}

function getActionRows(phaseCard: HTMLElement): HTMLTableRowElement[] {
  return Array.from(
    phaseCard.querySelectorAll<HTMLTableRowElement>('tbody tr'),
  ).filter((row) => !row.querySelector(`.${EMPTY_ROW_CLASS}`));
}

function readCellText(row: HTMLTableRowElement, index: number): string {
  return row.cells.item(index)?.textContent?.trim() ?? '';
}

function ensureEmptyPhaseRow(tbody: HTMLTableSectionElement): void {
  if (tbody.querySelector(`.${EMPTY_ROW_CLASS}`)) {
    return;
  }

  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 9;
  cell.className = EMPTY_ROW_CLASS;
  cell.textContent = 'No actions in this phase.';
  row.append(cell);
  tbody.append(row);
}

function removeEmptyPhaseRows(tbody: HTMLTableSectionElement): void {
  for (const cell of Array.from(tbody.querySelectorAll(`.${EMPTY_ROW_CLASS}`))) {
    cell.closest('tr')?.remove();
  }
}

function updatePhaseCount(phaseCard: HTMLElement, count: number): void {
  const countElement = phaseCard.querySelector<HTMLElement>(
    '.live-build-phase-header span',
  );
  const countText = `${count} action${count === 1 ? '' : 's'}`;
  if (countElement && countElement.textContent !== countText) {
    countElement.textContent = countText;
  }
}

function updateBuildActionSummary(root: Element, count: number): void {
  for (const card of Array.from(
    root.querySelectorAll<HTMLElement>('.live-build-summary > div'),
  )) {
    const label = card.querySelector('span')?.textContent?.trim();
    if (label !== 'Build actions') {
      continue;
    }

    const value = card.querySelector('strong');
    const countText = String(count);
    if (value && value.textContent !== countText) {
      value.textContent = countText;
    }
    return;
  }
}

function normalizeIdentityPart(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
