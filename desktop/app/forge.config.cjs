const path = require('node:path');

module.exports = {
  packagerConfig: {
    appBundleId: 'com.trafaelosborn.octave',
    appCategoryType: 'public.app-category-type.productivity',
    asar: true,
    electronVersion: '43.1.1',
    executableName: 'Octave',
    extraResource: [path.join(__dirname, 'runtime')],
    ignore: [
      /^\/forge\.config\.cjs$/,
      /^\/out(?:\/|$)/,
      /^\/runtime(?:\/|$)/,
    ],
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        authors: 'Taylor Osborn',
        description: 'A local-first research workstation',
        name: 'octave_research',
        setupExe: 'OctaveSetup.exe',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};
