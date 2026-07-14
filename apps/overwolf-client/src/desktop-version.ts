const DESKTOP_VERSION = 'v0.1.1';

function updateDesktopVersion(): void {
  const versionTag = document.querySelector('.version-tag');
  if (versionTag) {
    versionTag.textContent = DESKTOP_VERSION;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateDesktopVersion, { once: true });
} else {
  updateDesktopVersion();
}
