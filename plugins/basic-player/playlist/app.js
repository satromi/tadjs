/**
 * プレイリスト表示ウィンドウ
 * basic-playerのサブウィンドウとして動作
 */
class PlaylistViewerApp {
    constructor() {
        this.tracks = [];
        this.currentIndex = -1;
        this.parentPlayerWindowId = null;
        this.windowId = null;
        this.messageBus = null;

        this.init();
    }

    async init() {
        // MessageBusの初期化を待つ
        await this.waitForMessageBus();
        this.setupMessageBusHandlers();
        this.setupContextMenu();

        // 親ウィンドウにready信号を送信（initメッセージを要求）
        window.parent.postMessage({ type: 'iframe-ready' }, '*');
    }

    async waitForMessageBus() {
        return new Promise((resolve) => {
            const check = () => {
                if (window.MessageBus) {
                    this.messageBus = new window.MessageBus({ pluginName: 'PlaylistViewer' });
                    this.messageBus.start();
                    resolve();
                } else {
                    setTimeout(check, 50);
                }
            };
            check();
        });
    }

    setupMessageBusHandlers() {
        // 初期化メッセージ
        this.messageBus.on('init', (data) => {
            this.windowId = data.windowId;

            if (data.fileData) {
                this.tracks = data.fileData.tracks || [];
                this.currentIndex = data.fileData.currentIndex ?? -1;
                this.parentPlayerWindowId = data.fileData.parentWindowId;
            }

            this.renderPlaylist();

            // スクロールバー連携を設定
            this.setupScrollbarIntegration();
        });

        // トラック変更通知（basic-playerからのブロードキャスト）
        this.messageBus.on('track-changed', (data) => {
            if (data.sourceWindowId === this.parentPlayerWindowId) {
                this.currentIndex = data.index;
                this.updatePlayingState();
            }
        });

        // ウィンドウクローズ要求
        this.messageBus.on('window-close-request', () => {
            this.messageBus.send('close-window', { windowId: this.windowId });
        });

        // メニュー定義要求（空のメニューを返す）
        this.messageBus.on('get-menu-definition', (data) => {
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: []
            });
        });

        // スクロール位置設定要求（親からのスクロールバードラッグ）
        this.messageBus.on('set-scroll-position', (data) => {
            if (data.windowId === this.windowId) {
                const container = document.getElementById('pluginContent');
                if (container) {
                    if (typeof data.scrollTop === 'number') {
                        container.scrollTop = data.scrollTop;
                    }
                    if (typeof data.scrollLeft === 'number') {
                        container.scrollLeft = data.scrollLeft;
                    }
                }
            }
        });
    }

    /**
     * スクロールバー連携を設定
     * 親ウィンドウのカスタムスクロールバーと連携するためのスクロール状態通知を設定
     */
    setupScrollbarIntegration() {
        const container = document.getElementById('pluginContent');
        if (!container) return;

        // スクロール状態を親に送信
        const sendScrollState = () => {
            if (!this.windowId) return;

            this.messageBus.send('scroll-state-update', {
                windowId: this.windowId,
                scrollTop: container.scrollTop,
                scrollLeft: container.scrollLeft,
                scrollHeight: container.scrollHeight,
                scrollWidth: container.scrollWidth,
                clientHeight: container.clientHeight,
                clientWidth: container.clientWidth
            });
        };

        // スクロールイベントでthrottle送信
        let scrollTimer = null;
        container.addEventListener('scroll', () => {
            if (scrollTimer) return;
            scrollTimer = setTimeout(() => {
                scrollTimer = null;
                sendScrollState();
            }, 16);
        });

        // 初期スクロール状態を送信
        sendScrollState();
    }

    setupContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            // 右クリックメニューは親ウィンドウに委譲
            const iframeRect = window.frameElement?.getBoundingClientRect() || { left: 0, top: 0 };
            this.messageBus.send('context-menu-request', {
                windowId: this.windowId,
                x: e.clientX + iframeRect.left,
                y: e.clientY + iframeRect.top
            });
        });
    }

    renderPlaylist() {
        const headerEl = document.getElementById('playlistHeader');
        const listEl = document.getElementById('playlistList');

        headerEl.textContent = `プレイリスト: ${this.tracks.length} 曲`;

        listEl.innerHTML = '';

        if (this.tracks.length === 0) {
            listEl.innerHTML = '<div class="empty-message">トラックがありません</div>';
            return;
        }

        this.tracks.forEach((track, index) => {
            const row = this.createTrackRow(track, index);
            listEl.appendChild(row);
        });
    }

    createTrackRow(track, index) {
        const row = document.createElement('div');
        row.className = 'track-row';
        row.dataset.index = index;

        if (index === this.currentIndex) {
            row.classList.add('playing');
        }

        // トラック番号
        const numberEl = document.createElement('span');
        numberEl.className = 'track-number';
        numberEl.textContent = String(index + 1);

        // トラック名（titleがあればそれを、なければファイル名）
        const nameEl = document.createElement('span');
        nameEl.className = 'track-name';
        nameEl.textContent = track.title || this.getFileNameFromHref(track.href);

        row.appendChild(numberEl);
        row.appendChild(nameEl);

        // クリックで再生
        row.addEventListener('click', () => this.selectTrack(index));

        return row;
    }

    getFileNameFromHref(href) {
        if (!href) return '(不明)';
        const parts = href.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1];
    }

    selectTrack(index) {
        if (!this.parentPlayerWindowId) return;

        // 親ウィンドウ経由でbasic-playerにトラック再生を要求
        this.messageBus.send('relay-to-window', {
            targetWindowId: this.parentPlayerWindowId,
            messageType: 'play-track-request',
            messageData: { index: index }
        });

        // 即座に見た目を更新（実際の再生は非同期）
        this.currentIndex = index;
        this.updatePlayingState();
    }

    updatePlayingState() {
        const rows = document.querySelectorAll('.track-row');
        rows.forEach((row, i) => {
            row.classList.toggle('playing', i === this.currentIndex);
        });
    }
}

window.playlistApp = new PlaylistViewerApp();
