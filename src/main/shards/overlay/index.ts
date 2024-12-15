import { is } from '@electron-toolkit/utils'
import { IAkariShardInitDispose } from '@shared/akari-shard/interface'
import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { Overlay } from '@leaguetavern/electron-overlay-win'
import { SHARED_GLOBAL_ID } from '@shared/akari-shard/manager'

import icon from '../../../../resources/LA_ICON.ico?asset'
import { AkariLogger } from '../logger-factory'
import { GameClientMain } from '../game-client'
import { KeyboardShortcutsMain } from '../keyboard-shortcuts'

export class OverlayMain implements IAkariShardInitDispose {
  static id = 'overlay-main'
  static OVERLAY_WINDOW_PARTITION = 'persist:persist:overlay-window'
  static dependencies = [
    SHARED_GLOBAL_ID,
    'logger-factory-main',
    'keyboard-shortcuts-main'
  ]

  private readonly _log: AkariLogger
  private _kbd: KeyboardShortcutsMain
  private _timer: NodeJS.Timeout;

  private _window: BrowserWindow | null = null
  private _inst: Overlay = new Overlay()
  private visible: boolean = false

  constructor(deps: any) {
    this._log = deps['logger-factory-main'].create(OverlayMain.id)
    this._kbd = deps['keyboard-shortcuts-main']
  }

  async onInit() {
    this._create()
    this._initShortCuts()
    this._timer = setInterval(()=>{
      if (!GameClientMain.isGameClientForeground() && this.visible) {
        this.hide()
      }
    }, 300)
  }

  private _create() {
    this._window = new BrowserWindow({
      height: 860,
      width: 1500,
      // fullscreen: true,
      resizable: false,
      frame: false,
      title: 'Akari Overlay',
      autoHideMenuBar: true,
      maximizable: false,
      minimizable: false,
      show: false,
      icon,
      focusable: false,
      skipTaskbar: true,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        spellcheck: false,
        backgroundThrottling: false,
        partition: OverlayMain.OVERLAY_WINDOW_PARTITION
      }
    })

    this._window.removeMenu();

    this._window.on('page-title-updated', (e) => e.preventDefault())

    this._window.webContents.on('did-finish-load', () => {
      this._window?.webContents.setZoomFactor(1.0)
    })

    this._window.webContents.on('before-input-event', (event, input) => {
      event.preventDefault()
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      this._window?.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/main-window.html#ongoing-game/overlay`)
    } else {
      this._window?.loadFile(join(__dirname, `../renderer/main-window.html`),{
        hash: 'ongoing-game/overlay', 
      })
    }

    if (!this._inst.enable(this._window.getNativeWindowHandle()).res)
      this._window?.close();
  }
  
  private _initShortCuts() {
    this._kbd.register(`${OverlayMain.id}/visible`, 'LeftControl+X', 'normal', () => {
      if (this._window && GameClientMain.isGameClientForeground()) {
        this.visible ? this.hide() : this.show()
      }
    })
  }

  private _toggleClickThrough(value: boolean) {
    if (value) {
      this._window?.setIgnoreMouseEvents(true, { forward: true });
    } else {
      this._window?.setIgnoreMouseEvents(false);
    }
  }

  create() {
    if (!this._window || this._window.isDestroyed()) {
      this._create()
    }
  }

  close() {
    this._window?.close()
  }

  show() {
    if (this._window && !this.visible) {
      this._window?.show()
      this.visible = true
    }
  }

  hide() {
    if (this._window  && this.visible) {
      this._window?.hide()
      this.visible = false
    }
  }

  toggleDevTools() {
    this._window?.webContents.toggleDevTools()
  }
}
