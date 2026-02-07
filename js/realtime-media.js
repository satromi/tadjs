/**
 * 実時間制御xmlTADパーサーおよびメディア管理
 * basic-playerおよびbasic-slideプラグインで共通使用
 *
 * @module realtime-media
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */

// ============================================================
// RealtimeTadParser - 実時間制御xmlTADパーサー
// ============================================================
export class RealtimeTadParser {
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
            media: this._extractAllMedia(realtimeEl),
            playbackMode: this._detectPlaybackMode(realtimeEl),
            timeline: this._parseTimeline(realtimeEl)
        };
    }

    /**
     * 再生モードを検出（<while>/<random>/loop属性から判定）
     * @param {Element} realtimeEl - realtime要素
     * @returns {Object} { shuffleMode: boolean, repeatMode: 'none'|'all'|'one' }
     */
    _detectPlaybackMode(realtimeEl) {
        const result = {
            shuffleMode: false,
            repeatMode: 'none'
        };

        // <random>要素があればシャッフルモード
        const randomEl = realtimeEl.querySelector('random');
        if (randomEl) {
            result.shuffleMode = true;
        }

        // <while>要素があればリピートモード（シャッフルと併用可能）
        const whileEl = realtimeEl.querySelector('while');
        if (whileEl) {
            result.repeatMode = 'all';
        }

        // メディア要素にloop="true"があれば1曲リピート（<while>がない場合のみ）
        const mediaWithLoop = realtimeEl.querySelector('audio[loop="true"], video[loop="true"]');
        if (mediaWithLoop && !whileEl) {
            result.repeatMode = 'one';
        }

        return result;
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
            id: el.getAttribute('id') || `video-${Date.now()}-${RealtimeTadParser._idCounter++}`,
            href: el.getAttribute('href'),
            format: el.getAttribute('format'),
            autoplay: el.getAttribute('autoplay') !== 'false',
            preload: el.getAttribute('preload') || 'auto',
            trigger: el.getAttribute('trigger') || 'time',
            onended: el.getAttribute('onended') || null,
            poster: el.getAttribute('poster'),
            volume: parseFloat(el.getAttribute('volume') || '1.0'),
            playbackRate: parseFloat(el.getAttribute('playbackRate') || '1.0'),
            startTime: parseFloat(el.getAttribute('startTime') || '0'),
            duration: parseFloat(el.getAttribute('duration') || '0'),
            loop: el.getAttribute('loop') === 'true',
            loopStart: parseFloat(el.getAttribute('loopStart') || '0'),
            loopEnd: parseFloat(el.getAttribute('loopEnd') || '0'),
            muted: el.getAttribute('muted') === 'true',
            // トラック情報属性
            title: el.getAttribute('title') || null,
            artist: el.getAttribute('artist') || null,
            album: el.getAttribute('album') || null,
            trackNumber: el.getAttribute('trackNumber') ? parseInt(el.getAttribute('trackNumber'), 10) : null,
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
            id: el.getAttribute('id') || `audio-${Date.now()}-${RealtimeTadParser._idCounter++}`,
            href: el.getAttribute('href'),
            format: el.getAttribute('format'),
            autoplay: el.getAttribute('autoplay') !== 'false',
            preload: el.getAttribute('preload') || 'auto',
            trigger: el.getAttribute('trigger') || 'time',
            onended: el.getAttribute('onended') || null,
            volume: parseFloat(el.getAttribute('volume') || '1.0'),
            pan: parseFloat(el.getAttribute('pan') || '0.0'),
            playbackRate: parseFloat(el.getAttribute('playbackRate') || '1.0'),
            startTime: parseFloat(el.getAttribute('startTime') || '0'),
            duration: parseFloat(el.getAttribute('duration') || '0'),
            loop: el.getAttribute('loop') === 'true',
            loopStart: parseFloat(el.getAttribute('loopStart') || '0'),
            loopEnd: parseFloat(el.getAttribute('loopEnd') || '0'),
            fadeIn: parseFloat(el.getAttribute('fadeIn') || '0'),
            fadeOut: parseFloat(el.getAttribute('fadeOut') || '0'),
            // トラック情報属性
            title: el.getAttribute('title') || null,
            artist: el.getAttribute('artist') || null,
            album: el.getAttribute('album') || null,
            trackNumber: el.getAttribute('trackNumber') ? parseInt(el.getAttribute('trackNumber'), 10) : null
        };
    }

    /**
     * タイムラインイベントをパース
     * @param {Element} realtimeEl - realtime要素
     * @returns {Array} タイムラインイベントの配列
     */
    _parseTimeline(realtimeEl) {
        const timeline = [];
        const realDataEl = realtimeEl.querySelector('realData');
        if (!realDataEl) return timeline;

        let currentTime = 0;

        // realData内の要素を順番に処理
        const children = realDataEl.children;
        for (const child of children) {
            const tagName = child.tagName.toLowerCase();

            if (tagName === 'timedelta') {
                currentTime += parseInt(child.getAttribute('value') || '0', 10);
            } else if (tagName === 'timeabsolute') {
                currentTime = parseInt(child.getAttribute('value') || '0', 10);
            } else if (tagName === 'realgroup') {
                const groupTimeline = this._parseRealGroup(child, currentTime);
                timeline.push(...groupTimeline);
            } else if (tagName === 'videocontrol') {
                timeline.push({
                    time: currentTime,
                    type: 'videoControl',
                    target: child.getAttribute('target') || child.getAttribute('ref'),
                    action: child.getAttribute('action') || child.getAttribute('command'),
                    value: child.getAttribute('value')
                });
            } else if (tagName === 'audiocontrol') {
                timeline.push({
                    time: currentTime,
                    type: 'audioControl',
                    target: child.getAttribute('target') || child.getAttribute('ref'),
                    action: child.getAttribute('action') || child.getAttribute('command'),
                    value: child.getAttribute('value')
                });
            } else if (tagName === 'imagecontrol') {
                timeline.push({
                    time: currentTime,
                    type: 'imageControl',
                    target: child.getAttribute('ref'),
                    command: child.getAttribute('command'),
                    value: child.getAttribute('value'),
                    left: child.getAttribute('left'),
                    top: child.getAttribute('top'),
                    right: child.getAttribute('right'),
                    bottom: child.getAttribute('bottom')
                });
            } else if (tagName === 'label') {
                timeline.push({
                    time: currentTime,
                    type: 'label',
                    id: child.getAttribute('id')
                });
            }
        }

        return timeline;
    }

    /**
     * realGroup内のイベントをパース
     */
    _parseRealGroup(groupEl, baseTime) {
        const events = [];
        let currentTime = baseTime;

        // realGroup内のtimeDeltaを処理
        const timeDeltaEl = groupEl.querySelector('timeDelta');
        if (timeDeltaEl) {
            currentTime += parseInt(timeDeltaEl.getAttribute('value') || '0', 10);
        }

        // interpolate要素を処理
        const interpolateEl = groupEl.querySelector('interpolate');
        if (interpolateEl) {
            const func = interpolateEl.getAttribute('function') || 'linear';
            const divisions = parseInt(interpolateEl.getAttribute('divisions') || '10', 10);
            const controls = [];

            for (const child of interpolateEl.children) {
                controls.push({
                    target: child.getAttribute('ref'),
                    command: child.getAttribute('command'),
                    value: child.getAttribute('value'),
                    left: child.getAttribute('left'),
                    top: child.getAttribute('top'),
                    right: child.getAttribute('right'),
                    bottom: child.getAttribute('bottom')
                });
            }

            if (controls.length >= 2) {
                events.push({
                    time: currentTime,
                    type: 'interpolate',
                    function: func,
                    divisions: divisions,
                    controlType: interpolateEl.children[0]?.tagName.toLowerCase(),
                    from: controls[0],
                    to: controls[controls.length - 1]
                });
            }
        }

        // video/audioをグループ内から抽出
        groupEl.querySelectorAll('video, audio').forEach(el => {
            events.push({
                time: currentTime,
                type: 'mediaStart',
                mediaId: el.getAttribute('id'),
                mediaType: el.tagName.toLowerCase()
            });
        });

        return events;
    }
}

