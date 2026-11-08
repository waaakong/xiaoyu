module.exports = {
  appId: 'com.waaakong.xiaoyu',
  productName: '小鱼',
  directories: { output: 'release' },
  files: ['electron/**', 'desktop/icon.ico', 'package.json', '!node_modules/**'],
  extraResources: [
    { from: 'build/backend', to: 'backend' },
    { from: 'build/runtime', to: 'runtime' }
  ],
  asar: true,
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'desktop/icon.ico',
    signExecutable: false, artifactName: 'xiaoyu-Setup-${version}-${arch}.${ext}' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: '小鱼',
    uninstallDisplayName: '小鱼', deleteAppDataOnUninstall: false, runAfterFinish: true },
  publish: null
};
