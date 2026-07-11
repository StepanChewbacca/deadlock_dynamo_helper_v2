const ow = (window as any).overwolf;

if (ow && ow.windows) {
  ow.windows.getCurrentWindow((result: any) => {
    if (result && result.status === 'success' && result.window) {
      const windowId = result.window.id;
      const card = document.querySelector('.popup-card') as HTMLElement;
      const dragHandle = document.querySelector('.popup-drag-handle') as HTMLElement;
      const textEl = document.querySelector('.popup-text') as HTMLElement;
      const titleEl = document.querySelector('.popup-title') as HTMLElement;

      const updateUI = () => {
        const mainWindow = ow.windows.getMainWindow() as any;
        const isMenuOpen = !!(mainWindow && mainWindow.overlayMenuActive);
        const isWarningActive = !!(mainWindow && mainWindow.warningActive);

        // Disable click-through in menu mode to allow dragging, enable in gameplay to not block clicks.
        if (ow.windows.setWindowMouseInputPassThrough) {
          ow.windows.setWindowMouseInputPassThrough(windowId, !isMenuOpen);
        }

        if (card) {
          if (isMenuOpen) {
            // Show placeholder/helper card during Ctrl+Tab configuration
            card.style.display = 'flex';
            card.style.opacity = '0.75';
            card.style.border = '2px dashed #ff6b4a';
            if (titleEl) titleEl.textContent = 'Настройка предупреждения';
            if (textEl) textEl.textContent = 'Зажмите карточку мышкой и перетащите в нужное место (Ctrl+Tab)';
          } else if (isWarningActive) {
            // Show active death warning popup
            card.style.display = 'flex';
            card.style.opacity = '1';
            card.style.border = '2px solid #ef4444';
            if (titleEl) titleEl.textContent = 'Внимание от Динамо';
            if (textEl) textEl.textContent = 'Ты умираешь как мусор, играй аккуратно!';
          } else {
            // Hide card during normal gameplay
            card.style.display = 'none';
          }
        }
      };

      // Dragging the dedicated handle moves the Overwolf window without changing card layout.
      if (dragHandle) {
        dragHandle.addEventListener('mousedown', (event: MouseEvent) => {
          event.preventDefault();
          ow.windows.dragMove(windowId);
        });
      }

      // Initial update
      updateUI();

      // Register the update handler on the main background window
      const mainWindow = ow.windows.getMainWindow() as any;
      if (mainWindow) {
        mainWindow.updateWarningUI = updateUI;
      }
    }
  });
}