// ID衝突防止用カウンター
RealtimeTadParser._idCounter = 0;

// ============================================================
// TimelineEngine - タイムラインアニメーションエンジン
// ============================================================
export class TimelineEngine {
    constructor(plugin) {
        this.plugin = plugin;
        this.timers = [];           // setTimeout IDs
        this.animations = [];       // requestAnimationFrame IDs
        this.elementCache = new Map(); // ref → DOM要素のキャッシュ
        this.running = false;
    }

    /**
     * タイムラインを実行
     * @param {Array} timeline - RealtimeTadParser.parse()のtimeline配列
     */
    execute(timeline) {
        if (!timeline || timeline.length === 0) return;

        this.running = true;
        this.elementCache.clear();

        // 時間順にソート
        const sortedEvents = [...timeline].sort((a, b) => a.time - b.time);

        // interpolateイベントの初期値を適用（フェードイン等のために開始前は非表示にする）
        for (const event of sortedEvents) {
            if (event.type === 'interpolate' && event.from) {
                const target = event.from.target;
                const element = this._findElementByRef(target);
                if (element) {
                    this._applyPropertyChange(element, event.from.command, parseFloat(event.from.value));
                }
            }
        }

        // 各イベントをスケジュール
        for (const event of sortedEvents) {
            const timerId = setTimeout(() => {
                if (!this.running) return;
                this._processEvent(event);
            }, event.time);
            this.timers.push(timerId);
        }
    }

