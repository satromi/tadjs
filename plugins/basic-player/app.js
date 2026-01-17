/**
 * 基本動画再生プラグイン
 * 実時間制御xmlTADの映像・音声データを再生する
 * 
 * @module BasicPlayer
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */

// ============================================================
// RealtimeTadParser - 実時間制御xmlTADパーサー
// ============================================================
class RealtimeTadParser {
    /**
     * xmlTADをパースして実時間データを抽出
     * @param {string} xmlString - xmlTAD文字列
     * @returns {Object} パース結果
     */
    parse(xmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');

        // パースエラーチェック
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.warn('[PlayerApp] XMLパースエラー:', parseError.textContent);
            return { type: 'none', media: [] };
        }

        const realtimeEl = doc.querySelector('realtime');
        if (!realtimeEl) {
            return { type: 'none', media: [] };
        }

        return {
            type: 'realtime',
            autoplay: realtimeEl.getAttribute('autoplay') === 'true',
            preload: realtimeEl.getAttribute('preload') || 'metadata',
            loop: realtimeEl.getAttribute('loop') === 'true',
            realData: this._parseRealData(realtimeEl),
            media: this._extractAllMedia(realtimeEl)
        };
    }

    /**
     * realDataブロックをパース
     */
    _parseRealData(realtimeEl) {
        const realDataEls = realtimeEl.querySelectorAll('realData');
        return Array.from(realDataEls).map(el => ({
            autoplay: el.getAttribute('autoplay') || 'inherit',
            startDelay: parseInt(el.getAttribute('startDelay') || '0', 10),
            loop: el.getAttribute('loop') === 'true',
            loopCount: parseInt(el.getAttribute('loopCount') || '0', 10)
        }));
    }

    /**
     * 全メディア要素を抽出
     */
    _extractAllMedia(realtimeEl) {
        const media = [];

        // <video>要素
        realtimeEl.querySelectorAll('video').forEach(el => {
            media.push(this._parseVideoElement(el));
        });

        // <audio>要素
        realtimeEl.querySelectorAll('audio').forEach(el => {
            media.push(this._parseAudioElement(el));
        });

        return media;
    }

    /**
     * video要素をパース
     */
    _parseVideoElement(el) {
        return {
            type: 'video',
            id: el.getAttribute('id') || `video-${Date.now()}`,
            href: el.getAttribute('href'),
            format: el.getAttribute('format'),
            autoplay: el.getAttribute('autoplay') !== 'false',
            preload: el.getAttribute('preload') || 'auto',
            trigger: el.getAttribute('trigger') || 'time',
            poster: el.getAttribute('poster'),
            volume: parseFloat(el.getAttribute('volume') || '1.0'),
            playbackRate: parseFloat(el.getAttribute('playbackRate') || '1.0'),
            startTime: parseFloat(el.getAttribute('startTime') || '0'),
            duration: parseFloat(el.getAttribute('duration') || '0'),
            loop: el.getAttribute('loop') === 'true',
            loopStart: parseFloat(el.getAttribute('loopStart') || '0'),
            loopEnd: parseFloat(el.getAttribute('loopEnd') || '0'),
            muted: el.getAttribute('muted') === 'true',
            // 配置属性
            left: parseInt(el.getAttribute('left') || '0', 10),
            top: parseInt(el.getAttribute('top') || '0', 10),
            right: parseInt(el.getAttribute('right') || '0', 10),
            bottom: parseInt(el.getAttribute('bottom') || '0', 10),
            alpha: parseFloat(el.getAttribute('alpha') || '1.0'),
            zIndex: parseInt(el.getAttribute('zIndex') || '0', 10)
        };
    }

    /**
     * audio要素をパース
     */
    _parseAudioElement(el) {
        return {
            type: 'audio',
            id: el.getAttribute('id') || `audio-${Date.now()}`,
            href: el.getAttribute('href'),
            format: el.getAttribute('format'),
            autoplay: el.getAttribute('autoplay') !== 'false',
            preload: el.getAttribute('preload') || 'auto',
            trigger: el.getAttribute('trigger') || 'time',
            volume: parseFloat(el.getAttribute('volume') || '1.0'),
            pan: parseFloat(el.getAttribute('pan') || '0.0'),
            playbackRate: parseFloat(el.getAttribute('playbackRate') || '1.0'),
            startTime: parseFloat(el.getAttribute('startTime') || '0'),
            duration: parseFloat(el.getAttribute('duration') || '0'),
            loop: el.getAttribute('loop') === 'true',
            loopStart: parseFloat(el.getAttribute('loopStart') || '0'),
            loopEnd: parseFloat(el.getAttribute('loopEnd') || '0'),
            fadeIn: parseFloat(el.getAttribute('fadeIn') || '0'),
            fadeOut: parseFloat(el.getAttribute('fadeOut') || '0')
        };
    }
}

