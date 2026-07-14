const LEGACY_BUILD_STYLE_ID = 'legacy-build-guide-disabled-styles';

export function disableLegacyBuildGuide(): void {
  if (!document.getElementById(LEGACY_BUILD_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = LEGACY_BUILD_STYLE_ID;
    style.textContent = `
      #guide-empty,
      #guide-active {
        display: none !important;
      }
    `;
    document.head.append(style);
  }

  hideLegacyBuildElements();
}

function hideLegacyBuildElements(): void {
  for (const elementId of ['guide-empty', 'guide-active']) {
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = 'none';
      element.setAttribute('aria-hidden', 'true');
    }
  }
}
