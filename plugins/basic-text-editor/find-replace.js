/**
 * 検索/置換ウィンドウ
 * basic-text-editorの子ウィンドウとして動作
 * @module plugins/basic-text-editor/find-replace
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */

class FindReplaceWindow {
    constructor() {
        this.messageBus = null;
        this.editorWindowId = null;

        this.init();
    }

    init() {
        // MessageBus初期化
        this.messageBus = new window.MessageBus({
            debug: false,
            pluginName: 'FindReplaceWindow',
            mode: 'child'
        });
        this.messageBus.start();

        // UI要素の取得
        this.searchInput = document.getElementById('searchText');
        this.replaceInput = document.getElementById('replaceText');
        this.regexCheckbox = document.getElementById('regexMode');
        this.findBtn = document.getElementById('findBtn');
        this.replaceBtn = document.getElementById('replaceBtn');
        this.replaceAllBtn = document.getElementById('replaceAllBtn');

        // イベントリスナー設定
        this.setupEventListeners();

        // 親からのメッセージを待機
        this.setupMessageHandlers();

        // 検索入力にフォーカス
        setTimeout(() => {
            this.searchInput.focus();
        }, 100);
    }

    setupEventListeners() {
        // 検索ボタン
        this.findBtn.addEventListener('click', () => {
            this.sendFindRequest();
        });

        // 置換ボタン
        this.replaceBtn.addEventListener('click', () => {
            this.sendReplaceRequest();
        });

        // 全置換ボタン
        this.replaceAllBtn.addEventListener('click', () => {
            this.sendReplaceAllRequest();
        });

        // Enterキーで検索
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendFindRequest();
            }
        });

        // 置換入力でEnterキー
        this.replaceInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendReplaceRequest();
            }
        });

        // Escapeキーでウィンドウを閉じる
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeWindow();
            }
        });
    }

    setupMessageHandlers() {
        // 右クリックメニュー定義（空のメニューを返す）
        this.messageBus.on('get-menu-definition', (data) => {
            this.messageBus.send('menu-definition-response', {
                messageId: data.messageId,
                menuDefinition: []
            });
        });

        // 初期化メッセージ
        this.messageBus.on('init-find-replace', (data) => {
            this.editorWindowId = data.editorWindowId;

            // 初期検索文字列がある場合は設定
            if (data.initialSearchText) {
                this.searchInput.value = data.initialSearchText;
            }
        });

        // 検索結果
        this.messageBus.on('find-result', (data) => {
            if (!data.found) {
                // 見つからなかった場合、検索入力欄を点滅など視覚的フィードバック
                this.searchInput.style.backgroundColor = '#ffcccc';
                setTimeout(() => {
                    this.searchInput.style.backgroundColor = '';
                }, 300);
            }
        });
    }

    sendFindRequest() {
        const searchText = this.searchInput.value;
        if (!searchText) return;

        this.messageBus.send('find-next', {
            searchText: searchText,
            isRegex: this.regexCheckbox.checked,
            editorWindowId: this.editorWindowId
        });
    }

    sendReplaceRequest() {
        const searchText = this.searchInput.value;
        if (!searchText) return;

        this.messageBus.send('replace-next', {
            searchText: searchText,
            replaceText: this.replaceInput.value,
            isRegex: this.regexCheckbox.checked,
            editorWindowId: this.editorWindowId
        });
    }

    sendReplaceAllRequest() {
        const searchText = this.searchInput.value;
        if (!searchText) return;

        this.messageBus.send('replace-all', {
            searchText: searchText,
            replaceText: this.replaceInput.value,
            isRegex: this.regexCheckbox.checked,
            editorWindowId: this.editorWindowId
        });
    }

    closeWindow() {
        this.messageBus.send('close-window', {});
    }
}

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    new FindReplaceWindow();
});
