import { initializeAutomaticSkillBuildRuntime } from './skill-build-automatic-runtime';
import {
  initializeAutomaticSkillBuildUi,
  updateAutomaticSkillBuildUi,
} from './skill-build-automatic-ui';

const ow = (window as any).overwolf;

initializeAutomaticSkillBuildUi();

if (ow?.windows) {
  ow.windows.getCurrentWindow((result: any) => {
    const mainWindow = ow.windows.getMainWindow() as any;
    mainWindow.inGameAutomaticSkillTrackingUpdate = () => {
      updateAutomaticSkillBuildUi();
    };

    if (result?.window?.name === 'in_game') {
      updateAutomaticSkillBuildUi();
      return;
    }

    initializeAutomaticSkillBuildRuntime(ow, mainWindow);
  });
}