    /**
     * 個別イベントを処理
     */
    _processEvent(event) {
        switch (event.type) {
            case 'interpolate':
                this._processInterpolate(event);
                break;
            case 'videoControl':
            case 'audioControl':
                this._processMediaControl(event);
                break;
            case 'imageControl':
            case 'textControl':
            case 'shapeControl':
                this._processElementControl(event);
                break;
            case 'mediaStart':
                this._processMediaStart(event);
                break;
        }
    }

    /**
     * interpolateアニメーションを処理
     */
    _processInterpolate(event) {
        const { from, to, divisions, controlType } = event;
        if (!from || !to) return;

        const target = from.target || to.target;
        const element = this._findElementByRef(target);
        if (!element) return;

        const command = from.command || to.command;
        const fromValue = parseFloat(from.value);
        const toValue = parseFloat(to.value);
        const easingFn = this._getEasingFunction(event.function);

        // divisions回のステップでアニメーション
        const duration = divisions * (1000 / 60); // 約60fpsを想定
        const startTime = performance.now();

        // アニメーション用スロットを確保（IDの蓄積を防ぐ）
        const animIndex = this.animations.length;
        const animate = (currentTime) => {
            if (!this.running) return;

            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easingFn(progress);

            const currentValue = fromValue + (toValue - fromValue) * easedProgress;
            this._applyPropertyChange(element, command, currentValue);

            if (progress < 1) {
                this.animations[animIndex] = requestAnimationFrame(animate);
            }
        };

        this.animations[animIndex] = requestAnimationFrame(animate);
    }

    /**
     * メディア制御を処理
     */
    _processMediaControl(event) {
        const { target, action, value } = event;

        // mediaManagerから要素を取得
        if (this.plugin && this.plugin.mediaManager) {
            const media = this.plugin.mediaManager.getMediaById(target);
            if (media) {
                switch (action) {
                    case 'play':
                        media.play().catch(e => { if (e.name !== 'AbortError') console.warn('[RealtimeMedia] play失敗:', e.name); });
                        break;
                    case 'pause':
                        media.pause();
                        break;
                    case 'stop':
                        media.pause();
                        media.currentTime = 0;
                        break;
                    case 'seek':
                        media.currentTime = parseFloat(value) / 1000; // msec to sec
                        break;
                    case 'setVolume':
                        media.volume = Math.max(0, Math.min(1, parseFloat(value) || 0));
                        break;
                    case 'fadeout':
                    case 'fadeOut':
                        this._fadeMedia(media, media.volume, 0, parseFloat(value) || 1000);
                        break;
                    case 'fadein':
                    case 'fadeIn':
                        this._fadeMedia(media, 0, parseFloat(value) || 1, parseFloat(event.duration) || 1000);
                        break;
                }
            }
        }
    }

    /**
     * メディアのフェード処理
     */
    _fadeMedia(media, fromVolume, toVolume, duration) {
        const startTime = performance.now();
        const startVolume = fromVolume;

        // アニメーション用スロットを確保（IDの蓄積を防ぐ）
        const animIndex = this.animations.length;
        const animate = (currentTime) => {
            if (!this.running) return;

            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            media.volume = Math.max(0, Math.min(1, startVolume + (toVolume - startVolume) * progress));

            if (progress < 1) {
                this.animations[animIndex] = requestAnimationFrame(animate);
            } else if (toVolume === 0) {
                media.pause();
            }
        };

        this.animations[animIndex] = requestAnimationFrame(animate);
    }

    /**
     * 要素制御を処理（textControl/shapeControl/imageControl）
     */
    _processElementControl(event) {
        const target = event.target;
        const element = this._findElementByRef(target);
        if (!element) return;

        const value = parseFloat(event.value);
        this._applyPropertyChange(element, event.command, value);
    }

