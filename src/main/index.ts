import { app, BrowserWindow, ipcMain, Menu, screen, clipboard } from 'electron'
import { join } from 'node:path'
import { runScan, buildDisabledServersSnippet } from './realScan'

// .handle itself is 52px wide; the extra 12px here is deliberate slack so
// .handle:hover's translateX(-5px) has room to slide left without clipping
// the handle's own left border against the window's edge.
const HANDLE_WIDTH = 64
const PANEL_WIDTH = 460
// The window's height (and therefore its vertical position) never changes —
// only width does. Toggling both height and width made the resize animation
// recenter vertically (top edge sliding up, bottom edge sliding down) on top
// of the intended horizontal slide. Keeping height constant makes the native
// resize animation purely left-right; the handle still renders vertically
// centered inside this taller window via .app-shell's flex centering.
const WINDOW_HEIGHT = 660

let win: BrowserWindow | null = null

function boundsFor(width: number) {
  const display = screen.getPrimaryDisplay()
  const { x, y, width: screenWidth, height: screenHeight } = display.workArea
  return {
    x: x + screenWidth - width,
    y: y + Math.round((screenHeight - WINDOW_HEIGHT) / 2),
    width,
    height: WINDOW_HEIGHT
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...boundsFor(HANDLE_WIDTH),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    hasShadow: false,
    skipTaskbar: true,
    show: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('window:set-expanded', (_event, expanded: boolean) => {
  if (!win) return
  // animate:true gives a native, smooth frame resize on macOS instead of an
  // instant snap between the handle and panel widths.
  win.setBounds(boundsFor(expanded ? PANEL_WIDTH : HANDLE_WIDTH), true)
})

ipcMain.handle('clipboard:write', (_event, text: string) => {
  clipboard.writeText(text)
})

ipcMain.handle('scan:run', (_event, sinceDays: number) => {
  return runScan(sinceDays)
})

ipcMain.handle('scan:snippet', (_event, flaggedServerIds: string[]) => {
  return buildDisabledServersSnippet(flaggedServerIds)
})

// Quitting the app (as opposed to closing the drawer, which is just
// collapsing back to the idle handle — handled entirely in the renderer) —
// right-click anywhere on the drawer for this.
ipcMain.handle('window:context-menu', () => {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Quit Tool Diet Audit',
      accelerator: 'Cmd+Q',
      click: () => app.quit()
    }
  ])
  menu.popup(win ? { window: win } : undefined)
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