// ============================================================
// MediaElementManager - HTMLメディア要素管理
// ============================================================
class MediaElementManager {
    constructor(container, plugin) {
        this.container = container;
        this.plugin = plugin; // PlayerAppインスタンス（getImageFilePathを使用するため）
        this.elements = new Map(); // id => HTMLMediaElement
        this.basePath = '';
    }

    /**
     * ベースパスを設定
     */
    setBasePath(basePath) {
        this.basePath = basePath;
    }

    /**
     * video要素を作成してコンテナに追加
     */
    async createVideoElement(videoData) {
        const video = document.createElement('video');
        video.id = videoData.id;
        video.preload = videoData.preload;
        video.loop = videoData.loop;
        video.muted = videoData.muted;
        video.volume = videoData.volume;
        video.playbackRate = videoData.playbackRate;

        // ソース設定（非同期でパスを解決）
        const src = await this._resolvePathAsync(videoData.href);
        video.src = src;

        if (videoData.poster) {
            video.poster = await this._resolvePathAsync(videoData.poster);
        }

        // 配置スタイル（位置指定がある場合）
        if (videoData.right > 0 && videoData.bottom > 0) {
            video.classList.add('media-positioned');
            video.style.left = `${videoData.left}px`;
            video.style.top = `${videoData.top}px`;
            video.style.width = `${videoData.right - videoData.left}px`;
            video.style.height = `${videoData.bottom - videoData.top}px`;
            video.style.opacity = videoData.alpha;
            video.style.zIndex = videoData.zIndex;
        } else {
            // フルサイズ表示
            video.classList.add('fullsize');
        }

        // 開始位置
        if (videoData.startTime > 0) {
            video.currentTime = videoData.startTime;
        }

        this.container.appendChild(video);
        this.elements.set(video.id, video);

        return video;
    }

    /**
     * audio要素を作成
     */
    async createAudioElement(audioData) {
        const audio = document.createElement('audio');
        audio.id = audioData.id;
        audio.preload = audioData.preload;
        audio.loop = audioData.loop;
        audio.volume = audioData.volume;
        audio.playbackRate = audioData.playbackRate;

        // ソース設定（非同期でパスを解決）
        const src = await this._resolvePathAsync(audioData.href);
        audio.src = src;

        // 開始位置
        if (audioData.startTime > 0) {
            audio.currentTime = audioData.startTime;
        }

        // audioは非表示だがDOMに追加
        audio.style.display = 'none';
        this.container.appendChild(audio);
        this.elements.set(audio.id, audio);

        return audio;
    }

    /**
     * パス解決（非同期）- PluginBaseのgetImageFilePathを使用
     */
    async _resolvePathAsync(href) {
        if (!href) return '';

        // 絶対URL
        if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('file://')) {
            return href;
        }

        // {realId}プレースホルダーを置換
        if (href.includes('{realId}') && this.basePath) {
            href = href.replace(/\{realId\}/g, this.basePath);
        }

        try {
            // PluginBaseのgetImageFilePathを使用して絶対パスを取得
            const filePath = await this.plugin.getImageFilePath(href);
            if (filePath) {
                // 絶対パスをfile:// URLに変換
                if (filePath.match(/^[A-Za-z]:\\/)) {
                    // Windows絶対パス (C:\...) を file:// URLに変換
                    return 'file:///' + filePath.replace(/\\/g, '/');
                } else if (filePath.startsWith('/')) {
                    // Unix絶対パス
                    return 'file://' + filePath;
                }
                return filePath;
            }
        } catch (error) {
            console.warn('[PlayerApp] パス解決エラー:', href, error);
        }