    /**
     * メディア開始を処理
     */
    _processMediaStart(event) {
        if (this.plugin && this.plugin.mediaManager) {
            const media = this.plugin.mediaManager.getMediaById(event.mediaId);
            if (media) {
                media.play().catch(e => { if (e.name !== 'AbortError') console.warn('[RealtimeMedia] play失敗:', e.name); });
            }
        }
    }

    /**
     * ref属性で要素を検索
     */
    _findElementByRef(ref) {
        if (!ref) return null;

        // キャッシュチェック
        if (this.elementCache.has(ref)) {
            return this.elementCache.get(ref);
        }

        // エディタ内を検索（id属性またはdata-id属性）
        let element = null;

        if (this.plugin && this.plugin.editor) {
            // id属性で検索
            element = this.plugin.editor.querySelector(`[id="${ref}"]`);

            // data-id属性で検索
            if (!element) {
                element = this.plugin.editor.querySelector(`[data-id="${ref}"]`);
            }

            // textタグのid属性で検索（documentセグメント内）
            if (!element) {
                const textEl = this.plugin.editor.querySelector(`text[id="${ref}"]`);
                if (textEl) {
                    // textタグを含むdocumentセグメントのコンテナを取得
                    element = textEl.closest('.document-segment') || textEl.parentElement;
                }
            }

            // figureセグメント内の図形を検索
            if (!element) {
                element = this.plugin.editor.querySelector(`.figure-segment [data-id="${ref}"]`);
            }
        }

        if (element) {
            this.elementCache.set(ref, element);
        }

        return element;
    }

    /**
     * プロパティ変更を適用
     */
    _applyPropertyChange(element, command, value) {
        if (!element || !command) return;

        switch (command) {
            case 'setAlpha':
                element.style.opacity = value;
                break;
            case 'setScale':
                const currentTransform = element.style.transform || '';
                const scaleRegex = /scale\([^)]+\)/;
                const newScale = `scale(${value})`;
                if (scaleRegex.test(currentTransform)) {
                    element.style.transform = currentTransform.replace(scaleRegex, newScale);
                } else {
                    element.style.transform = currentTransform + ' ' + newScale;
                }
                break;
            case 'setRotation':
                const curTransform = element.style.transform || '';
                const rotateRegex = /rotate\([^)]+\)/;
                const newRotate = `rotate(${value}deg)`;
                if (rotateRegex.test(curTransform)) {
                    element.style.transform = curTransform.replace(rotateRegex, newRotate);
                } else {
                    element.style.transform = curTransform + ' ' + newRotate;
                }
                break;
            case 'setPositionX':
                element.style.left = `${value}px`;
                break;
            case 'setPositionY':
                element.style.top = `${value}px`;
                break;
            case 'setVisibility':
                element.style.visibility = value > 0.5 ? 'visible' : 'hidden';
                break;
        }
    }

    /**
     * イージング関数を取得
     */
    _getEasingFunction(name) {
        switch (name) {
            case 'easeIn':
                return t => t * t;
            case 'easeOut':
                return t => t * (2 - t);
            case 'easeInOut':
                return t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            case 'linear':
            default:
                return t => t;
        }
    }

    /**
     * アニメーション停止
     */
    stop() {
        this.running = false;
        this.timers.forEach(id => clearTimeout(id));
        this.animations.forEach(id => cancelAnimationFrame(id));
        this.timers = [];
        this.animations = [];
    }

    /**
     * クリーンアップ
     */
    clear() {
        this.stop();
        this.elementCache.clear();
    }
}

// ============================================================
// SlideMediaManager - スライド用メディア要素管理
// ============================================================
export class SlideMediaManager {
    constructor(container, plugin) {
        this.container = container;
        this.plugin = plugin;
        this.elements = new Map();
        this.basePath = '';
        this.scale = 1.0;
        this.timeoutIds = [];
    }

    /**
     * ベースパスを設定
     */
    setBasePath(basePath) {
        this.basePath = basePath;
    }

