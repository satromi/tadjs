/**
 * 仮身ネットワークプラグイン
 * 仮身の参照関係をネットワーク図で表示
 * @module VirtualObjectNetworkApp
 * @extends PluginBase
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */
const logger = window.getLogger('VirtualObjectNetwork');

class VirtualObjectNetworkApp extends window.PluginBase {
    constructor() {
        super('VirtualObjectNetwork');

        // ネットワークデータ
        this.nodes = [];           // { id, realId, name, x, y, width, height, frcol, tbcol, chcol, chsz, depth, children }
        this.connections = [];     // { from, to }
        this.visitedRealIds = new Set();  // 循環検出用
        this.startRealId = null;   // 起点の実身ID

        // 表示設定
        this.nodeWidth = 200;
        this.nodeHeight = 30;
        this.horizontalGap = 100;
        this.verticalGap = 20;
        this.padding = 50;

        // 選択状態
        this.selectedNode = null;

        // ノード数上限（16bit）
        this.maxNodes = 65535;

        // MessageBusはPluginBaseで初期化済み

        // IconCacheManagerを初期化
        if (window.IconCacheManager && this.messageBus) {
            this.iconManager = new window.IconCacheManager(this.messageBus, '[VirtualObjectNetwork]');
        }

        this.init();
    }

    async init() {
        logger.info('[VirtualObjectNetwork] 仮身ネットワークプラグイン初期化');

        // MessageBusのハンドラを設定
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // 右クリックメニューを設定（PluginBase共通）
        this.setupContextMenu();

        // ウィンドウアクティブ化（PluginBase共通）
        this.setupWindowActivation();

        // スクロール通知初期化（MessageBus経由で親ウィンドウにスクロール状態を通知）
        this.initScrollNotification();

        // キーボードショートカットを設定
        this.setupKeyboardShortcuts();

        // SVGイベントを設定
        this.setupSvgEvents();
    }

    /**
     * MessageBusのハンドラを登録
     */
    setupMessageBusHandlers() {
        // 共通MessageBusハンドラを登録（PluginBaseで定義）
        // set-scroll-position など親ウィンドウからの制御メッセージを処理
        this.setupCommonMessageBusHandlers();

        // 初期化メッセージ
        this.messageBus.on('init', async (data) => {
            logger.info('[VirtualObjectNetwork] init受信:', data);

            // 共通初期化処理（windowId設定、スクロール状態送信）
            this.onInit(data);

            // 起点の実身IDを取得（fileData内にネストされている）
            const startRealId = data.fileData?.startRealId || data.startRealId;
            if (startRealId) {
                this.startRealId = startRealId;
                this.setStatus('ネットワークを読み込み中...');
                await this.buildNetwork(this.startRealId);
            } else {
                this.setStatus('起点の実身が指定されていません');
            }
        });

        // menu-action, get-menu-definition は setupCommonMessageBusHandlers() で登録済み
        // getMenuDefinition() と executeMenuAction() をオーバーライドして処理

        // ネットワークデータ応答
        this.messageBus.on('virtual-object-network-response', (data) => {
            this.handleNetworkResponse(data);
        });
    }

    /**
     * ネットワークデータ応答処理
     */
    handleNetworkResponse(data) {
        if (data.success && data.virtualObjects) {
            // 子ノードを処理
            this.processChildNodes(data.parentRealId, data.virtualObjects, data.depth);
        } else {
            logger.warn('[VirtualObjectNetwork] ネットワークデータ取得失敗:', data.error);
        }
    }