        // フォールバック: 相対パス（正しいデータフォルダを指す）
        return `../../../../data/${href}`;
    }

    /**
     * IDでメディア要素を取得
     */
    getMediaById(id) {
        return this.elements.get(id);
    }

    /**
     * 全メディア要素を取得
     */
    getAllMedia() {
        return Array.from(this.elements.values());
    }

    /**
     * 全メディア要素をクリア
     */
    clear() {
        this.elements.forEach(el => {
            el.pause();
            el.src = '';
            el.remove();
        });
        this.elements.clear();
    }

    /**
     * video要素があるか
     */
    hasVideo() {
        return Array.from(this.elements.values()).some(el => el.tagName === 'VIDEO');
    }

    /**
     * audio要素のみか
     */
    hasOnlyAudio() {
        const elements = Array.from(this.elements.values());
        return elements.length > 0 && elements.every(el => el.tagName === 'AUDIO');
    }
}

// ============================================================
// PlaybackController - 再生制御
// ============================================================
class PlaybackController {
    constructor(mediaManager) {
        this.mediaManager = mediaManager;
        this.isPlaying = false;
        this.seekStep = 10; // シーク秒数
    }

    /**
     * 再生
     */
    play() {
        const allMedia = this.mediaManager.getAllMedia();
        this.isPlaying = true;
        allMedia.forEach(media => {
            if (media.paused) {
                media.play().catch(e => {
                    console.warn('[PlayerApp] 再生開始エラー:', e.message);
                });
            }
        });
    }

    /**
     * 一時停止
     */
    pause() {
        this.isPlaying = false;
        this.mediaManager.getAllMedia().forEach(media => {
            if (!media.paused) {
                media.pause();
            }
        });
    }

    /**
     * 停止（先頭に戻る）
     */
    stop() {
        this.isPlaying = false;
        this.mediaManager.getAllMedia().forEach(media => {
            media.pause();
            media.currentTime = 0;
        });
    }

    /**
     * 再生/一時停止トグル
     */
    toggle() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    /**
     * 前へ（巻き戻し）
     */
    seekBackward(seconds = null) {
        const step = seconds || this.seekStep;
        this.mediaManager.getAllMedia().forEach(media => {
            media.currentTime = Math.max(media.currentTime - step, 0);
        });
    }

    /**
     * 後へ（早送り）
     */
    seekForward(seconds = null) {
        const step = seconds || this.seekStep;
        this.mediaManager.getAllMedia().forEach(media => {
            media.currentTime = Math.min(media.currentTime + step, media.duration || Infinity);
        });
    }

    /**
     * 音量設定
     */
    setVolume(volume) {
        const v = Math.max(0, Math.min(1, volume));
        this.mediaManager.getAllMedia().forEach(media => {
            media.volume = v;
        });
    }

    /**
     * 再生速度設定
     */
    setPlaybackRate(rate) {
        this.mediaManager.getAllMedia().forEach(media => {
            media.playbackRate = rate;
        });
    }
}

// ============================================================
// PlayerApp - メインアプリケーション
// ============================================================
class PlayerApp extends PluginBase {
    constructor() {
        super('PlayerApp');

        this.parser = new RealtimeTadParser();
        this.mediaManager = null;
        this.controller = null;
        this.realtimeData = null;
        this.alwaysOnTop = false;

        this.initialize();
    }

    async initialize() {
        // DOM要素
        this.playerContainer = document.getElementById('playerContainer');
        this.mediaContainer = document.getElementById('mediaContainer');
        this.noMediaMessage = document.getElementById('noMediaMessage');

        // MediaElementManagerの初期化（thisを渡してgetImageFilePathを使用可能にする）
        this.mediaManager = new MediaElementManager(this.mediaContainer, this);
        this.controller = new PlaybackController(this.mediaManager);

        // MessageBusハンドラ設定
        this.setupMessageBusHandlers();

        // キーボードショートカット設定
        this.setupKeyboardShortcuts();

        // コンテキストメニュー設定（右クリックメニュー）
        this.setupContextMenu();

        // ドラッグ＆ドロップ設定
        this.setupDragAndDrop();

        // 背景色の初期設定
        this.bgColor = '#000000';
    }

