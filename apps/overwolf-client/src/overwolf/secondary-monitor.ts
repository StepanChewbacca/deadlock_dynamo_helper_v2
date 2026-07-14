export interface OverwolfDisplay {
  id?: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export function selectPrimaryDisplay(
  displays: readonly OverwolfDisplay[],
): OverwolfDisplay | undefined {
  return displays.find(
    (display) => display.is_primary && isUsableDisplay(display),
  );
}

export function selectSecondaryDisplay(
  displays: readonly OverwolfDisplay[],
): OverwolfDisplay | undefined {
  return displays.find(
    (display) => !display.is_primary && isUsableDisplay(display),
  );
}

export function selectPreferredDesktopDisplay(
  displays: readonly OverwolfDisplay[],
  preferSecondary: boolean,
): OverwolfDisplay | undefined {
  if (preferSecondary) {
    return selectSecondaryDisplay(displays) ?? selectPrimaryDisplay(displays);
  }

  return selectPrimaryDisplay(displays) ?? selectSecondaryDisplay(displays);
}

export function centerWindowOnDisplay(
  display: OverwolfDisplay,
  windowWidth: unknown,
  windowHeight: unknown,
): WindowPosition {
  const width = normalizeWindowDimension(windowWidth, 600);
  const height = normalizeWindowDimension(windowHeight, 600);
  const horizontalOffset = Math.max(
    0,
    Math.floor((display.width - width) / 2),
  );
  const verticalOffset = Math.max(
    0,
    Math.floor((display.height - height) / 2),
  );

  return {
    x: Math.floor(display.x + horizontalOffset),
    y: Math.floor(display.y + verticalOffset),
  };
}

function isUsableDisplay(display: OverwolfDisplay): boolean {
  return (
    Number.isFinite(display.x) &&
    Number.isFinite(display.y) &&
    Number.isFinite(display.width) &&
    display.width > 0 &&
    Number.isFinite(display.height) &&
    display.height > 0
  );
}

function normalizeWindowDimension(value: unknown, fallback: number): number {
  const dimension = Number(value);
  return Number.isFinite(dimension) && dimension > 0
    ? Math.floor(dimension)
    : fallback;
}
