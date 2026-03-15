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

import { RealtimeTadParser } from '../../js/realtime-media.js';

const logger = window.getLogger('PlayerApp');

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

        // 再生制御用データを保存
        video.dataset.trigger = videoData.trigger || 'time';
        if (videoData.onended) {
            video.dataset.onended = videoData.onended;
        }

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

        // 再生制御用データを保存
        audio.dataset.trigger = audioData.trigger || 'time';
        if (audioData.onended) {
            audio.dataset.onended = audioData.onended;
        }

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
            logger.warn('[PlayerApp] パス解決エラー:', href, error);
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

        // 再生モード
        this.repeatMode = 'none';      // 'none' | 'all' | 'one'
        this.shuffleMode = false;
        this.lastPlayedIndex = -1;     // シャッフル時の連続再生回避用
    }

    /**
     * 再生
     * シャッフルモードの場合は1曲だけランダムに再生
     * それ以外は最初のメディアのみ再生（後続はonendedで連鎖）
     */
    play() {
        const allMedia = this.mediaManager.getAllMedia();
        if (allMedia.length === 0) return;

        this.isPlaying = true;

        // シャッフルモードの場合は1曲だけランダムに再生
        if (this.shuffleMode) {
            this.playRandom();
            return;
        }

        // 既に再生中のメディアがあればそれを続行
        const currentlyPlaying = allMedia.find(m => !m.paused && !m.ended);
        if (currentlyPlaying) {
            return;
        }

        // 一時停止中のメディアがあればそれを再開
        const paused = this.getCurrentMedia();
        if (paused && paused.paused && paused.currentTime > 0) {
            paused.play().catch(e => {
                logger.warn('[PlayerApp] 再生再開エラー:', e.message);
            });
            return;
        }

        // 最初のメディアのみ再生（後続はonendedで連鎖再生）
        const firstMedia = allMedia[0];
        if (firstMedia && firstMedia.paused) {
            firstMedia.currentTime = 0;
            firstMedia.play().catch(e => {
                logger.warn('[PlayerApp] 再生開始エラー:', e.message);
            });
        }
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

    /**
     * 指定IDのメディアを再生
     * @param {string} id - メディア要素のID
     */
    playMedia(id) {
        const media = this.mediaManager.getMediaById(id);
        if (media && media.paused) {
            media.play().catch(e => {
                logger.warn('[PlayerApp] メディア再生エラー:', id, e.message);
            });
        }
    }

    /**
     * 現在再生中または最後に再生したメディアを取得
     */
    getCurrentMedia() {
        const allMedia = this.mediaManager.getAllMedia();
        // 再生中のメディアを探す
        for (const media of allMedia) {
            if (!media.paused && !media.ended) {
                return media;
            }
        }
        // 一時停止中で再生位置が進んでいるメディアを探す
        for (const media of allMedia) {
            if (media.paused && media.currentTime > 0) {
                return media;
            }
        }
        // どちらもなければ最初のメディアを返す
        return allMedia[0] || null;
    }

    /**
     * 現在のトラックインデックスを取得
     */
    getCurrentTrackIndex() {
        const allMedia = this.mediaManager.getAllMedia();
        const current = this.getCurrentMedia();
        return current ? allMedia.indexOf(current) : 0;
    }

    /**
     * 前のトラックを再生
     */
    playPrevious() {
        const allMedia = this.mediaManager.getAllMedia();
        if (allMedia.length === 0) return;

        const currentIndex = this.getCurrentTrackIndex();
        const current = this.getCurrentMedia();

        // 現在の再生を停止
        if (current && !current.paused) {
            current.pause();
            current.currentTime = 0;
        }

        if (currentIndex > 0) {
            // 前のトラックへ
            const prevMedia = allMedia[currentIndex - 1];
            prevMedia.currentTime = 0;
            this.isPlaying = true;
            prevMedia.play().catch(e => logger.warn('[PlayerApp] 再生エラー:', e.message));
        } else {
            // 1曲目なら先頭に戻る
            if (current) {
                current.currentTime = 0;
                this.isPlaying = true;
                current.play().catch(e => logger.warn('[PlayerApp] 再生エラー:', e.message));
            }
        }
    }

    /**
     * 次のトラックを再生（モード対応版）
     */
    playNext() {
        const allMedia = this.mediaManager.getAllMedia();
        if (allMedia.length === 0) return;

        // シャッフルモードの場合
        if (this.shuffleMode) {
            this.playRandom();
            return;
        }

        const currentIndex = this.getCurrentTrackIndex();

        if (currentIndex < allMedia.length - 1) {
            // 次のトラックへ
            this._playTrackAtIndex(currentIndex + 1);
        } else if (this.repeatMode === 'all') {
            // リピートALL: 最初に戻る
            this._playTrackAtIndex(0);
        }
        // repeatMode === 'none'の場合は何もしない
    }

    /**
     * リピートモードを切り替え（none → all → one → none）
     * @returns {string} 新しいリピートモード
     */
    cycleRepeatMode() {
        const modes = ['none', 'all', 'one'];
        const currentIndex = modes.indexOf(this.repeatMode);
        this.repeatMode = modes[(currentIndex + 1) % modes.length];
        return this.repeatMode;
    }

    /**
     * シャッフルモードを切り替え
     * @returns {boolean} 新しいシャッフル状態
     */
    toggleShuffle() {
        this.shuffleMode = !this.shuffleMode;
        return this.shuffleMode;
    }

    /**
     * ランダムにトラックを選択して再生
     */
    playRandom() {
        const allMedia = this.mediaManager.getAllMedia();
        if (allMedia.length === 0) return;

        if (allMedia.length === 1) {
            // 1曲しかない場合はそれを再生
            this._playTrackAtIndex(0);
            return;
        }

        // 直前のトラックを除外してランダム選択
        const availableIndices = [];
        for (let i = 0; i < allMedia.length; i++) {
            if (i !== this.lastPlayedIndex) {
                availableIndices.push(i);
            }
        }

        const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
        this._playTrackAtIndex(randomIndex);
    }

    /**
     * 指定インデックスのトラックを再生
     * @param {number} index - トラックインデックス
     */
    _playTrackAtIndex(index) {
        const allMedia = this.mediaManager.getAllMedia();
        if (index < 0 || index >= allMedia.length) return;

        // 現在の再生を停止
        const current = this.getCurrentMedia();
        if (current && !current.paused) {
            current.pause();
            current.currentTime = 0;
        }

        const targetMedia = allMedia[index];
        targetMedia.currentTime = 0;
        this.isPlaying = true;
        this.lastPlayedIndex = index;
        targetMedia.play().catch(e => logger.warn('[PlayerApp] 再生エラー:', e.message));
    }

    /**
     * トラック再生完了時の処理（リピート1曲モード対応）
     * @returns {boolean} true=処理済み（通常のonended処理をスキップ）
     */
    handleTrackEnded() {
        if (this.repeatMode === 'one') {
            // 1曲リピート: 同じトラックを再生
            const current = this.getCurrentMedia();
            if (current) {
                current.currentTime = 0;
                this.isPlaying = true;
                current.play().catch(e => logger.warn('[PlayerApp] 再生エラー:', e.message));
            }
            return true;
        }
        return false; // 通常のonended処理を続行
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
        this.playlistWindowId = null;  // プレイリストウィンドウID

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

        // シークバー設定
        this.setupSeekbar();

        // 背景色の初期設定
        this.bgColor = '#000000';
    }

    /**
     * ドラッグ＆ドロップイベント設定
     * 親ウィンドウにオーバーレイ表示を要求し、親がdropを処理する
     */
    setupDragAndDrop() {
        // 名前付きハンドラ（クリーンアップ用に保持）
        this._dragEnterHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.messageBus.send('show-media-drop-overlay', {
                windowId: this.windowId
            });
            logger.debug('[PlayerApp] dragenter - 親にオーバーレイ表示を要求');
        };

        this._dragOverHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        this._dragLeaveHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.messageBus.send('hide-media-drop-overlay', {
                windowId: this.windowId
            });
            logger.debug('[PlayerApp] dragleave - 親にオーバーレイ非表示を要求');
        };

        this._dropHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            logger.debug('[PlayerApp] drop event - 親ウィンドウが処理します');
        };

        this.playerContainer.addEventListener('dragenter', this._dragEnterHandler);
        this.playerContainer.addEventListener('dragover', this._dragOverHandler);
        this.playerContainer.addEventListener('dragleave', this._dragLeaveHandler);
        this.playerContainer.addEventListener('drop', this._dropHandler);
    }

    /**
     * xmlTADにメディア要素を追加して保存
     * @param {string} fileName - 保存したファイル名
     * @param {string} mediaType - 'video' または 'audio'
     * @param {string} format - ファイルフォーマット
     * @param {Object} [id3Tags] - ID3タグ情報 {title, artist, album, trackNumber}
     */
    async updateXtadWithMedia(fileName, mediaType, format, id3Tags = null) {
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
                    logger.error('[PlayerApp] tad要素が見つかりません');
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

            // 既存のメディア要素を取得
            const existingMedia = realDataEl.querySelectorAll('audio, video');
            const isFirstMedia = existingMedia.length === 0;

            // メディア要素のIDを生成
            const mediaId = `${mediaType}-${Date.now()}`;

            // メディア要素を作成
            const mediaEl = doc.createElement(mediaType);
            mediaEl.setAttribute('id', mediaId);
            mediaEl.setAttribute('href', fileName);
            mediaEl.setAttribute('format', format);
            mediaEl.setAttribute('preload', 'auto');

            if (isFirstMedia) {
                // 1曲目: autoplay="false"（ユーザー操作で開始）
                mediaEl.setAttribute('autoplay', 'false');
            } else {
                // 2曲目以降: trigger="manual"（前曲終了で開始）
                mediaEl.setAttribute('trigger', 'manual');

                // 前のメディア要素にonendedを設定
                const lastMedia = existingMedia[existingMedia.length - 1];
                if (!lastMedia.hasAttribute('onended')) {
                    lastMedia.setAttribute('onended', `play:${mediaId}`);
                }
            }

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

            // ID3タグから取得したトラック情報属性を設定
            if (id3Tags) {
                if (id3Tags.title) {
                    mediaEl.setAttribute('title', id3Tags.title);
                }
                if (id3Tags.artist) {
                    mediaEl.setAttribute('artist', id3Tags.artist);
                }
                if (id3Tags.album) {
                    mediaEl.setAttribute('album', id3Tags.album);
                }
                if (id3Tags.trackNumber !== null && id3Tags.trackNumber !== undefined) {
                    mediaEl.setAttribute('trackNumber', String(id3Tags.trackNumber));
                }
            }

            // realData要素にメディア要素を追加
            realDataEl.appendChild(mediaEl);

            // XMLをシリアライズ
            const serializer = new XMLSerializer();
            let newXtadContent = serializer.serializeToString(doc);

            // <?xml...?>宣言を削除（xmlTAD仕様では不要）
            newXtadContent = newXtadContent.replace(/<\?xml[^?]*\?>\s*/g, '');

            // XMLを整形（各要素を改行で区切る）
            newXtadContent = this._formatXmlOutput(newXtadContent);

            // xml-data-changedで保存
            this.messageBus.send('xml-data-changed', {
                windowId: this.windowId,
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

            logger.debug('[PlayerApp] xmlTAD更新完了（メディア追加）');
        } catch (error) {
            logger.error('[PlayerApp] xmlTAD更新エラー:', error);
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
                this.realId = rawId ? this.extractRealId(rawId) : null;
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
            if (data.mediaFiles && data.mediaFiles.length > 0) {
                // 各メディアファイルをxmlTADに追加
                for (const media of data.mediaFiles) {
                    await this.updateXtadWithMedia(media.fileName, media.mediaType, media.format, media.id3Tags || null);
                }

                // 再表示
                await this.refresh();
            }
        });

        // プレイリストウィンドウからのトラック再生要求
        this.messageBus.on('play-track-request', (data) => {
            if (typeof data.index === 'number') {
                this.controller._playTrackAtIndex(data.index);
                this.updatePlayPauseButton();
                this._updateAudioPlaceholder();
            }
        });

        // ウィンドウクローズ通知（プレイリストウィンドウが閉じた場合のトラッキングクリア）
        this.messageBus.on('window-closed', (data) => {
            if (data.windowId === this.playlistWindowId) {
                this.playlistWindowId = null;
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

                // 再生モードを復元
                if (this.realtimeData.playbackMode) {
                    this.controller.shuffleMode = this.realtimeData.playbackMode.shuffleMode;
                    this.controller.repeatMode = this.realtimeData.playbackMode.repeatMode;
                }

                await this.setupMedia();

                // UIを更新
                this.updateShuffleButton();
                this.updateRepeatButton();
            } else {
                this.showNoMedia();
            }
        } catch (error) {
            logger.error('[PlayerApp] xtad読み込みエラー:', error);
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

        // 自動再生（play()メソッドが適切に1曲だけ再生する）
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
            // リピート1曲モードの場合は優先処理
            if (this.controller.handleTrackEnded()) {
                this.updatePlayPauseButton();
                this._updateAudioPlaceholder();
                return;
            }

            // onended属性の処理
            const onended = mediaEl.dataset.onended;
            if (onended) {
                this._executeOnendedAction(onended);
            } else {
                // onendedがない場合でもリピート・シャッフルモードを考慮
                if (this.controller.shuffleMode || this.controller.repeatMode === 'all') {
                    this.controller.playNext();
                    this.updatePlayPauseButton();
                    this._updateAudioPlaceholder();
                } else {
                    // 次のメディアがなければ再生状態を解除
                    this.controller.isPlaying = false;
                    this.updatePlayPauseButton();
                }
            }
        });

        mediaEl.addEventListener('play', () => {
            // 再生開始時にプレースホルダーを更新
            this._updateAudioPlaceholder();
            this.updatePlayPauseButton();

            // トラック変更をブロードキャスト（プレイリストウィンドウ用）
            this.messageBus.send('track-changed', {
                sourceWindowId: this.windowId,
                index: this.controller.getCurrentTrackIndex()
            });
        });

        mediaEl.addEventListener('pause', () => {
            this.updatePlayPauseButton();
        });

        mediaEl.addEventListener('error', (e) => {
            logger.error('[PlayerApp] メディアエラー:', mediaEl.src, e);
        });

        mediaEl.addEventListener('loadedmetadata', () => {
            // メタデータ読み込み完了（ログは不要）
        });
    }

    /**
     * onended属性のアクションを実行
     * @param {string} action - "play:id", "play:next", "play:first", "play:random", "stop", "pause"など
     */
    _executeOnendedAction(action) {
        if (!action) return;

        // "play:..."形式のパース
        if (action.startsWith('play:')) {
            const target = action.substring(5);

            if (target === 'next') {
                // 次のトラックを再生（シャッフル/リピートモード対応）
                this.controller.playNext();
            } else if (target === 'first') {
                // 最初のトラックを再生
                this.controller._playTrackAtIndex(0);
            } else if (target === 'random') {
                // ランダム再生
                this.controller.playRandom();
            } else {
                // 指定IDのメディアを再生
                this.controller.playMedia(target);
            }
            this.updatePlayPauseButton();
            this._updateAudioPlaceholder();
        } else if (action === 'stop') {
            this.controller.stop();
            this.updatePlayPauseButton();
        } else if (action === 'pause') {
            this.controller.pause();
            this.updatePlayPauseButton();
        }
    }

    /**
     * 音声のみの場合のプレースホルダー表示
     */
    _showAudioPlaceholder() {
        // 既存のプレースホルダーがあれば追加しない
        if (this.mediaContainer.querySelector('.audio-placeholder')) {
            this._updateAudioPlaceholder();
            return;
        }
        const placeholder = document.createElement('div');
        placeholder.className = 'audio-placeholder';
        placeholder.innerHTML = `
            <div class="audio-placeholder-icon">🎵</div>
            <div class="audio-title"></div>
            <div class="audio-artist-album"></div>
            <div class="audio-placeholder-text">音声を再生中</div>
        `;
        this.mediaContainer.appendChild(placeholder);
        this._updateAudioPlaceholder();
    }

    /**
     * 音声プレースホルダーのメタデータを更新
     */
    _updateAudioPlaceholder() {
        const placeholder = this.mediaContainer.querySelector('.audio-placeholder');
        if (!placeholder) return;

        // 現在のトラック情報を取得
        const current = this.controller.getCurrentMedia();
        if (!current || !this.realtimeData) return;

        // mediaデータから対応するトラック情報を検索
        const mediaData = this.realtimeData.media.find(m => m.id === current.id);
        if (!mediaData) return;

        const titleEl = placeholder.querySelector('.audio-title');
        const artistAlbumEl = placeholder.querySelector('.audio-artist-album');

        // タイトル表示
        if (titleEl) {
            if (mediaData.title) {
                titleEl.textContent = mediaData.title;
                titleEl.style.display = 'block';
            } else {
                titleEl.style.display = 'none';
            }
        }

        // アーティスト・アルバム表示
        if (artistAlbumEl) {
            const parts = [];
            if (mediaData.artist) parts.push(mediaData.artist);
            if (mediaData.album) parts.push(mediaData.album);
            if (parts.length > 0) {
                artistAlbumEl.textContent = parts.join(' / ');
                artistAlbumEl.style.display = 'block';
            } else {
                artistAlbumEl.style.display = 'none';
            }
        }
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
                        this.messageBus.send('close-window', { windowId: this.windowId });
                        break;
                    case 'l': // 全画面表示オンオフ
                        e.preventDefault();
                        this.toggleFullscreen();
                        break;
                    case 'p': // 再生/一時停止
                        e.preventDefault();
                        this.controller.toggle();
                        this.updatePlayPauseButton();
                        break;
                    case 's': // 停止
                        e.preventDefault();
                        this.controller.stop();
                        this.updatePlayPauseButton();
                        break;
                    case 'v': // 前のトラック
                        e.preventDefault();
                        this.controller.playPrevious();
                        this.updatePlayPauseButton();
                        break;
                    case 'x': // 次のトラック
                        e.preventDefault();
                        this.controller.playNext();
                        this.updatePlayPauseButton();
                        break;
                }
            }

            // 矢印キーでシーク（Ctrlなし）
            if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
                switch (e.key) {
                    case 'ArrowLeft': // 10秒戻す
                        e.preventDefault();
                        this.controller.seekBackward();
                        break;
                    case 'ArrowRight': // 10秒進む
                        e.preventDefault();
                        this.controller.seekForward();
                        break;
                }
            }

            // スペースキーで再生/一時停止トグル
            if (e.key === ' ' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
                e.preventDefault();
                this.controller.toggle();
                this.updatePlayPauseButton();
            }
        });
    }

    /**
     * メニュー定義
     * 注: 「閉じる」と「小物」はPluginBaseが自動追加
     */
    getMenuDefinition() {
        // リピートモードのラベルを取得
        const repeatLabels = {
            'none': 'リピート: なし',
            'all': 'リピート: 全曲',
            'one': 'リピート: 1曲'
        };
        const repeatLabel = repeatLabels[this.controller?.repeatMode || 'none'];

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
                label: 'プレイリスト表示',
                action: 'show-playlist'
            },
            {
                label: '操作',
                submenu: [
                    { label: '再生/一時停止', shortcut: 'Ctrl+P', action: 'toggle' },
                    { label: '停止', shortcut: 'Ctrl+S', action: 'stop' },
                    { type: 'separator' },
                    { label: '前のトラック', shortcut: 'Ctrl+V', action: 'play-previous' },
                    { label: '次のトラック', shortcut: 'Ctrl+X', action: 'play-next' },
                    { type: 'separator' },
                    { label: '10秒戻す', shortcut: '←', action: 'seek-backward' },
                    { label: '10秒進む', shortcut: '→', action: 'seek-forward' },
                    { type: 'separator' },
                    { label: 'シャッフル', action: 'toggle-shuffle', checked: this.controller?.shuffleMode },
                    { label: repeatLabel, action: 'cycle-repeat' }
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
            case 'toggle':
                this.controller.toggle();
                this.updatePlayPauseButton();
                break;
            case 'stop':
                this.controller.stop();
                this.updatePlayPauseButton();
                break;
            case 'play-previous':
                this.controller.playPrevious();
                this.updatePlayPauseButton();
                this._updateAudioPlaceholder();
                break;
            case 'play-next':
                this.controller.playNext();
                this.updatePlayPauseButton();
                this._updateAudioPlaceholder();
                break;
            case 'seek-backward':
                this.controller.seekBackward();
                break;
            case 'seek-forward':
                this.controller.seekForward();
                break;
            case 'toggle-shuffle':
                this.controller.toggleShuffle();
                this.updateShuffleButton();
                this.updateXtadForPlaybackMode();
                break;
            case 'cycle-repeat':
                this.controller.cycleRepeatMode();
                this.updateRepeatButton();
                this.updateXtadForPlaybackMode();
                break;
            case 'show-playlist':
                this.showPlaylistWindow();
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
     * クローズ要求ハンドラ（プレイリストウィンドウも閉じる）
     * @param {string} windowId - ウィンドウID
     */
    async handleCloseRequest(windowId) {
        // D&Dイベントリスナーをクリーンアップ
        if (this.playerContainer) {
            if (this._dragEnterHandler) this.playerContainer.removeEventListener('dragenter', this._dragEnterHandler);
            if (this._dragOverHandler) this.playerContainer.removeEventListener('dragover', this._dragOverHandler);
            if (this._dragLeaveHandler) this.playerContainer.removeEventListener('dragleave', this._dragLeaveHandler);
            if (this._dropHandler) this.playerContainer.removeEventListener('drop', this._dropHandler);
        }
        // プレイリストウィンドウが開いていれば先に閉じる
        if (this.playlistWindowId) {
            this.messageBus.send('close-window', { windowId: this.playlistWindowId });
            this.playlistWindowId = null;
        }
        // 親クラスのクローズ処理を実行
        await super.handleCloseRequest(windowId);
    }

    // ========================================
    // プレイリストウィンドウ機能
    // ========================================

    /**
     * プレイリストウィンドウを表示
     */
    showPlaylistWindow() {
        if (!this.realtimeData || !this.realtimeData.media) {
            return;
        }

        // 既にプレイリストウィンドウが開いている場合はアクティブ化のみ
        if (this.playlistWindowId) {
            this.messageBus.send('activate-window', { windowId: this.playlistWindowId });
            return;
        }

        const tracks = this.realtimeData.media.map((media, index) => ({
            index,
            title: media.title || null,
            href: media.href,
            artist: media.artist || null,
            album: media.album || null
        }));

        const initData = {
            tracks: tracks,
            currentIndex: this.controller.getCurrentTrackIndex(),
            parentWindowId: this.windowId
        };

        // 親ウィンドウ経由でプレイリストウィンドウを起動
        if (window.parent && window.parent.tadjsDesktop) {
            this.playlistWindowId = window.parent.tadjsDesktop.createIframeWindow(
                'plugins/basic-player/playlist/index.html',
                'プレイリスト',
                initData,
                {
                    width: 280,
                    height: 350,
                    resizable: true,
                    customScrollbar: true
                }
            );
        }
    }

    /**
     * シークバーを初期化
     */
    setupSeekbar() {
        this.seekbarContainer = document.getElementById('seekbarContainer');
        this.seekbarHoverArea = document.getElementById('seekbarHoverArea');
        this.seekbarSlider = document.getElementById('seekbarSlider');
        this.seekbarProgress = document.getElementById('seekbarProgress');
        this.currentTimeEl = document.getElementById('currentTime');
        this.totalTimeEl = document.getElementById('totalTime');

        // コントロールボタン
        this.btnShuffle = document.getElementById('btnShuffle');
        this.btnPrevious = document.getElementById('btnPrevious');
        this.btnPlayPause = document.getElementById('btnPlayPause');
        this.btnNext = document.getElementById('btnNext');
        this.btnRepeat = document.getElementById('btnRepeat');

        // ボタンイベント
        this.btnShuffle.addEventListener('click', () => {
            this.controller.toggleShuffle();
            this.updateShuffleButton();
            this.updateXtadForPlaybackMode();
        });

        this.btnPrevious.addEventListener('click', () => {
            this.controller.playPrevious();
            this._updateAudioPlaceholder();
        });

        this.btnPlayPause.addEventListener('click', () => {
            this.controller.toggle();
            this.updatePlayPauseButton();
        });

        this.btnNext.addEventListener('click', () => {
            this.controller.playNext();
            this._updateAudioPlaceholder();
        });

        this.btnRepeat.addEventListener('click', () => {
            this.controller.cycleRepeatMode();
            this.updateRepeatButton();
            this.updateXtadForPlaybackMode();
        });

        // ホバーエリアのイベント
        this.seekbarHoverArea.addEventListener('mouseenter', () => {
            this.showSeekbar();
        });

        this.seekbarContainer.addEventListener('mouseenter', () => {
            this.showSeekbar();
        });

        this.seekbarContainer.addEventListener('mouseleave', () => {
            this.hideSeekbar();
        });

        this.seekbarHoverArea.addEventListener('mouseleave', (e) => {
            // シークバーコンテナに移動した場合は非表示にしない
            if (!this.seekbarContainer.contains(e.relatedTarget)) {
                this.hideSeekbar();
            }
        });

        // シークバーの操作
        this.seekbarSlider.addEventListener('input', (e) => {
            this.seekToPercent(parseFloat(e.target.value));
        });

        // 時間更新用インターバル
        this.timeUpdateInterval = null;
    }

    /**
     * シークバーを表示
     */
    showSeekbar() {
        this.seekbarContainer.classList.add('visible');
        this.startTimeUpdate();
    }

    /**
     * シークバーを非表示
     */
    hideSeekbar() {
        this.seekbarContainer.classList.remove('visible');
        this.stopTimeUpdate();
    }

    /**
     * 時間更新を開始
     */
    startTimeUpdate() {
        if (this.timeUpdateInterval) return;
        this.updateSeekbarTime();
        this.timeUpdateInterval = setInterval(() => {
            this.updateSeekbarTime();
        }, 250);
    }

    /**
     * 時間更新を停止
     */
    stopTimeUpdate() {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
            this.timeUpdateInterval = null;
        }
    }

    /**
     * シークバーの時間表示を更新
     */
    updateSeekbarTime() {
        // 現在再生中のメディア要素を取得
        const currentMedia = this.controller.getCurrentMedia();
        if (!currentMedia) return;

        const currentTime = currentMedia.currentTime || 0;
        const duration = currentMedia.duration || 0;

        // 時間表示を更新
        this.currentTimeEl.textContent = this.formatTime(currentTime);
        this.totalTimeEl.textContent = this.formatTime(duration);

        // プログレスバーとスライダーを更新
        if (duration > 0) {
            const percent = (currentTime / duration) * 100;
            this.seekbarProgress.style.width = `${percent}%`;
            this.seekbarSlider.value = percent;
        }
    }

    /**
     * 指定のパーセント位置にシーク
     * @param {number} percent - 0-100のパーセント値
     */
    seekToPercent(percent) {
        // 現在再生中のメディア要素のみを対象にする
        const currentMedia = this.controller.getCurrentMedia();
        if (currentMedia && currentMedia.duration) {
            currentMedia.currentTime = (percent / 100) * currentMedia.duration;
        }
        this.updateSeekbarTime();
    }

    /**
     * 秒数を hh:mm:ss 形式にフォーマット
     * @param {number} seconds - 秒数
     * @returns {string} hh:mm:ss形式の文字列
     */
    formatTime(seconds) {
        if (!isFinite(seconds) || isNaN(seconds)) {
            return '00:00:00';
        }
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    /**
     * 再生/一時停止ボタンの表示を更新
     */
    updatePlayPauseButton() {
        if (this.btnPlayPause) {
            this.btnPlayPause.textContent = this.controller.isPlaying ? '⏸' : '▶';
            this.btnPlayPause.title = this.controller.isPlaying ? '一時停止' : '再生';
        }
    }

    /**
     * シャッフルボタンの表示を更新
     */
    updateShuffleButton() {
        if (this.btnShuffle) {
            this.btnShuffle.classList.toggle('active', this.controller.shuffleMode);
            this.btnShuffle.title = this.controller.shuffleMode ? 'シャッフル: オン' : 'シャッフル: オフ';
        }
    }

    /**
     * リピートボタンの表示を更新
     */
    updateRepeatButton() {
        if (this.btnRepeat) {
            switch (this.controller.repeatMode) {
                case 'none':
                    this.btnRepeat.textContent = '🔁';
                    this.btnRepeat.classList.remove('active');
                    this.btnRepeat.title = 'リピート: なし';
                    break;
                case 'all':
                    this.btnRepeat.textContent = '🔁';
                    this.btnRepeat.classList.add('active');
                    this.btnRepeat.title = 'リピート: 全曲';
                    break;
                case 'one':
                    this.btnRepeat.textContent = '🔂';
                    this.btnRepeat.classList.add('active');
                    this.btnRepeat.title = 'リピート: 1曲';
                    break;
            }
        }
    }

    /**
     * 再生モードに応じてxmlTADを更新
     * シャッフル: <while> + <random> 構造
     * リピート: <while> 構造または loop属性
     */
    async updateXtadForPlaybackMode() {
        try {
            // 現在のxtadを取得
            let xtadContent = null;
            if (this.fileData) {
                xtadContent = this.fileData.xmlData ||
                              this.fileData.records?.[0]?.xtad ||
                              this.fileData.records?.[0]?.data;
            }

            if (!xtadContent) return;

            const parser = new DOMParser();
            const doc = parser.parseFromString(xtadContent, 'text/xml');

            const realDataEl = doc.querySelector('realData');
            if (!realDataEl) return;

            // 既存の<while>と<random>を削除してメディア要素を直接配置
            this._unwrapControlElements(realDataEl);

            // メディア要素を取得
            const mediaElements = Array.from(realDataEl.querySelectorAll('audio, video'));
            if (mediaElements.length === 0) return;

            // シャッフルモードの場合: <while> + <random> で囲む
            if (this.controller.shuffleMode) {
                this._wrapWithShuffleStructure(doc, realDataEl, mediaElements);
            }
            // リピート全曲モードの場合: <while> で囲む
            else if (this.controller.repeatMode === 'all') {
                this._wrapWithRepeatAllStructure(doc, realDataEl, mediaElements);
            }
            // リピート1曲モードの場合: loop属性を設定
            else if (this.controller.repeatMode === 'one') {
                this._setLoopAttributes(mediaElements, true);
            }
            // それ以外: 通常の順次再生構造
            else {
                this._setSequentialPlayback(mediaElements);
            }

            // XMLをシリアライズして保存
            const serializer = new XMLSerializer();
            let newXtadContent = serializer.serializeToString(doc);
            newXtadContent = newXtadContent.replace(/<\?xml[^?]*\?>\s*/g, '');

            // XMLを整形（各要素を改行で区切る）
            newXtadContent = this._formatXmlOutput(newXtadContent);

            // xml-data-changedで保存
            logger.debug('[PlayerApp] xmlTAD更新:', this.controller.shuffleMode ? 'シャッフル' : this.controller.repeatMode);
            this.messageBus.send('xml-data-changed', {
                windowId: this.windowId,
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
        } catch (error) {
            logger.error('[PlayerApp] xmlTAD更新エラー:', error);
        }
    }

    /**
     * <while>と<random>要素を削除してメディア要素を直接配置
     */
    _unwrapControlElements(realDataEl) {
        // まず全てのメディア要素を収集（ネスト構造に関係なく）
        const allMediaElements = Array.from(realDataEl.querySelectorAll('audio, video'));

        // <random>要素を削除
        const randomEls = realDataEl.querySelectorAll('random');
        randomEls.forEach(randomEl => randomEl.remove());

        // <while>要素を削除
        const whileEls = realDataEl.querySelectorAll('while');
        whileEls.forEach(whileEl => whileEl.remove());

        // <label>要素を削除
        const labelEls = realDataEl.querySelectorAll('label');
        labelEls.forEach(el => el.remove());

        // メディア要素をrealDataElに直接追加
        allMediaElements.forEach(media => {
            media.removeAttribute('loop');
            realDataEl.appendChild(media);
        });
    }

    /**
     * シャッフル再生用の<while> + <random>構造でラップ
     */
    _wrapWithShuffleStructure(doc, realDataEl, mediaElements) {
        // <while>要素を作成
        const whileEl = doc.createElement('while');
        const doEl = doc.createElement('do');

        // <random>要素を作成
        const randomEl = doc.createElement('random');
        randomEl.setAttribute('exclude', 'last');

        // メディア要素を<random>に移動
        mediaElements.forEach(media => {
            // autoplayとonendedを設定
            media.setAttribute('autoplay', 'true');
            media.setAttribute('onended', 'jump:loop_end');
            media.removeAttribute('trigger');
            randomEl.appendChild(media);
        });

        // <label>要素を作成
        const labelEl = doc.createElement('label');
        labelEl.setAttribute('id', 'loop_end');

        // 構造を組み立て
        doEl.appendChild(randomEl);
        doEl.appendChild(labelEl);
        whileEl.appendChild(doEl);
        realDataEl.appendChild(whileEl);
    }

    /**
     * 全曲リピート用の<while>構造でラップ
     */
    _wrapWithRepeatAllStructure(doc, realDataEl, mediaElements) {
        // <while>要素を作成
        const whileEl = doc.createElement('while');
        const doEl = doc.createElement('do');

        // メディア要素を順次再生するように設定
        for (let i = 0; i < mediaElements.length; i++) {
            const media = mediaElements[i];

            if (i === 0) {
                media.setAttribute('autoplay', 'true');
                media.removeAttribute('trigger');
            } else {
                media.setAttribute('trigger', 'manual');
                media.removeAttribute('autoplay');
            }

            if (i < mediaElements.length - 1) {
                media.setAttribute('onended', `play:${mediaElements[i + 1].id}`);
            } else {
                // 最後のトラックはloop_endにジャンプ
                media.setAttribute('onended', 'jump:loop_end');
            }

            doEl.appendChild(media);
        }

        // <label>要素を作成
        const labelEl = doc.createElement('label');
        labelEl.setAttribute('id', 'loop_end');
        doEl.appendChild(labelEl);

        whileEl.appendChild(doEl);
        realDataEl.appendChild(whileEl);
    }

    /**
     * メディア要素にloop属性を設定（1曲リピート用）
     */
    _setLoopAttributes(mediaElements, enable) {
        mediaElements.forEach(media => {
            if (enable) {
                media.setAttribute('loop', 'true');
            } else {
                media.removeAttribute('loop');
            }
        });
        // 通常の順次再生も設定
        this._setSequentialPlayback(mediaElements);
    }

    /**
     * 通常の順次再生用にonendedを設定
     */
    _setSequentialPlayback(mediaElements) {
        for (let i = 0; i < mediaElements.length; i++) {
            const media = mediaElements[i];

            if (i === 0) {
                media.setAttribute('autoplay', 'false');
                media.removeAttribute('trigger');
            } else {
                media.setAttribute('trigger', 'manual');
                media.removeAttribute('autoplay');
            }

            if (i < mediaElements.length - 1) {
                media.setAttribute('onended', `play:${mediaElements[i + 1].id}`);
            } else {
                media.removeAttribute('onended');
            }
        }
    }

    /**
     * XML出力を整形（各要素を改行で区切る、インデントなし）
     * @param {string} xml - 整形前のXML文字列
     * @returns {string} 整形後のXML文字列
     */
    _formatXmlOutput(xml) {
        // 各要素を改行で区切る（インデントなし）
        let formatted = xml
            // 開始タグの後に改行
            .replace(/(<(tad|realtime|realData|while|do|random)[^>]*>)(?![\r\n])/g, '$1\n')
            // 終了タグの前に改行
            .replace(/([^\r\n])(<\/(tad|realtime|realData|while|do|random)>)/g, '$1\n$2')
            // 終了タグの後に改行
            .replace(/(<\/(tad|realtime|realData|while|do|random)>)(?![\r\n])/g, '$1\n')
            // audio/video/label/stream要素を個別の行に
            .replace(/(<(audio|video|label|stream)[^>]*\/>)/g, '\n$1')
            .replace(/(<(audio|video|label)[^>]*>)/g, '\n$1')
            // stream開始タグの後に改行
            .replace(/(<stream[^>]*>)(?![\r\n])/g, '$1\n')
            // stream終了タグの前に改行
            .replace(/([^\r\n])(<\/stream>)/g, '$1\n$2')
            // stream終了タグの後に改行
            .replace(/(<\/stream>)(?![\r\n])/g, '$1\n')
            // 連続する改行を1つに
            .replace(/\n{2,}/g, '\n')
            // 先頭・末尾の改行を削除
            .replace(/^\n+/, '')
            .replace(/\n+$/, '');

        return formatted;
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
