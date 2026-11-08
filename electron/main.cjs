const { app, BrowserWindow, ipcMain, Menu, Tray, dialog, shell, nativeTheme } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow, tray, backend, workspace, origin, quitting = false, dirty = false;
const panels = new Map();
const smoke = process.argv.includes('--smoke-test');
const dataArgument = process.argv.find(value => value.startsWith('--data-dir='));
if (dataArgument) app.setPath('userData', path.resolve(dataArgument.slice(11)));
app.setAppUserModelId('com.waaakong.xiaoyu');
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start).catch(fail);
}

function showWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function allowedSender(event) {
  return mainWindow && event.sender === mainWindow.webContents &&
    new URL(event.senderFrame.url).origin === origin;
}

function state() {
  return { maximized: mainWindow.isMaximized() };
}

function writeEvidence(value) {
  if (smoke) fs.writeFileSync(path.join(app.getPath('userData'), 'electron-smoke.json'),
    JSON.stringify(value, null, 2));
}

async function start() {
  workspace = app.isPackaged ? path.join(app.getPath('userData'), 'workspace') : path.resolve(__dirname, '..');
  if (app.isPackaged) {
    fs.mkdirSync(workspace, { recursive: true });
    const source = path.join(process.resourcesPath, 'backend');
    for (const name of fs.readdirSync(source)) {
      if (name === 'persona.md' && fs.existsSync(path.join(workspace, name))) continue;
      fs.cpSync(path.join(source, name), path.join(workspace, name === 'vendor-modules' ? 'node_modules' : name), { recursive: true });
    }
  }
  const node = app.isPackaged ? path.join(process.resourcesPath, 'runtime', 'node.exe') : process.env.XIAOYU_NODE || 'node';
  const args = [path.join(workspace, 'src', 'gui.js'), '--no-open'];
  if (smoke) args.push('--no-connect');
  const logDirectory = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  const log = fs.createWriteStream(path.join(logDirectory, 'backend.log'), { flags: 'a' });
  backend = spawn(node, args, { cwd: workspace, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  backend.stderr.pipe(log);
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('本机服务启动超时，请查看用户目录中的 logs/backend.log。')), 45000);
    backend.once('error', error => { clearTimeout(timer); reject(error); });
    backend.once('exit', code => { clearTimeout(timer); reject(Error('本机服务提前退出，代码 ' + code)); });
    backend.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message.url); }
    });
  });
  origin = new URL(ready).origin;
  mainWindow = new BrowserWindow({
    title: '小鱼', width: 1320, height: 900, minWidth: 960, minHeight: 650,
    frame: false, show: false, backgroundColor: '#202124',
    icon: path.join(__dirname, '..', 'desktop', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      sandbox: true, nodeIntegration: false }
  });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-state', state()));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-state', state()));
  mainWindow.on('close', event => {
    if (!quitting) { event.preventDefault(); mainWindow.hide(); }
  });
  const icon = path.join(__dirname, '..', 'desktop', 'icon.ico');
  tray = new Tray(icon);
  tray.setToolTip('小鱼 · 陪伴工作台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开小鱼', click: showWindow },
    { type: 'separator' },
    { label: '退出并停止服务', click: requestQuit }
  ]));
  tray.on('double-click', showWindow);
  registerBridge();
  await mainWindow.loadURL(ready);
  showWindow();
  backend.on('message', message => { if (message.type === 'closed' && !quitting) requestQuit(); });
  backend.on('exit', () => { if (!quitting) fail(Error('本机服务已停止，请重新启动小鱼。')); });
  if (smoke) {
    try {
      await mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const end=Date.now()+20000;
        const poll=()=>{if(!document.documentElement.matches('.app-booting,.app-loading'))resolve(true);
        else if(Date.now()>end)reject(Error('UI startup timeout'));else setTimeout(poll,100)};poll();
      })`);
      const result = await mainWindow.webContents.executeJavaScript(`({
        title:document.title,native:window.desktop.native,
        pages:document.querySelectorAll('aside [data-page]').length,
        windowControls:document.querySelectorAll('.window-controls button').length,
        bootFailed:document.documentElement.classList.contains('app-boot-failed')
      })`);
      await mainWindow.webContents.executeJavaScript(`document.querySelector('#skipWizard')?.click()`);
      const screenshot = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(app.getPath('userData'), 'electron-smoke.png'), screenshot.toPNG());
      writeEvidence({ ...result, version: app.getVersion(), packaged: app.isPackaged, workspace });
    } catch (error) { writeEvidence({ error: error.message }); process.exitCode = 1; }
    await requestQuit();
  }
}

function registerBridge() {
  ipcMain.handle('desktop', async (event, action, value) => {
    if (!allowedSender(event)) throw Error('窗口来源无效');
    switch (action) {
      case 'minimize': mainWindow.minimize(); return;
      case 'maximize': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); return;
      case 'close': mainWindow.hide(); return;
      case 'state': mainWindow.webContents.send('window-state', state()); return;
      case 'dirty': dirty = value === true; return;
      case 'theme':
        if (['dark', 'light'].includes(value)) nativeTheme.themeSource = value;
        return;
      case 'plugins': return openPanel('astrbot', 6185);
      case 'service': {
        if (!['snowluma', 'napcat'].includes(value)) throw Error('未知服务');
        const config = JSON.parse(fs.readFileSync(path.join(workspace, 'data', 'services.json'), 'utf8'));
        if (config.protocol !== value) throw Error('请先保存所选协议端配置');
        let port = config.napcatPort || 6099;
        if (value === 'snowluma') {
          port = 5099;
          const file = path.join(config.snowlumaPath, 'config', 'runtime.json');
          if (fs.existsSync(file)) port = JSON.parse(fs.readFileSync(file)).webuiPort || port;
        }
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('端口无效');
        return openPanel(value, port);
      }
      case 'dependency': {
        const urls = {
          edge:'https://www.microsoft.com/edge/download', webview2:'https://developer.microsoft.com/microsoft-edge/webview2/',
          dotnet:'https://dotnet.microsoft.com/download/dotnet-framework', python:'https://www.python.org/downloads/',
          astrbot:'https://docs.astrbot.app/', snowluma:'https://github.com/SnowLuma/SnowLuma/releases',
          napcat:'https://napneko.github.io/', qq:'https://im.qq.com/', codex:'https://openai.com/codex/',
          voice:'https://github.com/RVC-Boss/GPT-SoVITS', speech:'https://github.com/QwenAudio/SenseVoice'
        };
        if (!Object.hasOwn(urls, value)) throw Error('未知依赖');
        return shell.openExternal(urls[value]);
      }
      default: throw Error('未知窗口操作');
    }
  });
}

async function openPanel(kind, port) {
  let window = panels.get(kind);
  if (window && !window.isDestroyed()) { window.show(); window.focus(); return; }
  const target = 'http://127.0.0.1:' + port;
  window = new BrowserWindow({ width: 1180, height: 820, parent: mainWindow,
    title: '小鱼 · ' + kind, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== target) event.preventDefault();
  });
  panels.set(kind, window);
  try { await window.loadURL(target + '/'); }
  catch (error) { window.destroy(); panels.delete(kind); throw Error('管理面板尚未就绪，请先启动服务。'); }
}

async function requestQuit() {
  if (quitting) return;
  if (dirty && !smoke) {
    const answer = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['继续编辑', '退出'],
      defaultId: 0, cancelId: 0, message: '有未保存的设置，是否退出并停止服务？' });
    if (answer.response !== 1) return;
  }
  quitting = true;
  if (backend && backend.exitCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => { backend.kill(); resolve(); }, 10000);
      backend.once('exit', () => { clearTimeout(timer); resolve(); });
      if (backend.connected) backend.send({ type: 'close' });
      else { clearTimeout(timer); backend.kill(); resolve(); }
    });
  }
  tray?.destroy();
  app.quit();
}

function fail(error) {
  if (smoke) writeEvidence({ error: error.message });
  else dialog.showErrorBox('小鱼启动失败', error.message);
  requestQuit();
}
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); requestQuit(); } });
