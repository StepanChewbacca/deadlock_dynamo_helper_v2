const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const publicDir = path.join(appRoot, 'public');
const manifestPath = path.join(publicDir, 'manifest.json');
const packagePath = path.join(appRoot, 'package.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const errors = [];
const DEADLOCK_GAME_ID = 24482;

assert(manifest.manifest_version === 1, 'manifest_version must be 1.');
assert(manifest.type === 'WebApp', 'manifest type must be WebApp.');
assert(manifest.meta?.version === packageJson.version, 'Manifest and package versions must match.');

for (const field of [
  'name',
  'version',
  'minimum-overwolf-version',
  'minimum-gep-version',
  'author',
  'description',
  'icon',
  'icon_gray',
  'launcher_icon',
  'window_icon',
  'dock_button_title',
]) {
  assert(
    typeof manifest.meta?.[field] === 'string' && manifest.meta[field].trim().length > 0,
    `manifest.meta.${field} is required.`,
  );
}

for (const permission of ['GameInfo', 'Hotkeys']) {
  assert(
    Array.isArray(manifest.permissions) && manifest.permissions.includes(permission),
    `Manifest permission ${permission} is required.`,
  );
}

assert(
  manifest.data?.game_targeting?.type === 'dedicated' &&
    manifest.data.game_targeting.game_ids?.includes(DEADLOCK_GAME_ID),
  `game_targeting must include Deadlock game ID ${DEADLOCK_GAME_ID}.`,
);
assert(
  Array.isArray(manifest.data?.game_events) &&
    manifest.data.game_events.includes(DEADLOCK_GAME_ID),
  `game_events must include Deadlock game ID ${DEADLOCK_GAME_ID}.`,
);
assert(
  manifest.data?.launch_events?.some(
    (event) =>
      event?.event === 'GameLaunch' &&
      event.event_data?.game_ids?.includes(DEADLOCK_GAME_ID),
  ),
  'A Deadlock GameLaunch event is required.',
);

const externalMatches = manifest.data?.externally_connectable?.matches;
assert(
  Array.isArray(externalMatches) &&
    externalMatches.some((value) => /^https:\/\/[^/]+$/.test(value)),
  'externally_connectable must include the HTTPS API origin.',
);

assert(
  typeof manifest.data?.start_window === 'string' &&
    manifest.data.windows?.[manifest.data.start_window],
  'start_window must reference a declared window.',
);

for (const [windowName, windowConfig] of Object.entries(manifest.data?.windows || {})) {
  assert(windowName.length <= 20, `Window name ${windowName} exceeds 20 characters.`);
  assert(
    typeof windowConfig.file === 'string' &&
      fs.existsSync(path.join(publicDir, windowConfig.file)),
    `Window ${windowName} references a missing file.`,
  );
}

for (const field of ['icon', 'icon_gray', 'launcher_icon', 'window_icon']) {
  const assetPath = path.join(publicDir, manifest.meta?.[field] || '');
  assert(fs.existsSync(assetPath), `Manifest asset ${field} is missing.`);
  if (fs.existsSync(assetPath)) {
    assertPng(assetPath, field);
  }
}

const distDir = path.join(publicDir, 'dist');
assert(fs.existsSync(path.join(distDir, 'index.js')), 'Compiled dist/index.js is missing.');
assert(
  fs.existsSync(path.join(distDir, 'dynamo_warning.js')),
  'Compiled dist/dynamo_warning.js is missing.',
);

if (errors.length > 0) {
  throw new Error(`Overwolf release validation failed:\n- ${errors.join('\n- ')}`);
}

console.log(
  `Overwolf release ${manifest.meta.version} validated for Deadlock ${DEADLOCK_GAME_ID}.`,
);

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertPng(filePath, label) {
  const buffer = fs.readFileSync(filePath);
  const pngSignature = '89504e470d0a1a0a';
  assert(
    buffer.length >= 24 && buffer.subarray(0, 8).toString('hex') === pngSignature,
    `${label} must reference a real PNG file.`,
  );
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== pngSignature) {
    return;
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert(width > 0 && height > 0, `${label} has invalid dimensions.`);
  assert(width === height, `${label} must be square, got ${width}x${height}.`);
}
