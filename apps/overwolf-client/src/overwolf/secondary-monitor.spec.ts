import {
  centerWindowOnDisplay,
  OverwolfDisplay,
  selectPreferredDesktopDisplay,
  selectPrimaryDisplay,
  selectSecondaryDisplay,
} from './secondary-monitor';

const primaryDisplay: OverwolfDisplay = {
  id: 'primary',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  is_primary: true,
};

const secondaryDisplay: OverwolfDisplay = {
  id: 'secondary',
  x: 1920,
  y: 0,
  width: 2560,
  height: 1440,
  is_primary: false,
};

describe('secondary monitor positioning', () => {
  it('selects a usable primary display', () => {
    expect(selectPrimaryDisplay([secondaryDisplay, primaryDisplay])).toEqual(
      primaryDisplay,
    );
  });

  it('selects a usable non-primary display', () => {
    expect(selectSecondaryDisplay([primaryDisplay, secondaryDisplay])).toEqual(
      secondaryDisplay,
    );
  });

  it('returns undefined without a secondary display', () => {
    expect(selectSecondaryDisplay([primaryDisplay])).toBeUndefined();
  });

  it('falls back to the primary display when no secondary display exists', () => {
    expect(selectPreferredDesktopDisplay([primaryDisplay], true)).toEqual(
      primaryDisplay,
    );
  });

  it('can explicitly select the primary display for recovery', () => {
    expect(
      selectPreferredDesktopDisplay([secondaryDisplay, primaryDisplay], false),
    ).toEqual(primaryDisplay);
  });

  it('centers the window on a display to the right', () => {
    expect(centerWindowOnDisplay(secondaryDisplay, 600, 600)).toEqual({
      x: 2900,
      y: 420,
    });
  });

  it('centers the window on a display to the left', () => {
    expect(
      centerWindowOnDisplay(
        { ...secondaryDisplay, x: -1920, width: 1920, height: 1080 },
        600,
        600,
      ),
    ).toEqual({ x: -1260, y: 240 });
  });
});