    /**
     * ドラッグ＆ドロップイベント設定
     * 親ウィンドウにオーバーレイ表示を要求し、親がdropを処理する
     */
    setupDragAndDrop() {
        // dragenter - ドラッグがプレイヤーに入った時、親にオーバーレイ表示を要求
        this.playerContainer.addEventListener('dragenter', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 親ウィンドウにオーバーレイ表示を要求
            this.messageBus.send('show-media-drop-overlay', {
                windowId: this.windowId
            });
            console.log('[PlayerApp] dragenter - 親にオーバーレイ表示を要求');
        });

        // dragover - ドラッグ中のファイルがプレイヤー上にある時
        this.playerContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        // dragleave - ドラッグがプレイヤーから離れた時、親にオーバーレイ非表示を要求
        this.playerContainer.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 親ウィンドウにオーバーレイ非表示を要求
            this.messageBus.send('hide-media-drop-overlay', {
                windowId: this.windowId
            });
            console.log('[PlayerApp] dragleave - 親にオーバーレイ非表示を要求');
        });

        // drop - 通常は親のオーバーレイが処理するが、フォールバック
        this.playerContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // ファイル処理は親ウィンドウが行い、'media-files-added'メッセージで通知される
            console.log('[PlayerApp] drop event - 親ウィンドウが処理します');
        });
    }

    /**
     * xmlTADにメディア要素を追加して保存
     * @param {string} fileName - 保存したファイル名
     * @param {string} mediaType - 'video' または 'audio'
     * @param {string} format - ファイルフォーマット
     */
    async updateXtadWithMedia(fileName, mediaType, format) {
        try {
            // 現在のxtadを取得（複数のパターンに対応）
            let xtadContent = null;
            if (this.fileData) {
                xtadContent = this.fileData.xmlData ||
                              this.fileData.records?.[0]?.xtad ||
                              this.fileData.records?.[0]?.data;
            }

            if (!xtadContent) {
                // デフォルトの構造を使用
                xtadContent = `<tad version="1.0" encoding="UTF-8">
<realtime autoplay="false" preload="metadata" loop="false">
<realData autoplay="inherit" startDelay="0">
<stream number="1">
<deviceName>display:</deviceName>
</stream>
</realData>
</realtime>
</tad>`;
            }

            // XMLをパース
            const parser = new DOMParser();
            const doc = parser.parseFromString(xtadContent, 'text/xml');

            // realtime要素を取得（または作成）
            let realtimeEl = doc.querySelector('realtime');
            if (!realtimeEl) {
                const tadEl = doc.querySelector('tad');
                if (!tadEl) {
                    console.error('[PlayerApp] tad要素が見つかりません');
                    return;
                }
                realtimeEl = doc.createElement('realtime');
                realtimeEl.setAttribute('autoplay', 'false');
                realtimeEl.setAttribute('preload', 'metadata');
                realtimeEl.setAttribute('loop', 'false');
                tadEl.appendChild(realtimeEl);
            }

            // realData要素を取得（または作成）
            let realDataEl = realtimeEl.querySelector('realData');
            if (!realDataEl) {
                realDataEl = doc.createElement('realData');
                realDataEl.setAttribute('autoplay', 'inherit');
                realDataEl.setAttribute('startDelay', '0');
                realtimeEl.appendChild(realDataEl);
            }

            // メディア要素のIDを生成
            const mediaId = `${mediaType}-${Date.now()}`;

            // メディア要素を作成
            const mediaEl = doc.createElement(mediaType);
            mediaEl.setAttribute('id', mediaId);
            mediaEl.setAttribute('href', fileName);
            mediaEl.setAttribute('format', format);
            mediaEl.setAttribute('autoplay', 'false');
            mediaEl.setAttribute('preload', 'auto');

            if (mediaType === 'video') {
                // video固有の属性
                mediaEl.setAttribute('left', '0');
                mediaEl.setAttribute('top', '0');
                mediaEl.setAttribute('right', '0');
                mediaEl.setAttribute('bottom', '0');
                mediaEl.setAttribute('volume', '1.0');
                mediaEl.setAttribute('playbackRate', '1.0');
            } else {
                // audio固有の属性
                mediaEl.setAttribute('volume', '1.0');
                mediaEl.setAttribute('pan', '0.0');
                mediaEl.setAttribute('playbackRate', '1.0');
            }

            // realData要素にメディア要素を追加
            realDataEl.appendChild(mediaEl);

            // XMLをシリアライズ
            const serializer = new XMLSerializer();
            let newXtadContent = serializer.serializeToString(doc);

            // <?xml...?>宣言を削除（xmlTAD仕様では不要）
            newXtadContent = newXtadContent.replace(/<\?xml[^?]*\?>\s*/g, '');

            // xml-data-changedで保存
            this.messageBus.send('xml-data-changed', {
                fileId: this.realId,
                xmlData: newXtadContent
            });

            // fileDataも更新
            if (this.fileData) {
                this.fileData.xmlData = newXtadContent;
                if (this.fileData.records?.[0]) {
                    this.fileData.records[0].xtad = newXtadContent;
                    this.fileData.records[0].data = newXtadContent;
                }
            }

            console.log('[PlayerApp] xmlTAD更新完了');
        } catch (error) {
            console.error('[PlayerApp] xmlTAD更新エラー:', error);
        }
    }

    /**
     * MessageBusハンドラ設定
     */
    setupMessageBusHandlers() {
        // 共通ハンドラ
        this.setupCommonMessageBusHandlers();

        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            this.windowId = data.windowId;
            this.fileData = data.fileData;

            // realIdを取得（fileDataから、_数字.xtadを除去）
            if (data.fileData) {
                let rawId = data.fileData.realId || data.fileData.fileId;
                this.realId = rawId ? rawId.replace(/_\d+\.xtad$/i, '') : null;
            }

            // 実身IDからベースパスを設定
            if (this.realId) {
                this.mediaManager.setBasePath(this.realId);
            }

            // xtadデータをロード
            await this.loadXtadData();
        });

        // 親ウィンドウからのメディアファイル追加通知
        this.messageBus.on('media-files-added', async (data) => {
            console.log('[PlayerApp] media-files-added受信:', data);

            if (data.mediaFiles && data.mediaFiles.length > 0) {
                // 各メディアファイルをxmlTADに追加
                for (const media of data.mediaFiles) {
                    await this.updateXtadWithMedia(media.fileName, media.mediaType, media.format);
                }

                // 再表示
                await this.refresh();
            }
        });
    }

    /**
     * xtadデータをロード
     */
    async loadXtadData() {
        try {
            let xtadContent = null;

            // fileDataから取得（複数のパターンに対応）
            if (this.fileData) {
                xtadContent = this.fileData.xmlData ||
                              this.fileData.records?.[0]?.xtad ||
                              this.fileData.records?.[0]?.data;
            }

            if (!xtadContent && this.realId) {
                // MessageBus経由で読み込み
                xtadContent = await this.loadRealObjectXtad(this.realId);
            }

            if (xtadContent) {
                this.realtimeData = this.parser.parse(xtadContent);
                await this.setupMedia();
            } else {
                this.showNoMedia();
            }
        } catch (error) {
            console.error('[PlayerApp] xtad読み込みエラー:', error);
            this.showNoMedia();
        }
    }

    /**
     * メディア要素をセットアップ
     */
    async setupMedia() {
        if (!this.realtimeData || this.realtimeData.type !== 'realtime') {
            this.showNoMedia();
            return;
        }

        const { media, autoplay } = this.realtimeData;

        if (media.length === 0) {
            this.showNoMedia();
            return;
        }

        // メディア要素を作成（非同期でパス解決）
        for (const item of media) {
            if (item.type === 'video') {
                const video = await this.mediaManager.createVideoElement(item);
                this._setupMediaEventListeners(video, item);
            } else if (item.type === 'audio') {
                const audio = await this.mediaManager.createAudioElement(item);
                this._setupMediaEventListeners(audio, item);
            }
        }

        // 音声のみの場合、プレースホルダーを表示
        if (this.mediaManager.hasOnlyAudio()) {
            this._showAudioPlaceholder();
        }

        // メッセージを非表示
        this.noMediaMessage.classList.remove('visible');

        // 自動再生
        if (autoplay) {
            // ユーザー操作なしで自動再生する場合、ミュートが必要な場合がある
            setTimeout(() => {
                this.controller.play();
            }, 100);
        }
    }

    /**
     * メディア要素のイベントリスナー設定
     */
    _setupMediaEventListeners(mediaEl, mediaData) {
        mediaEl.addEventListener('ended', () => {
            this.controller.isPlaying = false;
        });

        mediaEl.addEventListener('error', (e) => {
            console.error('[PlayerApp] メディアエラー:', mediaEl.src, e);
        });

        mediaEl.addEventListener('loadedmetadata', () => {
            console.log('[PlayerApp] メタデータ読み込み完了:', mediaEl.id);
        });
    }

    /**
     * 音声のみの場合のプレースホルダー表示
     */
    _showAudioPlaceholder() {
        const placeholder = document.createElement('div');
        placeholder.className = 'audio-placeholder';
        placeholder.innerHTML = `
            <div class="audio-placeholder-icon">🎵</div>
            <div class="audio-placeholder-text">音声を再生中</div>
        `;
        this.mediaContainer.appendChild(placeholder);
    }

    /**
     * メディアなしメッセージを表示
     */
    showNoMedia() {
        this.noMediaMessage.classList.add('visible');
    }

    /**
     * キーボードショートカット設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+キーの組み合わせ
            if (e.ctrlKey) {
                switch (e.key.toLowerCase()) {
                    case 'e': // 閉じる
                        e.preventDefault();
                        this.handleCloseRequest();
                        break;
                    case 'l': // 全画面表示オンオフ
                        e.preventDefault();
                        this.toggleFullscreen();
                        break;
                    case 'p': // 再生
                        e.preventDefault();
                        this.controller.play();
                        break;
                    case 's': // 停止
                        e.preventDefault();
                        this.controller.stop();
                        break;
                    case 'v': // 前へ
                        e.preventDefault();
                        this.controller.seekBackward();
                        break;
                    case 'x': // 後へ
                        e.preventDefault();
                        this.controller.seekForward();
                        break;
                }
            }

            // スペースキーで再生/一時停止トグル
            if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                this.controller.toggle();
            }
        });
    }

    /**
     * メニュー定義
     * 注: 「閉じる」と「小物」はPluginBaseが自動追加
     */
    getMenuDefinition() {
        return [
            {
                label: '表示',
                submenu: [
                    { label: '全画面表示オンオフ', shortcut: 'Ctrl+L', action: 'toggle-fullscreen' },
                    { label: '再表示', action: 'refresh' },
                    { label: '常に最前面に表示', action: 'toggle-always-on-top', checked: this.alwaysOnTop },
                    { label: '背景色変更', action: 'change-bg-color' }
                ]
            },
            {
                label: '操作',
                submenu: [
                    { label: '再生', shortcut: 'Ctrl+P', action: 'play' },
                    { label: '停止', shortcut: 'Ctrl+S', action: 'stop' },
                    { label: '前へ', shortcut: 'Ctrl+V', action: 'seek-backward' },
                    { label: '後へ', shortcut: 'Ctrl+X', action: 'seek-forward' }
                ]
            }
        ];
    }

    /**
     * メニューアクション実行
     * 注: 「close」と「accessories」はPluginBaseが処理
     */
    executeMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                this.refresh();
                break;
            case 'toggle-always-on-top':
                this.toggleAlwaysOnTop();
                break;
            case 'change-bg-color':
                this.changeBgColor();
                break;
            case 'play':
                this.controller.play();
                break;
            case 'stop':
                this.controller.stop();
                break;
            case 'seek-backward':
                this.controller.seekBackward();
                break;
            case 'seek-forward':
                this.controller.seekForward();
                break;
        }
    }

    /**
     * 再表示
     */
    async refresh() {
        this.mediaManager.clear();
        await this.loadXtadData();
    }

    /**
     * 常に最前面に表示トグル
     */
    toggleAlwaysOnTop() {
        this.alwaysOnTop = !this.alwaysOnTop;
        this.messageBus.send('set-always-on-top', {
            windowId: this.windowId,
            alwaysOnTop: this.alwaysOnTop
        });
    }

    /**
     * 背景色をUIに適用（PluginBaseのオーバーライド）
     * @param {string} color - 背景色
     */
    applyBackgroundColor(color) {
        this.bgColor = color;
        this.playerContainer.style.backgroundColor = color;
        document.body.style.backgroundColor = color;
    }

}

// アプリケーション開始
// モジュールとして読み込まれるため、PluginBaseは既にグローバルに登録済み
window.playerApp = new PlayerApp();