    /**
     * スケールを設定
     */
    setScale(scale) {
        this.scale = scale;
        this._applyScaleToElements();
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

        // 配置データを保存（スケーリング用）
        video.dataset.left = videoData.left;
        video.dataset.top = videoData.top;
        video.dataset.right = videoData.right;
        video.dataset.bottom = videoData.bottom;

        // ソース設定
        const src = await this._resolvePathAsync(videoData.href);
        video.src = src;

        if (videoData.poster) {
            video.poster = await this._resolvePathAsync(videoData.poster);
        }

        // 配置スタイル（位置指定がある場合）
        if (videoData.right > 0 && videoData.bottom > 0) {
            video.classList.add('slide-media-positioned');
            this._applyPosition(video, videoData);
        }

        video.style.opacity = videoData.alpha;
        video.style.zIndex = videoData.zIndex;

        // 開始位置
        if (videoData.startTime > 0) {
            video.currentTime = videoData.startTime;
        }

        this.container.appendChild(video);
        this.elements.set(video.id, { element: video, data: videoData });

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

        // ソース設定
        const src = await this._resolvePathAsync(audioData.href);
        audio.src = src;

        // 開始位置
        if (audioData.startTime > 0) {
            audio.currentTime = audioData.startTime;
        }

        // audioは非表示
        audio.style.display = 'none';
        this.container.appendChild(audio);
        this.elements.set(audio.id, { element: audio, data: audioData });

        return audio;
    }

    /**
     * パス解決（非同期）
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
            if (this.plugin && this.plugin.getImageFilePath) {
                const filePath = await this.plugin.getImageFilePath(href);
                if (filePath) {
                    if (filePath.match(/^[A-Za-z]:\\/)) {
                        return 'file:///' + filePath.replace(/\\/g, '/');
                    } else if (filePath.startsWith('/')) {
                        return 'file://' + filePath;
                    }
                    return filePath;
                }
            }
        } catch (error) {
            // エラー時はフォールバック
        }

        // フォールバック
        return `../../../../data/${href}`;
    }

    /**
     * 位置を適用
     */
    _applyPosition(element, data) {
        const scale = this.scale;
        element.style.position = 'absolute';
        element.style.left = `${data.left * scale}px`;
        element.style.top = `${data.top * scale}px`;
        element.style.width = `${(data.right - data.left) * scale}px`;
        element.style.height = `${(data.bottom - data.top) * scale}px`;
    }

    /**
     * 全要素にスケールを適用
     */
    _applyScaleToElements() {
        this.elements.forEach(({ element, data }) => {
            if (element.tagName === 'VIDEO' && data.right > 0 && data.bottom > 0) {
                this._applyPosition(element, data);
            }
        });
    }

    /**
     * IDでメディア要素を取得
     */
    getMediaById(id) {
        const entry = this.elements.get(id);
        return entry ? entry.element : null;
    }

    /**
     * 全メディア要素を取得
     */
    getAllMedia() {
        return Array.from(this.elements.values()).map(e => e.element);
    }

    /**
     * autoplayメディアを再生
     */
    playAutoplayMedia() {
        this.elements.forEach(({ element, data }) => {
            if (data.autoplay) {
                element.play().catch(() => {
                    // autoplay制限時は無視
                });
            }
        });
    }

    /**
     * 全メディアを一時停止
     */
    pauseAll() {
        this.elements.forEach(({ element }) => {
            if (!element.paused) {
                element.pause();
            }
        });
    }

    /**
     * 全メディアを停止
     */
    stopAll() {
        this.elements.forEach(({ element }) => {
            element.pause();
            element.currentTime = 0;
        });
    }

    /**
     * 全タイムアウトをクリア
     */
    clearTimeouts() {
        this.timeoutIds.forEach(id => clearTimeout(id));
        this.timeoutIds = [];
    }

    /**
     * タイムアウトを追加
     */
    addTimeout(callback, delay) {
        const id = setTimeout(callback, delay);
        this.timeoutIds.push(id);
        return id;
    }

    /**
     * 全メディア要素をクリア
     */
    clear() {
        this.clearTimeouts();
        this.elements.forEach(({ element }) => {
            element.pause();
            element.src = '';
            element.remove();
        });
        this.elements.clear();
    }
}

// ============================================================
// MediaElementManager - basic-player用メディア要素管理（互換性維持）
// ============================================================
export class MediaElementManager extends SlideMediaManager {
    constructor(container, plugin) {
        super(container, plugin);
    }

    /**
     * video要素があるか
     */
    hasVideo() {
        return Array.from(this.elements.values()).some(e => e.element.tagName === 'VIDEO');
    }

    /**
     * audio要素のみか
     */
    hasOnlyAudio() {
        const elements = Array.from(this.elements.values());
        return elements.length > 0 && elements.every(e => e.element.tagName === 'AUDIO');
    }
}
