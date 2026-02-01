/**
 * 原紙箱プラグイン
 * 原紙ファイルを仮身形式で一覧表示し、ドラッグ&ドロップでコピー配置を実現
 * @module BaseFileManager
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('BaseFileManager');

class BaseFileManager extends window.PluginBase {
    constructor() {
        super('BaseFileManager');

        this.userBaseFiles = [];    // ユーザ原紙リスト
        this.systemBaseFiles = [];  // システム原紙リスト
        this.displayFilter = 'all'; // フィルタ状態: 'all' | 'user' | 'system'
        this.pluginConfig = null;
        this.fileData = null; // ファイルデータ
        this.isFullscreen = false; // 全画面表示フラグ
        this.iconCache = new Map(); // アイコンキャッシュ (realId -> base64)
        this.isLoadingBaseFiles = false; // 原紙ファイル読み込み中フラグ（二重呼び出し防止）

        // MessageBusはPluginBaseで初期化済み

        this.init();
    }

    init() {
        // VirtualObjectRendererの初期化（PluginBase共通）
        this.initializeCommonComponents('[BaseFileManager]');

        // 親ウィンドウからのメッセージを受信
        this.setupMessageHandler();

        // ウィンドウアクティベーション（PluginBase共通）
        this.setupWindowActivation();

        // 右クリックメニュー（PluginBase共通）
        this.setupContextMenu();

        // キーボードショートカット
        this.setupKeyboardShortcuts();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();
    }

    setupMessageHandler() {
        // MessageBusのハンドラを登録
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        } else {
            logger.error('[BaseFileManager] MessageBus not available - cannot setup message handlers');
        }
    }

    /**
     * MessageBusのハンドラを登録
     * 親ウィンドウからのメッセージを受信して処理
     */
    setupMessageBusHandlers() {
        // PluginBase共通ハンドラを登録（plugin-readyシグナル送信含む）
        this.setupCommonMessageBusHandlers();

        // init メッセージ
        this.messageBus.on('init', async (data) => {
            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);

            // fileDataを保存
            if (data.fileData) {
                this.fileData = data.fileData;
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/, '') : null;
            }

            // 背景色を適用してファイルを読み込む
            this.applyBackgroundColor();
            await this.loadBaseFiles();
        });

        // window-moved, window-resized-end, window-maximize-toggled,
        // get-menu-definition, menu-action はsetupCommonMessageBusHandlers()で登録済み

        // custom-dialog-response メッセージ (MessageBusが自動処理)
        this.messageBus.on('custom-dialog-response', () => {
            // sendWithCallback使用時は自動的にコールバックが実行される
        });

        // input-dialog-response メッセージ (MessageBusが自動処理)
        this.messageBus.on('input-dialog-response', () => {
            // sendWithCallback使用時は自動的にコールバックが実行される
        });
    }

    getMenuDefinition() {
        // フィルタ状態に応じてチェックマークを表示
        const userMark = this.displayFilter === 'user' ? '● ' : '  ';
        const systemMark = this.displayFilter === 'system' ? '● ' : '  ';
        const allMark = this.displayFilter === 'all' ? '● ' : '  ';

        return [
            {
                text: '表示',
                submenu: [
                    { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
                    { text: '背景色変更', action: 'change-bg-color' },
                    { separator: true },
                    { text: `${userMark}ユーザ原紙のみ`, action: 'filter-user' },
                    { text: `${systemMark}システム原紙のみ`, action: 'filter-system' },
                    { text: `${allMark}すべて`, action: 'filter-all' }
                ]
            },
            {
                text: '編集',
                submenu: [
                    { text: '再読込', action: 'reload' }
                ]
            }
        ];
    }

    executeMenuAction(action) {
        switch (action) {
            case 'reload':
                this.loadBaseFiles();
                break;
            case 'close':
                this.requestCloseWindow();
                break;
            case 'change-bg-color':
                this.changeBgColor();
                break;
            case 'toggle-fullscreen':
                this.toggleFullscreenWithState();
                break;
            case 'filter-user':
                this.displayFilter = 'user';
                this.renderBaseFiles();
                break;
            case 'filter-system':
                this.displayFilter = 'system';
                this.renderBaseFiles();
                break;
            case 'filter-all':
                this.displayFilter = 'all';
                this.renderBaseFiles();
                break;
            default:
                logger.warn('[BaseFileManager] 未知のアクション:', action);
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+E: ウィンドウを閉じる
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.executeMenuAction('close');
                return;
            }

            // Ctrl+L: 全画面表示切り替え
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.executeMenuAction('toggle-fullscreen');
                return;
            }
        });
    }

    requestCloseWindow() {
        this.messageBus.send('close-window', {
            windowId: this.windowId
        });
    }

    /**
     * 原紙ファイルを読み込む
     * システム原紙: プラグインの type="base" で basefile が指定されているもの
     * ユーザ原紙: 原紙箱のXTAD内の<link>要素
     */
    async loadBaseFiles() {
        // 二重呼び出し防止（initメッセージが複数回来た場合の対策）
        if (this.isLoadingBaseFiles) {
            return;
        }
        this.isLoadingBaseFiles = true;

        try {
            // 1. システム原紙を読み込み
            this.messageBus.send('request-base-plugins');
            const response = await this.messageBus.waitFor('base-plugins-response', window.DEFAULT_TIMEOUT_MS);

            if (response && response.plugins) {
                await this.loadAndDisplaySystemBaseFiles(response.plugins);
            } else {
                logger.warn('[BaseFileManager] 原紙プラグインが見つかりません');
                this.systemBaseFiles = [];
            }

            // 2. ユーザ原紙を読み込み
            await this.loadUserBaseFiles();

            // 3. 表示
            this.renderBaseFiles();

        } catch (error) {
            logger.error('[BaseFileManager] 原紙ファイル読み込みエラー:', error);
        } finally {
            this.isLoadingBaseFiles = false;
        }
    }


    /**
     * システム原紙ファイルを読み込む
     * プラグインの type="base" で basefile が指定されているものを対象
     */
    async loadAndDisplaySystemBaseFiles(plugins) {
        this.systemBaseFiles = [];

        for (const plugin of plugins) {
            if (plugin.type === 'base' && plugin.basefile) {
                // basefileがオブジェクトの場合はxmltadプロパティを、文字列の場合はそのまま使用
                const basefileName = typeof plugin.basefile === 'object'
                    ? plugin.basefile.xmltad
                    : plugin.basefile;

                try {
                    // 原紙ファイルのパスを構築（相対パス）
                    const basefilePath = `../../plugins/${plugin.id}/${basefileName}`;

                    // ファイルを読み込む
                    const response = await fetch(basefilePath);
                    if (!response.ok) {
                        logger.warn(`[BaseFileManager] ファイルが見つかりません: ${basefilePath}`);
                        continue;
                    }

                    const arrayBuffer = await response.arrayBuffer();
                    const uint8Array = new Uint8Array(arrayBuffer);

                    // XMLに変換
                    const xmlData = await this.convertToXML(uint8Array);

                    if (xmlData) {
                        // <tad>タグのfilename属性を取得
                        const filenameMatch = xmlData.match(/<tad[^>]+filename="([^"]*)"/i);
                        const displayName = filenameMatch ? filenameMatch[1] : plugin.name;

                        // realIdとiconFileを取得
                        let realId = null;
                        let iconFile = null;
                        if (typeof plugin.basefile === 'object') {
                            // jsonファイル名から実身IDを抽出
                            if (plugin.basefile.json) {
                                realId = plugin.basefile.json.replace(/\.json$/, '');
                            }
                            iconFile = plugin.basefile.ico || null;
                        }

                        this.systemBaseFiles.push({
                            type: 'system',
                            pluginId: plugin.id,
                            pluginName: plugin.name,
                            displayName: displayName,
                            basefile: plugin.basefile,
                            realId: realId,
                            iconFile: iconFile,
                            xmlData: xmlData,
                            rawData: uint8Array
                        });
                    }

                } catch (error) {
                    logger.error(`[BaseFileManager] ファイル読み込みエラー (${plugin.name}):`, error);
                }
            }
        }
    }

    /**
     * ユーザ原紙を読み込む
     * 原紙箱のXTAD内の<link>要素から読み込み
     */
    async loadUserBaseFiles() {
        this.userBaseFiles = [];

        // fileDataにxmlDataがない場合はスキップ
        if (!this.fileData || !this.fileData.xmlData) {
            return;
        }

        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(this.fileData.xmlData, 'text/xml');
            const linkElements = xmlDoc.getElementsByTagName('link');

            for (const link of linkElements) {
                const linkId = link.getAttribute('id');
                if (!linkId) continue;

                // 実身IDを抽出（_0.xtad を除去）
                const realId = linkId.replace(/_\d+\.xtad$/, '');

                // PluginBase共通メソッドで仮身属性を読み込む
                const linkAttributes = this.parseLinkElement(link);
                const displayName = linkAttributes?.link_name || link.textContent.trim() || '無題';

                // メタデータを読み込み
                const metadata = await this.loadRealObjectMetadata(realId);

                this.userBaseFiles.push({
                    type: 'user',
                    realId: realId,
                    displayName: metadata?.name || displayName,
                    iconFile: null,
                    metadata: metadata,
                    linkAttributes: linkAttributes  // 仮身属性を保存
                });
            }
        } catch (error) {
            logger.error('[BaseFileManager] ユーザ原紙読み込みエラー:', error);
        }
    }

    /**
     * 実身のメタデータを読み込む
     * @param {string} realId - 実身ID
     * @returns {Promise<Object|null>} メタデータ、または読み込み失敗時はnull
     */
    async loadRealObjectMetadata(realId) {
        try {
            const jsonFileName = `${realId}.json`;

            // HTTP fetchでJSONファイルを読み込む（iframe内なのでfetchを使用）
            // プラグインは resources/app/plugins/base-file-manager/ にあり、
            // データは ../../../../data/ にある
            const urlsToTry = [
                `../../../../data/${jsonFileName}`,
                `../../../../${jsonFileName}`
            ];

            for (const url of urlsToTry) {
                try {
                    const response = await fetch(url);
                    if (response.ok) {
                        return await response.json();
                    }
                } catch (e) {
                    // 次のURLを試す
                }
            }

            return null;
        } catch (error) {
            logger.warn('[BaseFileManager] メタデータ読み込み失敗:', realId, error);
            return null;
        }
    }

    /**
     * TADデータをXMLに変換
     */
    async convertToXML(rawData) {
        // すでにXML形式かチェック（先頭が'<'ならXMLテキスト）
        const textDecoder = new TextDecoder('utf-8');
        const firstChar = textDecoder.decode(rawData.slice(0, 1));

        if (firstChar === '<') {
            // すでにXML形式なのでそのまま文字列として返す
            const xmlText = textDecoder.decode(rawData);
            return xmlText;
        }

        // TADバイナリ形式の場合はparsTADToXMLで変換
        if (window.parent && typeof window.parent.parseTADToXML === 'function') {
            try {
                const xmlResult = await window.parent.parseTADToXML(rawData, 0);
                return xmlResult;
            } catch (error) {
                logger.error('[BaseFileManager] XML変換エラー:', error);
                return null;
            }
        }
        logger.warn('[BaseFileManager] parseTADToXML関数が見つかりません');
        return null;
    }

    /**
     * 原紙ファイルを仮身形式で表示
     * displayFilterに応じてユーザ原紙/システム原紙を表示
     */
    renderBaseFiles() {
        const listElement = document.getElementById('baseFileList');
        if (!listElement) return;

        listElement.innerHTML = '';

        // フィルタに応じて表示対象を決定（ユーザ原紙が先、システム原紙が後）
        let filesToDisplay = [];
        if (this.displayFilter === 'all' || this.displayFilter === 'user') {
            filesToDisplay = filesToDisplay.concat(this.userBaseFiles);
        }
        if (this.displayFilter === 'all' || this.displayFilter === 'system') {
            filesToDisplay = filesToDisplay.concat(this.systemBaseFiles);
        }

        if (filesToDisplay.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.className = 'empty-message';
            emptyMessage.textContent = '原紙ファイルがありません';
            listElement.appendChild(emptyMessage);
            // スクロールバー更新を通知
            this.notifyScrollChange();
            return;
        }

        // 各原紙ファイルを仮身として表示
        filesToDisplay.forEach((baseFile, index) => {
            const vobjElement = this.createVirtualObject(baseFile, index);
            listElement.appendChild(vobjElement);
        });

        // スクロールバー更新を通知
        this.notifyScrollChange();
    }

    /**
     * 仮身要素を作成
     */
    createVirtualObject(baseFile, index) {
        // メニュー文字サイズを取得（ポイント値）
        const menuFontSize = localStorage.getItem('menu-font-size') || '14';
        const chsz = parseFloat(menuFontSize);

        // ピクセル値に変換（フォールバック用）
        const chszPx = window.convertPtToPx ? window.convertPtToPx(chsz) : Math.round(chsz * 1.333);

        // VirtualObjectRendererを使用する場合
        if (this.virtualObjectRenderer && baseFile.realId) {
            // ユーザ原紙の場合は仮身属性を使用、なければデフォルト値
            const attrs = baseFile.linkAttributes || {};

            // 仮身オブジェクトを作成
            const virtualObject = {
                link_id: `${baseFile.realId}_0.xtad`,
                link_name: baseFile.displayName,
                chsz: attrs.chsz || chsz,  // 仮身属性優先、なければメニュー文字サイズ
                frcol: attrs.frcol || DEFAULT_FRCOL,
                chcol: attrs.chcol || DEFAULT_CHCOL,
                tbcol: attrs.tbcol || DEFAULT_TBCOL,
                bgcol: attrs.bgcol || DEFAULT_BGCOL,
                pictdisp: attrs.pictdisp || 'true',
                namedisp: attrs.namedisp || 'true',
                roledisp: attrs.roledisp || 'false',
                typedisp: attrs.typedisp || 'false',
                updatedisp: attrs.updatedisp || 'false',
                framedisp: attrs.framedisp || 'true',
                autoopen: attrs.autoopen || 'false'
            };

            // VirtualObjectRendererでインライン要素を作成
            const vobj = this.virtualObjectRenderer.createInlineElement(virtualObject, {
                loadIconCallback: (realId) => this.loadIcon(realId, baseFile)
            });

            vobj.className = 'base-file-vobj';
            vobj.dataset.index = index;
            vobj.draggable = true;
            vobj.style.margin = '8px';
            vobj.style.cursor = 'move';

            // ドラッグ開始イベント
            vobj.addEventListener('dragstart', (e) => {
                this.handleDragStart(e, baseFile, index);
            });

            // ドラッグ終了イベント
            vobj.addEventListener('dragend', (e) => {
                this.handleDragEnd(e);
            });

            // ダブルクリックイベント（開く）
            vobj.addEventListener('dblclick', () => {
                this.openBaseFile(baseFile);
            });

            return vobj;
        }

        // フォールバック：VirtualObjectRendererが利用できない場合
        const vobj = document.createElement('div');
        vobj.className = 'base-file-vobj';
        vobj.dataset.index = index;
        vobj.draggable = true;

        // 仮身枠
        vobj.style.border = `1px solid ${DEFAULT_FRCOL}`;
        vobj.style.backgroundColor = DEFAULT_BGCOL;
        vobj.style.padding = '4px 8px';
        vobj.style.margin = '8px';
        vobj.style.cursor = 'move';
        vobj.style.display = 'inline-block';
        vobj.style.minWidth = '150px';
        vobj.style.textAlign = 'center';

        // タイトル
        const title = document.createElement('span');
        title.className = 'base-file-title';
        title.textContent = baseFile.displayName;
        title.style.fontSize = chszPx + 'px';  // ピクセル値を使用
        title.style.color = DEFAULT_CHCOL;

        vobj.appendChild(title);

        // ドラッグ開始イベント
        vobj.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, baseFile, index);
        });

        // ドラッグ終了イベント
        vobj.addEventListener('dragend', (e) => {
            this.handleDragEnd(e);
        });

        // ダブルクリックイベント（開く）
        vobj.addEventListener('dblclick', () => {
            this.openBaseFile(baseFile);
        });

        return vobj;
    }

    /**
     * アイコンを読み込む
     */
    async loadIcon(realId, baseFile) {
        // キャッシュにあればそれを返す
        if (this.iconCache.has(realId)) {
            return this.iconCache.get(realId);
        }

        try {
            let iconPath = null;

            if (baseFile.type === 'user') {
                // ユーザ原紙: 実身IDからアイコンファイルパスを構築
                // プラグインは resources/app/plugins/base-file-manager/ にあり、
                // データは ../../../../data/ にある
                iconPath = `../../../../data/${realId}.ico`;
            } else if (baseFile.iconFile && baseFile.pluginId) {
                // システム原紙: プラグインフォルダ内のアイコン
                iconPath = `../../plugins/${baseFile.pluginId}/${baseFile.iconFile}`;
            }

            if (!iconPath) {
                return null;
            }

            // アイコンファイルを読み込む
            const response = await fetch(iconPath);
            if (!response.ok) {
                return null;
            }

            // バイナリデータを取得
            const arrayBuffer = await response.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            // Base64に変換
            let binary = '';
            for (let i = 0; i < uint8Array.byteLength; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);

            // キャッシュに保存
            this.iconCache.set(realId, base64);

            return base64;
        } catch (error) {
            logger.error('[BaseFileManager] アイコン読み込みエラー:', realId, error);
            return null;
        }
    }

    /**
     * ドラッグ開始処理
     */
    handleDragStart(event, baseFile, index) {
        // ドラッグデータを設定（コピー用）
        let dragData;

        if (baseFile.type === 'user') {
            // ユーザ原紙: 実身IDベースのドラッグデータ
            dragData = {
                type: 'user-base-file-copy',
                source: 'base-file-manager',
                baseFile: {
                    type: 'user',
                    realId: baseFile.realId,
                    displayName: baseFile.displayName,
                    linkAttributes: baseFile.linkAttributes || null  // 仮身属性を追加
                }
            };
        } else {
            // システム原紙: 従来のドラッグデータ
            dragData = {
                type: 'base-file-copy',
                source: 'base-file-manager',
                baseFile: {
                    type: 'system',
                    pluginId: baseFile.pluginId,
                    pluginName: baseFile.pluginName,
                    displayName: baseFile.displayName,
                    basefile: baseFile.basefile,
                    xmlData: baseFile.xmlData
                }
            };
        }

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';

        // ドラッグ中のスタイル
        event.target.style.opacity = '0.5';
    }

    /**
     * ドラッグ終了処理
     */
    handleDragEnd(event) {
        // スタイルを元に戻す
        event.target.style.opacity = '1';
    }

    /**
     * 原紙ファイルを開く
     */
    openBaseFile(baseFile) {
        if (baseFile.type === 'user') {
            // ユーザ原紙: 実身IDで開く
            this.messageBus.send('open-real-object', {
                realId: baseFile.realId,
                displayName: baseFile.displayName
            });
        } else {
            // システム原紙: プラグイン経由で開く
            this.messageBus.send('open-base-file', {
                pluginId: baseFile.pluginId,
                basefile: baseFile.basefile,
                displayName: baseFile.displayName
            });
        }
    }

    /**
     * 背景色を適用
     */
    applyBackgroundColor() {
        if (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor) {
            // DOM要素が生成されるまで待機
            setTimeout(() => {
                const container = document.querySelector('.manager-container');
                const list = document.querySelector('.base-file-list');
                const bgColor = this.fileData.windowConfig.backgroundColor;

                if (container) {
                    container.style.background = bgColor;
                }
                if (list) {
                    list.style.background = bgColor;
                } else {
                    logger.warn('[BaseFileManager] .base-file-list 要素が見つかりません');
                }
            }, 100);
        }
    }

    /**
     * 背景色変更ダイアログを表示
     */
    async changeBgColor() {
        // 現在の背景色を取得
        const currentBgColor = (this.fileData && this.fileData.windowConfig && this.fileData.windowConfig.backgroundColor)
            ? this.fileData.windowConfig.backgroundColor
            : DEFAULT_BGCOL;

        // ダイアログのHTML要素を作成
        const dialogHtml = `
            <div style="margin-bottom: 10px;">ウインドウ背景色を選択してください。</div>
            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 5px;">#FFFFFF形式で入力：</label>
                <input type="text" id="bgColorInput" placeholder="#FFFFFF" value="${currentBgColor}"
                       style="width: 100%; padding: 5px; box-sizing: border-box;">
            </div>
        `;

        const result = await this.showCustomDialog({
            dialogHtml: dialogHtml,
            buttons: [
                { label: '取消', value: 'cancel' },
                { label: '設定', value: 'ok' }
            ],
            defaultButton: 1,
            inputs: {
                text: 'bgColorInput'
            }
        });

        if (result && result.button === 'ok') {
            const inputColor = result.input;

            // 入力された色を検証
            if (/^#[0-9A-Fa-f]{6}$/.test(inputColor)) {
                const newBgColor = inputColor;

                // コンテナと一覧の背景色を変更
                const container = document.querySelector('.manager-container');
                const list = document.querySelector('.base-file-list');
                if (container) {
                    container.style.background = newBgColor;
                }
                if (list) {
                    list.style.background = newBgColor;
                } else {
                    logger.error('[BaseFileManager] .base-file-listが見つかりません');
                }

                // 実身管理用セグメントのbackgroundColorを更新
                if (this.realId) {
                    this.messageBus.send('update-background-color', {
                        fileId: this.realId,
                        backgroundColor: newBgColor
                    });
                }

                // this.fileDataを更新（再表示時に正しい色を適用するため）
                if (!this.fileData) {
                    this.fileData = {};
                }
                if (!this.fileData.windowConfig) {
                    this.fileData.windowConfig = {};
                }
                this.fileData.windowConfig.backgroundColor = newBgColor;
            } else {
                logger.warn('[BaseFileManager] 無効な色形式:', inputColor);
            }
        }

        return result;
    }

    /**
     * 全画面表示を切り替え（状態管理付き）
     */
    toggleFullscreenWithState() {
        // PluginBase共通のtoggleFullscreen()を使用
        this.toggleFullscreen();

        this.isFullscreen = !this.isFullscreen;

        // 実身管理用セグメントのfullscreenフラグを更新
        if (this.realId) {
            this.messageBus.send('update-fullscreen-state', {
                fileId: this.realId,
                isFullscreen: this.isFullscreen
            });
        }
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.baseFileManager = new BaseFileManager();
});
