import { IAkariShardInitDispose } from '@shared/akari-shard/interface'
import { GameClientHttpApiAxiosHelper } from '@shared/http-api-axios-helper/game-client'
import axios from 'axios'
import cp from 'child_process'
import https from 'https'

import toolkit from '../../native/laToolkitWin32x64.node'
import { AkariIpcMain } from '../ipc'
import { KeyboardShortcutsMain } from '../keyboard-shortcuts'
import { LeagueClientMain } from '../league-client'
import { AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { SettingFactoryMain } from '../setting-factory'
import { SetterSettingService } from '../setting-factory/setter-setting-service'
import { SgpMain } from '../sgp'
import { GameClientSettings } from './state'

export interface LaunchSpectatorConfig {
  locale?: string
  region: string
  puuid: string
}

/**
 * 处理游戏端相关的功能
 */
export class GameClientMain implements IAkariShardInitDispose {
  static id = 'game-client-main'
  static dependencies = [
    'akari-ipc-main',
    'logger-factory-main',
    'setting-factory-main',
    'sgp-main',
    'league-client-main',
    'mobx-utils-main',
    'keyboard-shortcuts-main'
  ]

  static GAME_CLIENT_PROCESS_NAME = 'League of Legends.exe'
  static TERMINATE_DELAY = 200
  static GAME_CLIENT_BASE_URL = 'https://127.0.0.1:2999'

  private readonly _ipc: AkariIpcMain
  private readonly _loggerFactory: LoggerFactoryMain
  private readonly _settingFactory: SettingFactoryMain
  private readonly _log: AkariLogger
  private readonly _setting: SetterSettingService
  private readonly _sgp: SgpMain
  private readonly _lc: LeagueClientMain
  private readonly _kbd: KeyboardShortcutsMain
  private readonly _mobx: MobxUtilsMain

  private readonly _http = axios.create({
    baseURL: GameClientMain.GAME_CLIENT_BASE_URL,
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
      maxFreeSockets: 1024,
      maxCachedSessions: 2048
    })
  })
  private readonly _api: GameClientHttpApiAxiosHelper

  public readonly settings = new GameClientSettings()

  constructor(deps: any) {
    this._ipc = deps['akari-ipc-main']
    this._loggerFactory = deps['logger-factory-main']
    this._log = this._loggerFactory.create(GameClientMain.id)
    this._settingFactory = deps['setting-factory-main']
    this._api = new GameClientHttpApiAxiosHelper(this._http)
    this._sgp = deps['sgp-main']
    this._lc = deps['league-client-main']
    this._kbd = deps['keyboard-shortcuts-main']
    this._mobx = deps['mobx-utils-main']

    this._setting = this._settingFactory.create(
      GameClientMain.id,
      {
        terminateGameClientOnAltF4: { default: this.settings.terminateGameClientOnAltF4 }
      },
      this.settings
    )
  }

  get http() {
    return this._http
  }

  get api() {
    return this._api
  }

  async onInit() {
    await this._setting.applyToState()
    this._mobx.propSync(GameClientMain.id, 'settings', this.settings, [
      'terminateGameClientOnAltF4'
    ])
    this._handleIpcCall()
    this._handleTerminateGameClientOnAltF4()
  }

  private _handleTerminateGameClientOnAltF4() {
    // 松手时触发, 而非按下时触发
    this._kbd.events.on('last-active-shortcut', ({ id }) => {
      if (this.settings.terminateGameClientOnAltF4) {
        if (id === 'LeftAlt+F4' || id === 'RightAlt+F4') {
          this._terminateGameClient()
        }
      }
    })
  }

  private _handleIpcCall() {
    this._ipc.onCall(GameClientMain.id, 'terminateGameClient', () => {
      this._terminateGameClient()
    })

    this._ipc.onCall(GameClientMain.id, 'launchSpectator', (config: LaunchSpectatorConfig) => {
      this.launchSpectator(config)
    })
  }

  private _terminateGameClient() {
    toolkit.getPidsByName(GameClientMain.GAME_CLIENT_PROCESS_NAME).forEach((pid) => {
      if (!toolkit.isProcessForeground(pid)) {
        return
      }

      this._log.info(`终止游戏客户端进程 ${pid}`)

      // 这里设置 200 ms，用于使客户端消耗 Alt+F4 事件，避免穿透
      setTimeout(() => {
        toolkit.terminateProcess(pid)
      }, GameClientMain.TERMINATE_DELAY)
    })
  }

  async launchSpectator(config: LaunchSpectatorConfig) {
    const {
      game: { gameMode },
      playerCredentials: { observerServerIp, observerServerPort, observerEncryptionKey, gameId }
    } = await this._sgp.getSpectatorGameflow(config.puuid, config.region)

    if (!this.http) {
      throw new Error('LCU not connected')
    }

    const { data: installDir } = await this._lc.http.get<{
      gameExecutablePath: string
      gameInstallRoot: string
    }>('/lol-patch/v1/products/league_of_legends/install-location')

    const cmds = [
      `spectator ${observerServerIp}:${observerServerPort} ${observerEncryptionKey} ${gameId} ${config.region}`,
      `-GameBaseDir=${installDir.gameInstallRoot}`,
      `-Locale=${config.locale || 'zh-CN'}`
    ]

    if (gameMode === 'TFT') {
      cmds.push('-Product=TFT')
    }

    // 调起进程但不与其关联
    const p = cp.spawn(installDir.gameExecutablePath, cmds, {
      cwd: installDir.gameInstallRoot,
      detached: true
    })

    p.unref()
  }
}