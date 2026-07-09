declare namespace overwolf {
  namespace games {
    namespace events {
      interface SetRequiredFeaturesResult {
        success: boolean;
        error?: string;
        features?: string[];
      }
      function setRequiredFeatures(
        features: string[],
        callback: (result: SetRequiredFeaturesResult) => void
      ): void;

      interface InfoUpdates2Event {
        info: any;
        feature: string;
      }
      interface NewEventsEvent {
        events: any[];
        feature: string;
      }

      const onInfoUpdates2: {
        addListener(callback: (info: InfoUpdates2Event) => void): void;
        removeListener(callback: (info: InfoUpdates2Event) => void): void;
      };

      const onNewEvents: {
        addListener(callback: (info: NewEventsEvent) => void): void;
        removeListener(callback: (info: NewEventsEvent) => void): void;
      };
    }
  }
}
