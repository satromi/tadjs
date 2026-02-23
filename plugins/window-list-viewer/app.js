/**
 * WindowListViewer - ウインドウ一覧プラグイン
 * 開いているウインドウの一覧を表示し、クリックでアクティブ化する
 */

const logger = window.getLogger('WindowListViewer');

class WindowListViewer extends window.PluginBase {
    constructor() {
        super('WindowListViewer');
        this.windowList = [];
        this.init();
    }

    init() {
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }
        this.setupContextMenu();
        this.setupWindowActivation();
    }

    setupMessageBusHandlers() {
        this.setupCommonMessageBusHandlers();

        this.messageBus.on('init', (data) => {
            this.onInit(data);
            this.requestWindowList();
        });

        this.messageBus.on('window-list-response', (data) => {
            this.windowList = data.windows || [];
            this.renderWindowList();
        });

        this.messageBus.on('window-activated', () => {
            this.requestWindowList();
        });

        this.messageBus.on('window-deactivated', () => {
            this.requestWindowList();
        });
    }

    requestWindowList() {
        this.messageBus.send('get-window-list', {});
    }

    renderWindowList() {
        const container = document.getElementById('window-list');
        container.innerHTML = '';

        // 自身のウインドウを除外
        const filteredList = this.windowList.filter(win => win.windowId !== this.windowId);

        if (filteredList.length === 0) {
            const msg = document.createElement('div');
            msg.className = 'empty-message';
            msg.textContent = '開いているウインドウはありません';
            container.appendChild(msg);
            return;
        }

        filteredList.forEach(win => {
            const item = document.createElement('div');
            item.className = 'window-item' + (win.isActive ? ' active' : '');

            const title = document.createElement('span');
            title.className = 'window-title';
            title.textContent = win.title;
            item.appendChild(title);

            // mousedownのstopPropagationでsetupWindowActivation()による自身アクティブ化を防止
            item.addEventListener('mousedown', (e) => {
                e.stopPropagation();
            });
            item.addEventListener('click', () => {
                // activeクラスを即時更新（視覚的フィードバック）
                container.querySelectorAll('.window-item.active').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                this.messageBus.send('activate-window', { windowId: win.windowId });
            });
            container.appendChild(item);
        });
    }

    getMenuDefinition() {
        return [];
    }

    executeMenuAction(action) {
        // メニューアクションなし
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.windowListViewer = new WindowListViewer();
});