    /**
     * SVGイベントを設定
     */
    setupSvgEvents() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        // クリックで選択解除
        svg.addEventListener('click', (e) => {
            if (e.target === svg) {
                this.clearSelection();
            }
        });
    }

    /**
     * ネットワークを構築
     */
    async buildNetwork(startRealId) {
        this.nodes = [];
        this.connections = [];
        this.visitedRealIds.clear();

        // 起点ノードの情報を取得
        const startNodeInfo = await this.getRealObjectInfo(startRealId);
        if (!startNodeInfo) {
            this.setStatus('起点の実身情報を取得できませんでした');
            return;
        }

        // 起点ノードを追加
        const startNode = {
            id: 'node_0',
            realId: startRealId,
            name: startNodeInfo.name || '無題',
            x: this.padding,
            y: this.padding,
            width: this.nodeWidth,
            height: this.nodeHeight,
            frcol: '#000000',
            tbcol: '#e3f2fd',
            chcol: '#000000',
            chsz: 14,
            depth: 0,
            children: []
        };

        this.nodes.push(startNode);
        this.visitedRealIds.add(startRealId);

        // 起点から仮身ネットワークを走査
        await this.traverseNetwork(startNode);

        // レイアウト計算
        this.calculateLayout();

        // 描画
        this.render();

        this.setStatus(`${this.nodes.length} 個の実身を表示`);
    }

    /**
     * 実身情報を取得
     */
    async getRealObjectInfo(realId) {
        return new Promise((resolve) => {
            const messageId = this.generateMessageId('get-real-info');
            let resolved = false;
            let timeoutId = null;

            const handler = (data) => {
                if (data.messageId === messageId) {
                    if (resolved) return;
                    resolved = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    this.messageBus.off('real-object-info-response');
                    resolve(data.success ? data.info : null);
                }
            };

            this.messageBus.on('real-object-info-response', handler);
            this.messageBus.send('get-real-object-info', {
                messageId: messageId,
                realId: realId
            });

            // タイムアウト
            timeoutId = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                this.messageBus.off('real-object-info-response');
                resolve(null);
            }, 5000);
        });
    }

    /**
     * ネットワークを再帰的に走査
     */
    async traverseNetwork(parentNode) {
        // ノード数上限チェック
        if (this.nodes.length >= this.maxNodes) {
            logger.warn('[VirtualObjectNetwork] ノード数上限に達しました:', this.maxNodes);
            return;
        }

        // 親ノードのXTADから仮身リストを取得
        const virtualObjects = await this.getVirtualObjectsFromRealObject(parentNode.realId);

        if (!virtualObjects || virtualObjects.length === 0) {
            return;
        }

        for (const vobj of virtualObjects) {
            // ノード数上限チェック
            if (this.nodes.length >= this.maxNodes) {
                break;
            }

            // link_idから実身IDを抽出
            const childRealId = this.extractRealId(vobj.link_id);
            if (!childRealId) continue;

            // 循環検出
            if (this.visitedRealIds.has(childRealId)) {
                // 既存ノードへの接続のみ追加
                const existingNode = this.nodes.find(n => n.realId === childRealId);
                if (existingNode) {
                    this.connections.push({
                        from: parentNode.id,
                        to: existingNode.id
                    });
                }
                continue;
            }

            this.visitedRealIds.add(childRealId);

            // 子ノードを作成
            const childNode = {
                id: `node_${this.nodes.length}`,
                realId: childRealId,
                name: vobj.link_name || '無題',
                x: 0,
                y: 0,
                width: this.nodeWidth,
                height: this.nodeHeight,
                frcol: vobj.frcol || '#000000',
                tbcol: vobj.tbcol || '#ffffff',
                chcol: vobj.chcol || '#000000',
                chsz: vobj.chsz || 14,
                depth: parentNode.depth + 1,
                children: [],
                linkId: vobj.link_id
            };

            this.nodes.push(childNode);
            parentNode.children.push(childNode);

            // 接続を追加
            this.connections.push({
                from: parentNode.id,
                to: childNode.id
            });

            // 再帰的に子ノードを走査
            await this.traverseNetwork(childNode);
        }
    }

    /**
     * 実身から仮身リストを取得
     */
    async getVirtualObjectsFromRealObject(realId) {
        return new Promise((resolve) => {
            const messageId = this.generateMessageId('get-vobjs');
            let resolved = false;
            let timeoutId = null;

            const handler = (data) => {
                if (data.messageId === messageId) {
                    if (resolved) return;
                    resolved = true;
                    if (timeoutId) clearTimeout(timeoutId);
                    this.messageBus.off('virtual-objects-response');
                    resolve(data.success ? data.virtualObjects : []);
                }
            };

            this.messageBus.on('virtual-objects-response', handler);
            this.messageBus.send('get-virtual-objects-from-real', {
                messageId: messageId,
                realId: realId
            });

            // タイムアウト
            timeoutId = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                this.messageBus.off('virtual-objects-response');
                resolve([]);
            }, 5000);
        });
    }

    /**
     * link_idから実身IDを抽出
     */
    extractRealId(linkId) {
        if (!linkId) return null;

        // パターン: realId_recordNo.xtad
        const match = linkId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_\d+\.xtad$/i);
        if (match) {
            return match[1];
        }

        // パターン: realId のみ（UUIDのみ）
        const uuidMatch = linkId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        if (uuidMatch) {
            return uuidMatch[1];
        }

        return null;
    }

    /**
     * レイアウトを計算（階層的配置）
     */
    calculateLayout() {
        // 深さごとにノードをグループ化
        const depthGroups = {};
        for (const node of this.nodes) {
            if (!depthGroups[node.depth]) {
                depthGroups[node.depth] = [];
            }
            depthGroups[node.depth].push(node);
        }

        // 各深さでY座標を計算
        const depths = Object.keys(depthGroups).map(Number).sort((a, b) => a - b);

        for (const depth of depths) {
            const nodesAtDepth = depthGroups[depth];
            const x = this.padding + depth * (this.nodeWidth + this.horizontalGap);

            for (let i = 0; i < nodesAtDepth.length; i++) {
                const node = nodesAtDepth[i];
                node.x = x;
                node.y = this.padding + i * (this.nodeHeight + this.verticalGap);
            }
        }

        // SVGサイズを更新
        const maxX = Math.max(...this.nodes.map(n => n.x + n.width)) + this.padding;
        const maxY = Math.max(...this.nodes.map(n => n.y + n.height)) + this.padding;

        const svg = document.getElementById('network-svg');
        if (svg) {
            svg.setAttribute('width', Math.max(maxX, 800));
            svg.setAttribute('height', Math.max(maxY, 600));
        }
    }

    /**
     * ネットワークを描画
     */
    render() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        // クリア
        svg.innerHTML = '';

        // 接続線を描画（ノードより先に描画して背面に）
        for (const conn of this.connections) {
            this.renderConnection(svg, conn);
        }

        // ノードを描画
        for (const node of this.nodes) {
            this.renderNode(svg, node);
        }

        // スクロールバー更新を通知
        this.notifyScrollChange();
    }

    /**
     * 接続線を描画
     */
    renderConnection(svg, conn) {
        const fromNode = this.nodes.find(n => n.id === conn.from);
        const toNode = this.nodes.find(n => n.id === conn.to);

        if (!fromNode || !toNode) return;

        // ベジェ曲線で接続
        const startX = fromNode.x + fromNode.width;
        const startY = fromNode.y + fromNode.height / 2;
        const endX = toNode.x;
        const endY = toNode.y + toNode.height / 2;

        // 制御点
        const controlX1 = startX + (endX - startX) / 2;
        const controlY1 = startY;
        const controlX2 = startX + (endX - startX) / 2;
        const controlY2 = endY;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${startX} ${startY} C ${controlX1} ${controlY1}, ${controlX2} ${controlY2}, ${endX} ${endY}`);
        path.setAttribute('class', 'connection-line');
        path.dataset.from = conn.from;
        path.dataset.to = conn.to;

        svg.appendChild(path);
    }

    /**
     * ノードを描画（閉じた仮身として）
     */
    renderNode(svg, node) {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'vobj-node');
        g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
        g.dataset.nodeId = node.id;
        g.dataset.realId = node.realId;

        // 背景矩形
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('class', 'vobj-frame');
        rect.setAttribute('x', 0);
        rect.setAttribute('y', 0);
        rect.setAttribute('width', node.width);
        rect.setAttribute('height', node.height);
        rect.setAttribute('fill', node.tbcol);
        rect.setAttribute('stroke', node.frcol);
        g.appendChild(rect);

        // アイコンサイズと位置の計算
        const iconSize = 16;
        const iconPadding = 4;
        const iconX = iconPadding;
        const iconY = (node.height - iconSize) / 2;
        const textX = iconPadding + iconSize + 4; // アイコンの右側にテキスト

        // アイコン（SVG image要素）
        const iconImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        iconImage.setAttribute('class', 'vobj-icon');
        iconImage.setAttribute('x', iconX);
        iconImage.setAttribute('y', iconY);
        iconImage.setAttribute('width', iconSize);
        iconImage.setAttribute('height', iconSize);
        iconImage.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        g.appendChild(iconImage);

        // アイコンを非同期で読み込み
        if (this.iconManager) {
            this.iconManager.loadIcon(node.realId).then(iconData => {
                if (iconData) {
                    iconImage.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `data:image/x-icon;base64,${iconData}`);
                }
            });
        }

        // テキスト（仮身名）- アイコン分だけ右にオフセット
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('class', 'vobj-text');
        text.setAttribute('x', textX);
        text.setAttribute('y', node.height / 2 + 4);
        text.setAttribute('fill', node.chcol);
        text.setAttribute('font-size', node.chsz);
        text.textContent = this.truncateText(node.name, node.width - textX - 8, node.chsz);
        g.appendChild(text);

        // イベント設定
        g.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectNode(node);
        });

        g.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.openNode(node);
        });

        g.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectNode(node);
            // コンテキストメニュー要求を送信（共通メソッドを使用）
            this.showContextMenuAtEvent(e);
        });

        // ドラッグ設定
        g.setAttribute('draggable', 'true');
        g.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, node);
        });

        svg.appendChild(g);
    }

    /**
     * テキストを幅に収まるように切り詰め
     */
    truncateText(text, maxWidth, fontSize) {
        // 簡易計算（日本語は全角として）
        const charWidth = fontSize * 0.6;
        const maxChars = Math.floor(maxWidth / charWidth);

        if (text.length <= maxChars) {
            return text;
        }
        return text.substring(0, maxChars - 1) + '…';
    }

    /**
     * ノードを選択
     */
    selectNode(node) {
        this.clearSelection();
        this.selectedNode = node;

        const g = document.querySelector(`g[data-node-id="${node.id}"]`);
        if (g) {
            g.classList.add('selected');
        }

        // 関連する接続線をハイライト
        for (const conn of this.connections) {
            if (conn.from === node.id || conn.to === node.id) {
                const path = document.querySelector(`path[data-from="${conn.from}"][data-to="${conn.to}"]`);
                if (path) {
                    path.classList.add('highlight');
                }
            }
        }
    }

    /**
     * 選択解除
     */
    clearSelection() {
        this.selectedNode = null;

        document.querySelectorAll('.vobj-node.selected').forEach(el => {
            el.classList.remove('selected');
        });

        document.querySelectorAll('.connection-line.highlight').forEach(el => {
            el.classList.remove('highlight');
        });
    }

    /**
     * ノードを開く（ダブルクリック）
     */
    openNode(node) {
        logger.info('[VirtualObjectNetwork] ノードを開く:', node.realId, node.name);

        this.messageBus.send('open-virtual-object', {
            linkId: node.linkId || `${node.realId}_0.xtad`,
            linkName: node.name
        });
    }

    /**
     * ドラッグ開始
     */
    handleDragStart(event, node) {
        // ドラッグデータを設定（コピー用）
        const dragData = {
            type: 'virtual-object-copy',
            source: 'virtual-object-network',
            virtualObject: {
                link_id: node.linkId || `${node.realId}_0.xtad`,
                link_name: node.name,
                frcol: node.frcol,
                tbcol: node.tbcol,
                chcol: node.chcol,
                chsz: node.chsz
            }
        };

        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'copy';
    }

    /**
     * ノードをクリップボードにコピー
     */
    copyNodeToClipboard(node) {
        const clipboardData = {
            link_id: node.linkId || `${node.realId}_0.xtad`,
            link_name: node.name,
            frcol: node.frcol,
            tbcol: node.tbcol,
            chcol: node.chcol,
            chsz: node.chsz,
            vobjleft: 0,
            vobjtop: 0,
            vobjright: 200,
            vobjbottom: 30
        };

        this.setClipboard(clipboardData);
        this.setStatus(`「${node.name}」をコピーしました`);
    }

    /**
     * ノードを起点としてネットワークを再構築
     */
    async focusOnNode(node) {
        this.startRealId = node.realId;
        this.setStatus('ネットワークを再読み込み中...');
        await this.buildNetwork(this.startRealId);
    }

    /**
     * メニュー定義を返す
     */
    getMenuDefinition() {
        // 表示メニュー
        const viewSubmenu = [
            { text: '全画面表示', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
            { text: '再表示', action: 'refresh' }
        ];

        // ノード選択時は「このノードを起点にする」を表示メニューに追加
        if (this.selectedNode) {
            viewSubmenu.push({ separator: true });
            viewSubmenu.push({ text: 'このノードを起点にする', action: 'focus-selected' });
        }

        const menuDefinition = [
            {
                text: '表示',
                submenu: viewSubmenu
            }
        ];

        // ノード選択時のみ仮身操作・編集メニューを追加
        if (this.selectedNode) {
            // 仮身操作メニュー
            menuDefinition.push({
                text: '仮身操作',
                submenu: [
                    { text: '開く', action: 'open-selected' }
                ]
            });

            // 編集メニュー
            menuDefinition.push({
                text: '編集',
                submenu: [
                    { text: 'クリップボードへコピー', action: 'copy-selected', shortcut: 'Ctrl+C' }
                ]
            });
        }

        return menuDefinition;
    }

    /**
     * メニューアクション処理
     * setupCommonMessageBusHandlers() の menu-action ハンドラから呼ばれる
     */
    async executeMenuAction(action) {
        switch (action) {
            case 'toggle-fullscreen':
                this.toggleFullscreen();
                break;
            case 'refresh':
                if (this.startRealId) {
                    await this.buildNetwork(this.startRealId);
                }
                break;
            case 'open-selected':
                if (this.selectedNode) {
                    this.openNode(this.selectedNode);
                }
                break;
            case 'copy-selected':
                if (this.selectedNode) {
                    this.copyNodeToClipboard(this.selectedNode);
                }
                break;
            case 'focus-selected':
                if (this.selectedNode) {
                    await this.focusOnNode(this.selectedNode);
                }
                break;
        }
    }

    /**
     * キーボードショートカット設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+L: 全画面表示
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            // Ctrl+E: ウィンドウを閉じる
            else if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.requestCloseWindow();
            }
            // Ctrl+C: 選択ノードをコピー
            else if (e.ctrlKey && e.key === 'c') {
                e.preventDefault();
                if (this.selectedNode) {
                    this.copyNodeToClipboard(this.selectedNode);
                }
            }
            // Enter: 選択ノードを開く
            else if (e.key === 'Enter') {
                if (this.selectedNode) {
                    this.openNode(this.selectedNode);
                }
            }
            // Escape: 選択解除
            else if (e.key === 'Escape') {
                this.clearSelection();
            }
        });
    }

    // setStatus() は基底クラス PluginBase で定義（sendStatusMessage を呼び出す）

    // requestCloseWindow() は基底クラス PluginBase で定義
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.virtualObjectNetworkApp = new VirtualObjectNetworkApp();
});
