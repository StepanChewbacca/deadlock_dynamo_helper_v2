import { SituationalItemWarning } from './situational-item-metadata';

const ow = (window as any).overwolf;

if (ow?.windows) {
  ow.windows.getCurrentWindow((result: any) => {
    if (!result?.success || !result.window) {
      return;
    }

    const windowId = result.window.id;
    const card = document.querySelector('.popup-card') as HTMLElement | null;
    const dragHandle = document.querySelector('.popup-drag-handle') as HTMLElement | null;
    const textElement = document.querySelector('.popup-text') as HTMLElement | null;
    const titleElement = document.querySelector('.popup-title') as HTMLElement | null;

    const updateUI = (): void => {
      const mainWindow = ow.windows.getMainWindow() as any;
      const isMenuOpen = Boolean(mainWindow?.overlayMenuActive);
      const warning = mainWindow?.situationalItemWarning as
        | SituationalItemWarning
        | undefined;

      ow.windows.setWindowMouseInputPassThrough?.(windowId, !isMenuOpen);

      if (!card) {
        return;
      }

      if (isMenuOpen) {
        card.style.display = 'flex';
        card.style.opacity = '0.75';
        card.style.border = '2px dashed #ff6b4a';
        if (titleElement) {
          titleElement.textContent = 'Настройка предупреждения';
        }
        if (textElement) {
          textElement.textContent =
            'Зажмите карточку мышкой и перетащите её в нужное место (Ctrl+Tab)';
        }
        return;
      }

      if (warning) {
        card.style.display = 'flex';
        card.style.opacity = '1';
        card.style.border = '2px solid #ff6b4a';
        if (titleElement) {
          titleElement.textContent = 'Внимание от Динамо';
        }
        if (textElement) {
          textElement.textContent = createWarningText(warning);
        }
        return;
      }

      card.style.display = 'none';
    };

    dragHandle?.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      ow.windows.dragMove(windowId);
    });

    const mainWindow = ow.windows.getMainWindow() as any;
    mainWindow.updateWarningUI = updateUI;
    updateUI();
  });
}

function createWarningText(warning: SituationalItemWarning): string {
  const details: string[] = [];
  if (Number.isFinite(warning.lower95OddsRatio)) {
    details.push(`нижняя граница эффекта x${warning.lower95OddsRatio!.toFixed(2)}`);
  }
  if (Number.isSafeInteger(warning.matchupObservationCount)) {
    details.push(`наблюдений: ${warning.matchupObservationCount}`);
  }

  const evidence = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `Ситуативный предмет «${warning.itemName}» поднят в билд против ${warning.enemyHeroName}${evidence}.`;
}
