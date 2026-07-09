const REQUIRED_FEATURES = ['game_info', 'match_info'];

export function setRequiredFeatures(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof overwolf === 'undefined' || !overwolf.games || !overwolf.games.events) {
      reject(new Error('Overwolf API is not available in this environment'));
      return;
    }

    overwolf.games.events.setRequiredFeatures(REQUIRED_FEATURES, (result) => {
      if (!result.success) {
        reject(new Error(result.error ?? 'Failed to set required features'));
        return;
      }

      resolve();
    });
  });
}
