import { initializeAutomaticSkillBuildRuntimeV2 } from './skill-build-automatic-runtime-v2';
import {
  initializeAutomaticSkillBuildUiV2,
  updateAutomaticSkillBuildUiV2,
} from './skill-build-automatic-ui-v2';

const ow = (window as any).overwolf;

initializeAutomaticSkillBuildUiV2();

if (ow?.windows) {
  ow.windows.getCurrentWindow((result: any) => {
    const mainWindow = ow.windows.getMainWindow() as any;
    mainWindow.inGameAutomaticSkillTrackingUpdate = () => {
      updateAutomaticSkillBuildUiV2();
    };

    if (result?.window?.name === 'in_game') {
      updateAutomaticSkillBuildUiV2();
      return;
    }

    initializeAutomaticSkillBuildRuntimeV2(ow, mainWindow);
  });
}
