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

        // 表示モード: 'network'（階層的ネットワーク表示）または 'graph'（グラフ表示）
        this.displayMode = 'network';

        // グラフビュー用設定
        this.graphConfig = {
            baseRadius: 10,           // 基本ノード半径
            radiusScale: 3,           // 被参照数によるスケール係数
            maxRadius: 40,            // 最大ノード半径
            repulsionForce: 5000,     // ノード間反発力
            attractionForce: 0.01,    // 接続ノード間引力
            damping: 0.9,             // 減衰係数
            minDistance: 50,          // 最小距離
            zoomThresholdLabels: 1.5, // ラベル表示閾値
            zoomThresholdContent: 3.0 // コンテンツ表示閾値
        };

        // グラフビュー用状態
        this.viewState = {
            x: 0,
            y: 0,
            width: 800,
            height: 600,
            scale: 1
        };
        this.baseWidth = 800;
        this.baseHeight = 600;
        this.svgWidth = 800;
        this.svgHeight = 600;
        this.incomingCount = {};      // 被参照数カウント
        this.simulationRunning = false;
        this.isDraggingNode = false;
        this.draggedNode = null;
        this.isPanning = false;
        this.panStart = { x: 0, y: 0 };
        this.hoveredNode = null;

        // MessageBusはPluginBaseで初期化済み

        // IconCacheManagerを初期化
        if (window.IconCacheManager && this.messageBus) {
            this.iconManager = new window.IconCacheManager(this.messageBus, '[VirtualObjectNetwork]');
        }

        // 開いた仮身表示用（foreignObject + iframe）
        this.expandedNodes = new Set();       // 展開中のノードID
        this.expandedIframes = new Map();     // nodeId -> iframe のマッピング
        this.childMessageBus = null;          // 子iframeとの通信用

        // グラフイベントリスナー管理用AbortController
        this.graphEventsAbortController = null;

        // ネットワークイベントリスナー管理用AbortController
        this.networkEventsAbortController = null;

        this.init();
    }

    async init() {
        logger.info('[VirtualObjectNetwork] 仮身ネットワークプラグイン初期化');

        // MessageBusのハンドラを設定
        if (this.messageBus) {
            this.setupMessageBusHandlers();
        }

        // 開いた仮身（子iframe）との通信用MessageBusを初期化
        this.setupChildMessageBus();

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

        // コンテナサイズからbaseWidth/baseHeightを初期化
        this.updateBaseSize();
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

        // 被参照数を計算
        this.calculateIncomingConnections();

        // 表示モードに応じてレイアウト計算と描画
        if (this.displayMode === 'graph') {
            this.calculateGraphLayout();
            this.renderGraphView();
            this.setupGraphEvents();
            // 注: 初期表示時の自動スクロールは無効化
            // this.centerOnStartNode(false);
            this.startSimulation();
        } else {
            this.resetViewState();      // viewStateをリセット
            this.calculateLayout();
            this.render();
            this.setupNetworkEvents();  // ネットワーク用イベントを設定
        }

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
                // 既存ノードへの接続のみ追加（重複チェック付き）
                const existingNode = this.nodes.find(n => n.realId === childRealId);
                if (existingNode) {
                    // 同じfrom/toの接続が既に存在するかチェック
                    const isDuplicate = this.connections.some(
                        c => c.from === parentNode.id && c.to === existingNode.id
                    );
                    if (!isDuplicate) {
                        this.connections.push({
                            from: parentNode.id,
                            to: existingNode.id
                        });
                    }
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

            // 接続を追加（重複チェック付き）
            const isDuplicate = this.connections.some(
                c => c.from === parentNode.id && c.to === childNode.id
            );
            if (!isDuplicate) {
                this.connections.push({
                    from: parentNode.id,
                    to: childNode.id
                });
            }

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

        // コンテンツサイズを計算（スクロール範囲計算用）
        const maxX = Math.max(...this.nodes.map(n => n.x + n.width)) + this.padding;
        const maxY = Math.max(...this.nodes.map(n => n.y + n.height)) + this.padding;

        // コンテンツサイズを保存（スクロールバー計算用）
        this.contentWidth = maxX;
        this.contentHeight = maxY;

        // SVGサイズはCSSで100%に設定されるため、属性は設定しない
        // viewBoxでコンテンツ全体を表示できるように調整
        const svg = document.getElementById('network-svg');
        if (svg) {
            // viewState.width/heightをコンテンツサイズに合わせて更新
            // （baseWidth/baseHeightより大きい場合のみ）
            if (maxX > this.baseWidth || maxY > this.baseHeight) {
                this.viewState.width = Math.max(maxX, this.baseWidth);
                this.viewState.height = Math.max(maxY, this.baseHeight);
            }
        }
    }

    /**
     * ネットワークを描画
     */
    render() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        // SVGサイズを取得（ズーム用）
        this.svgWidth = svg.clientWidth || 800;
        this.svgHeight = svg.clientHeight || 600;

        // クリア
        svg.innerHTML = '';

        // viewBoxを設定（ズーム・パン対応）
        this.updateViewBox();

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
        const titleFontSize = this.getTitleFontSize();
        text.setAttribute('font-size', titleFontSize);
        text.textContent = this.truncateText(node.name, node.width - textX - 8, titleFontSize);
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

        // 関連する接続線をハイライト（グラフ表示時はlineタグ）
        for (const conn of this.connections) {
            if (conn.from === node.id || conn.to === node.id) {
                // ネットワーク表示ではpath、グラフ表示ではline
                const path = document.querySelector(`path[data-from="${conn.from}"][data-to="${conn.to}"]`);
                if (path) {
                    path.classList.add('highlight');
                }
                const line = document.querySelector(`line[data-from="${conn.from}"][data-to="${conn.to}"]`);
                if (line) {
                    line.classList.add('highlight');
                }
            }
        }

        // グラフ表示時はラベル表示を更新（選択ノードと接続ノードは常に表示）
        if (this.displayMode === 'graph') {
            this.updateNodeLabels();
            // 注: 選択時の自動スクロールは無効化
            // this.centerOnNode(node);
        }
    }

    /**
     * 指定ノードを表示の中心に移動（グラフ表示時）
     * @param {Object} node - 中心に移動するノード
     * @param {boolean} animate - アニメーション有効（デフォルト: true）
     */
    centerOnNode(node, animate = true) {
        if (!node || this.displayMode !== 'graph') return;
        if (!this.isValidNodePosition(node)) return;

        const targetX = node.x - this.viewState.width / 2;
        const targetY = node.y - this.viewState.height / 2;

        if (animate) {
            // アニメーションで滑らかに移動
            const startX = this.viewState.x;
            const startY = this.viewState.y;
            const duration = 300;  // ms
            const startTime = performance.now();

            const animateStep = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                // イージング関数（ease-out）
                const eased = 1 - Math.pow(1 - progress, 3);

                this.viewState.x = startX + (targetX - startX) * eased;
                this.viewState.y = startY + (targetY - startY) * eased;
                this.updateViewBox();

                if (progress < 1) {
                    requestAnimationFrame(animateStep);
                }
            };

            requestAnimationFrame(animateStep);
        } else {
            // 即座に移動
            this.viewState.x = targetX;
            this.viewState.y = targetY;
            this.updateViewBox();
        }
    }

    /**
     * 起点ノード（node_0）を表示の中心に移動
     * @param {boolean} animate - アニメーション有効（デフォルト: true）
     */
    centerOnStartNode(animate = true) {
        const startNode = this.nodes.find(n => n.id === 'node_0');
        if (startNode) {
            this.centerOnNode(startNode, animate);
        }
    }

    /**
     * 選択解除
     */
    clearSelection() {
        const hadSelection = this.selectedNode !== null;
        this.selectedNode = null;

        // ネットワーク表示のノード
        document.querySelectorAll('.vobj-node.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // グラフ表示のノード
        document.querySelectorAll('.graph-node.selected').forEach(el => {
            el.classList.remove('selected');
        });

        // ネットワーク表示の接続線
        document.querySelectorAll('.connection-line.highlight').forEach(el => {
            el.classList.remove('highlight');
        });

        // グラフ表示の接続線
        document.querySelectorAll('.graph-connection.highlight').forEach(el => {
            el.classList.remove('highlight');
        });

        // グラフ表示時、選択解除でラベル表示を更新
        if (hadSelection && this.displayMode === 'graph') {
            this.updateNodeLabels();
        }
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
        const menuDefinition = [];

        // 表示メニュー
        const viewSubmenu = [
            { text: '全画面表示オンオフ', action: 'toggle-fullscreen', shortcut: 'Ctrl+L' },
            { text: '再表示', action: 'refresh' },
            { text: '背景色変更', action: 'change-bg-color' }
        ];

        // ノード選択時は「このノードを起点にする」を追加
        if (this.selectedNode) {
            viewSubmenu.push({ separator: true });
            viewSubmenu.push({ text: 'このノードを起点にする', action: 'focus-selected' });
        }

        menuDefinition.push({
            text: '表示',
            submenu: viewSubmenu
        });

        // 操作メニュー
        const operationSubmenu = [
            {
                text: '仮身ネットワーク表示',
                action: 'switch-to-network',
                shortcut: 'Ctrl+N',
                checked: this.displayMode === 'network'
            },
            {
                text: '仮身グラフ表示',
                action: 'switch-to-graph',
                shortcut: 'Ctrl+G',
                checked: this.displayMode === 'graph'
            }
        ];

        menuDefinition.push({
            text: '操作',
            submenu: operationSubmenu
        });

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
            case 'switch-to-network':
                await this.switchDisplayMode('network');
                break;
            case 'switch-to-graph':
                await this.switchDisplayMode('graph');
                break;
            case 'change-bg-color':
                await this.changeBgColor();
                break;
        }
    }

    /**
     * 表示モードを切り替え
     * @param {string} mode - 'network' または 'graph'
     */
    async switchDisplayMode(mode) {
        if (this.displayMode === mode) return;

        this.displayMode = mode;
        this.clearSelection();
        this.simulationRunning = false;

        if (this.startRealId) {
            this.setStatus('表示モードを切り替え中...');

            if (mode === 'graph') {
                // グラフ表示に切り替え
                this.cleanupNetworkEvents(); // ネットワーク用イベントを解除
                this.resetViewState();
                this.calculateGraphLayout();
                this.renderGraphView();
                this.setupGraphEvents();
                this.startSimulation();
            } else {
                // ネットワーク表示に切り替え
                this.cleanupGraphEvents();  // グラフ用イベントを解除
                this.resetViewState();      // viewStateをリセット
                this.calculateLayout();
                this.render();
                this.setupNetworkEvents();  // ネットワーク用イベントを設定
            }

            this.setStatus(`${this.nodes.length} 個の実身を表示（${mode === 'graph' ? 'グラフ' : 'ネットワーク'}表示）`);
        }
    }

    /**
     * viewStateをリセット
     */
    resetViewState() {
        const svg = document.getElementById('network-svg');
        if (svg) {
            this.svgWidth = svg.clientWidth || 800;
            this.svgHeight = svg.clientHeight || 600;
        }
        this.viewState = {
            x: 0,
            y: 0,
            width: this.baseWidth,
            height: this.baseHeight,
            scale: 1
        };
    }

    // toggleFullscreen() は PluginBase で共通化（toggle-maximize メッセージを送信）

    /**
     * キーボードショートカット設定
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+E: ウィンドウを閉じる
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                this.requestCloseWindow();
            }
            // Ctrl+L: 全画面表示オンオフ
            else if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.toggleFullscreen();
            }
            // Ctrl+N: 仮身ネットワーク表示に切り替え
            else if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                this.switchDisplayMode('network');
            }
            // Ctrl+G: 仮身グラフ表示に切り替え
            else if (e.ctrlKey && e.key === 'g') {
                e.preventDefault();
                this.switchDisplayMode('graph');
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
                if (this.displayMode === 'graph') {
                    this.unhighlightAll();
                }
            }
            // +/=: ズームイン（両モードで有効）
            else if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                this.zoom(-100, this.svgWidth / 2, this.svgHeight / 2);
            }
            // -: ズームアウト（両モードで有効）
            else if (e.key === '-') {
                e.preventDefault();
                this.zoom(100, this.svgWidth / 2, this.svgHeight / 2);
            }
            // 矢印キー: パン（両モードで有効）
            else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.pan(0, 50);
            }
            else if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.pan(0, -50);
            }
            else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.pan(50, 0);
            }
            else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.pan(-50, 0);
            }
        });
    }

    // setStatus() は基底クラス PluginBase で定義（sendStatusMessage を呼び出す）

    // requestCloseWindow() は基底クラス PluginBase で定義

    // ========================================
    // グラフビュー関連メソッド
    // ========================================

    /**
     * 被参照数をカウント
     */
    calculateIncomingConnections() {
        this.incomingCount = {};
        for (const node of this.nodes) {
            this.incomingCount[node.id] = 0;
        }
        for (const conn of this.connections) {
            this.incomingCount[conn.to] = (this.incomingCount[conn.to] || 0) + 1;
        }
    }

    /**
     * ノードの半径を取得（被参照数に基づく）
     * @param {string} nodeId - ノードID
     * @returns {number} 半径
     */
    getNodeRadius(nodeId) {
        const count = this.incomingCount[nodeId] || 0;
        return Math.min(
            this.graphConfig.baseRadius + count * this.graphConfig.radiusScale,
            this.graphConfig.maxRadius
        );
    }

    /**
     * グラフ用の初期レイアウト計算（円形配置）
     */
    calculateGraphLayout() {
        const centerX = this.baseWidth / 2;
        const centerY = this.baseHeight / 2;
        const nodeCount = this.nodes.length;

        if (nodeCount === 0) return;

        if (nodeCount === 1) {
            this.nodes[0].x = centerX;
            this.nodes[0].y = centerY;
            this.nodes[0].vx = 0;
            this.nodes[0].vy = 0;
            return;
        }

        // 円形に配置
        const radius = Math.min(centerX, centerY) * 0.7;
        for (let i = 0; i < nodeCount; i++) {
            const angle = (2 * Math.PI * i) / nodeCount - Math.PI / 2;
            this.nodes[i].x = centerX + radius * Math.cos(angle);
            this.nodes[i].y = centerY + radius * Math.sin(angle);
            this.nodes[i].vx = 0;
            this.nodes[i].vy = 0;
        }
    }

    /**
     * グラフビューを描画
     */
    renderGraphView() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        // SVGサイズとviewBoxを設定
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.width = '100%';
        svg.style.height = '100%';
        this.updateViewBox();

        // クリア（SVGと展開状態の両方）
        svg.innerHTML = '';
        this.expandedNodes.clear();
        this.expandedIframes.clear();

        // 背景（パン用のクリックエリア）
        const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('class', 'graph-background');
        bg.setAttribute('x', this.viewState.x - 1000);
        bg.setAttribute('y', this.viewState.y - 1000);
        bg.setAttribute('width', this.viewState.width + 2000);
        bg.setAttribute('height', this.viewState.height + 2000);
        bg.setAttribute('fill', 'transparent');
        svg.appendChild(bg);

        // 接続線を描画（ノードより先に描画して背面に）
        for (const conn of this.connections) {
            this.renderGraphConnection(svg, conn);
        }

        // ノードを描画
        for (const node of this.nodes) {
            this.renderGraphNode(svg, node);
        }

        // グラフ表示のスクロール状態を通知
        this._sendGraphScrollState();
    }

    /**
     * ノード位置が有効かチェック
     * @param {Object} node - ノード
     * @returns {boolean} 位置が有効ならtrue
     */
    isValidNodePosition(node) {
        if (!node) return false;
        // NaN, Infinity チェック
        if (!isFinite(node.x) || !isFinite(node.y)) return false;
        // 初期値(0,0)の近く = レイアウト未計算のノード（浮動小数点誤差を考慮）
        if (Math.abs(node.x) < 10 && Math.abs(node.y) < 10) return false;
        // 極端に大きな値（計算エラー）
        if (Math.abs(node.x) > 100000 || Math.abs(node.y) > 100000) return false;
        return true;
    }

    /**
     * グラフ用接続線を描画
     */
    renderGraphConnection(svg, conn) {
        const fromNode = this.nodes.find(n => n.id === conn.from);
        const toNode = this.nodes.find(n => n.id === conn.to);

        // ノードが存在しない、または位置が無効な場合はスキップ
        if (!this.isValidNodePosition(fromNode) || !this.isValidNodePosition(toNode)) {
            return;
        }

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', 'graph-connection');
        line.setAttribute('x1', fromNode.x);
        line.setAttribute('y1', fromNode.y);
        line.setAttribute('x2', toNode.x);
        line.setAttribute('y2', toNode.y);
        // ズームしても線の太さを変えない
        line.setAttribute('vector-effect', 'non-scaling-stroke');
        line.dataset.from = conn.from;
        line.dataset.to = conn.to;

        svg.appendChild(line);
    }

    /**
     * グラフ用ノードを描画（円形、または拡大時は開いた仮身として長方形）
     */
    renderGraphNode(svg, node) {
        // 位置が無効なノードは非表示として描画（後で位置更新時に表示）
        const hasValidPosition = this.isValidNodePosition(node);

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'graph-node');
        g.setAttribute('transform', `translate(${node.x || 0}, ${node.y || 0})`);
        g.dataset.nodeId = node.id;
        g.dataset.realId = node.realId;
        if (!hasValidPosition) {
            g.style.display = 'none';
        }

        const radius = this.getNodeRadius(node.id);

        // ノードの視覚的な大きさ（直径 × スケール）を計算
        const visualDiameter = radius * 2 * this.viewState.scale;
        const windowWidth = this.svgWidth || 800;
        const threshold = windowWidth / 10;

        // 視覚的な直径が閾値を超えたら開いた仮身（長方形）として描画
        const isExpanded = visualDiameter > threshold;
        g.dataset.expanded = isExpanded ? 'true' : 'false';

        if (isExpanded) {
            // 開いた仮身として描画（縦2:横3の長方形）
            const rectHeight = radius * 2;
            const rectWidth = rectHeight * 1.5;  // 2:3の比率

            // 背景矩形
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('class', 'node-rect');
            rect.setAttribute('x', -rectWidth / 2);
            rect.setAttribute('y', -rectHeight / 2);
            rect.setAttribute('width', rectWidth);
            rect.setAttribute('height', rectHeight);
            rect.setAttribute('fill', node.tbcol || '#ffffff');
            rect.setAttribute('stroke', node.frcol || '#374151');
            rect.setAttribute('stroke-width', '2');
            rect.setAttribute('rx', '2');
            rect.setAttribute('ry', '2');
            // ズームしても線の太さを変えない
            rect.setAttribute('vector-effect', 'non-scaling-stroke');
            g.appendChild(rect);

            // タイトルバー（仮身名表示用）
            const titleHeight = Math.min(rectHeight * 0.2, 16);
            const titleBar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            titleBar.setAttribute('class', 'node-title-bar');
            titleBar.setAttribute('x', -rectWidth / 2);
            titleBar.setAttribute('y', -rectHeight / 2);
            titleBar.setAttribute('width', rectWidth);
            titleBar.setAttribute('height', titleHeight);
            titleBar.setAttribute('fill', node.frcol || '#374151');
            g.appendChild(titleBar);

            // アイコン（タイトルバー左端）
            const iconSize = Math.min(titleHeight - 2, 14);
            const iconImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            iconImage.setAttribute('class', 'node-icon');
            iconImage.setAttribute('x', -rectWidth / 2 + 2);
            iconImage.setAttribute('y', -rectHeight / 2 + (titleHeight - iconSize) / 2);
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

            // 仮身名（タイトルバー内）
            const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            titleText.setAttribute('class', 'node-title');
            titleText.setAttribute('x', -rectWidth / 2 + iconSize + 4);
            titleText.setAttribute('y', -rectHeight / 2 + titleHeight / 2 + 3);
            titleText.setAttribute('fill', '#ffffff');
            titleText.setAttribute('font-size', Math.max(8, titleHeight * 0.6));
            titleText.textContent = this.truncateText(node.name, rectWidth - iconSize - 8, titleHeight * 0.6);
            g.appendChild(titleText);

            // コンテンツ領域（foreignObject + iframe）
            const contentHeight = rectHeight - titleHeight;
            const fo = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
            fo.setAttribute('class', 'node-content-fo');
            fo.setAttribute('x', -rectWidth / 2);
            fo.setAttribute('y', -rectHeight / 2 + titleHeight);
            fo.setAttribute('width', rectWidth);
            fo.setAttribute('height', contentHeight);
            g.appendChild(fo);

            // 開いた仮身表示（iframe）を生成
            this.expandGraphNodeContent(fo, node, rectWidth, contentHeight);
        } else {
            // 円形ノード
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('class', 'node-circle');
            circle.setAttribute('r', radius);
            circle.setAttribute('fill', node.tbcol || '#6b7280');
            circle.setAttribute('stroke', node.frcol || '#374151');
            // ズームしても線の太さを変えない
            circle.setAttribute('vector-effect', 'non-scaling-stroke');
            g.appendChild(circle);
        }

        // 実身名ラベル（円形ノードの場合、または開いた仮身の下に表示）
        if (!isExpanded) {
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('class', 'node-label');
            label.setAttribute('y', radius + 14);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('fill', '#374151');
            label.setAttribute('font-size', '12');
            label.textContent = this.truncateText(node.name, 100, 12);
            label.style.display = this.viewState.scale >= this.graphConfig.zoomThresholdLabels ? 'block' : 'none';
            g.appendChild(label);
        }

        // イベント設定
        this.setupGraphNodeEvents(g, node);

        svg.appendChild(g);
    }

    /**
     * 子iframe（開いた仮身）との通信用MessageBusを設定
     */
    setupChildMessageBus() {
        if (window.MessageBus) {
            this.childMessageBus = new window.MessageBus({
                debug: false,
                pluginName: 'VirtualObjectNetwork-Child',
                mode: 'parent'
            });
            this.childMessageBus.start();
        }

        // メッセージリレー用マップ（messageId -> source）
        this.messageRelayMap = new Map();

        // 子iframeからのメッセージをリレー
        window.addEventListener('message', (e) => {
            if (!e.data || !e.data.type) return;

            // 送信元が展開中のiframeかチェック
            let isFromExpandedIframe = false;
            for (const [nodeId, iframe] of this.expandedIframes) {
                if (iframe.contentWindow === e.source) {
                    isFromExpandedIframe = true;
                    break;
                }
            }
            if (!isFromExpandedIframe) return;

            const { type, messageId } = e.data;

            // リレー対象のメッセージタイプ（レスポンスを待つもの）
            // 注: load-data-file-request はVirtualObjectListが使用する正式なメッセージタイプ
            // 注: load-real-object はPluginBase.loadRealObjectDataが使用する正式なメッセージタイプ
            const relayTypesWithResponse = [
                'read-icon-file',
                'load-data-file-request',
                'get-image-file-path',
                'load-real-object'
            ];

            // リレー対象のメッセージタイプ（レスポンスを待たないもの）
            const relayTypesNoResponse = [
                'delete-image-file'
            ];

            if (relayTypesWithResponse.includes(type)) {
                // messageIdがあれば応答をリレーするためにマップに登録
                if (messageId) {
                    this.messageRelayMap.set(messageId, e.source);
                }
                // 親にリレー
                this.messageBus.send(type, e.data);
            } else if (relayTypesNoResponse.includes(type)) {
                // 親にリレー（レスポンス不要）
                this.messageBus.send(type, e.data);
            }
        });

        // 親からの応答を子にリレー
        if (this.messageBus) {
            // 応答メッセージタイプのマッピング
            // 注: icon-file-loaded はread-icon-fileに対応する正式なレスポンスタイプ
            // 注: real-object-loaded はload-real-objectに対応する正式なレスポンスタイプ
            const responseTypes = [
                'icon-file-loaded',
                'load-data-file-response',
                'image-file-path-response',
                'real-object-loaded'
            ];

            for (const responseType of responseTypes) {
                this.messageBus.on(responseType, (data) => {
                    const source = this.messageRelayMap.get(data.messageId);
                    if (source) {
                        source.postMessage({
                            type: responseType,
                            ...data
                        }, '*');
                        this.messageRelayMap.delete(data.messageId);
                    }
                });
            }
        }
    }

    /**
     * 拡大ノードの開いた仮身表示（iframe）を生成
     * @param {SVGForeignObjectElement} foreignObject - コンテンツを埋め込むforeignObject
     * @param {Object} node - ノード情報
     * @param {number} width - コンテンツ幅
     * @param {number} height - コンテンツ高さ
     */
    async expandGraphNodeContent(foreignObject, node, width, height) {
        // 既に展開済みならスキップ
        if (this.expandedNodes.has(node.id)) return;

        // 実身IDを抽出
        const realId = node.realId;
        if (!realId) return;

        // 実身データを読み込み（1回だけ）
        const realObjectData = await this.loadRealObjectData(realId);
        if (!realObjectData) {
            this.renderFallbackContent(foreignObject, node, width, height);
            return;
        }

        // defaultOpenプラグインを取得（applistから）
        const defaultOpenPlugin = this.getDefaultOpenPluginFromData(realObjectData);
        if (!defaultOpenPlugin) {
            // defaultOpenプラグインがない場合はフォールバック表示
            this.renderFallbackContent(foreignObject, node, width, height);
            return;
        }

        // 1/10縮小表示のための設定
        const scaleFactor = 0.1;  // 1/10スケール
        const inverseScale = 1 / scaleFactor;  // 10倍

        // 外側コンテナ（foreignObjectサイズ、overflow: hidden）
        const outerContainer = document.createElement('div');
        outerContainer.style.width = '100%';
        outerContainer.style.height = '100%';
        outerContainer.style.overflow = 'hidden';
        outerContainer.style.position = 'relative';

        // スケーリングコンテナ（10倍サイズで表示し、scale(0.1)で縮小）
        const scalingContainer = document.createElement('div');
        scalingContainer.style.width = `${inverseScale * 100}%`;
        scalingContainer.style.height = `${inverseScale * 100}%`;
        scalingContainer.style.transform = `scale(${scaleFactor})`;
        scalingContainer.style.transformOrigin = 'top left';
        scalingContainer.style.position = 'absolute';
        scalingContainer.style.top = '0';
        scalingContainer.style.left = '0';

        // iframeを作成
        const iframe = document.createElement('iframe');
        iframe.className = 'node-content-iframe';
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.overflow = 'hidden';
        iframe.style.backgroundColor = node.tbcol || '#ffffff';
        iframe.style.pointerEvents = 'none';  // 操作は無効

        // IMPORTANT: nodeintegration属性を設定してからsrcを設定（これが重要！）
        iframe.setAttribute('nodeintegration', '');
        iframe.src = `../../plugins/${defaultOpenPlugin}/index.html`;

        // iframeロード後にデータを送信
        iframe.addEventListener('load', () => {
            iframe.contentWindow.postMessage({
                type: 'load-virtual-object',
                virtualObj: {
                    link_id: node.linkId || `${realId}_0.xtad`,
                    link_name: node.name,
                    frcol: node.frcol,
                    tbcol: node.tbcol,
                    chcol: node.chcol,
                    bgcol: node.tbcol
                },
                realObject: realObjectData,
                bgcol: node.tbcol || '#ffffff',
                readonly: true,
                noScrollbar: true
            }, '*');
        });

        scalingContainer.appendChild(iframe);
        outerContainer.appendChild(scalingContainer);
        foreignObject.appendChild(outerContainer);
        this.expandedNodes.add(node.id);
        this.expandedIframes.set(node.id, iframe);
    }

    /**
     * 開いた仮身表示のフォールバック（プラグインがない場合）
     */
    renderFallbackContent(foreignObject, node, width, height) {
        const div = document.createElement('div');
        div.style.width = '100%';
        div.style.height = '100%';
        div.style.backgroundColor = node.tbcol || '#ffffff';
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.justifyContent = 'center';
        div.style.color = '#666666';
        div.style.fontSize = '10px';
        div.style.fontFamily = '"MS Gothic", monospace';
        div.textContent = '(プレビュー不可)';
        foreignObject.appendChild(div);
    }

    /**
     * 拡大ノードの開いた仮身表示（iframe）を削除
     * @param {Object} node - ノード情報
     */
    collapseGraphNodeContent(node) {
        if (!this.expandedNodes.has(node.id)) return;

        const iframe = this.expandedIframes.get(node.id);
        if (iframe) {
            iframe.remove();
        }

        this.expandedNodes.delete(node.id);
        this.expandedIframes.delete(node.id);
    }

    /**
     * defaultOpenプラグインを取得
     * @param {Object} realObjectData - 実身データ（applistを含む）
     * @returns {string|null} プラグインID
     */
    getDefaultOpenPluginFromData(realObjectData) {
        if (!realObjectData || !realObjectData.applist) {
            return null;
        }

        const applist = realObjectData.applist;
        for (const [pluginId, config] of Object.entries(applist)) {
            if (config && config.defaultOpen === true) {
                return pluginId;
            }
        }
        return null;
    }

    /**
     * グラフノードのイベント設定
     */
    setupGraphNodeEvents(g, node) {
        // クリックで選択
        g.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectNode(node);
        });

        // ダブルクリックで開く
        g.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.openNode(node);
        });

        // 右クリックメニュー
        g.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.selectNode(node);
            this.showContextMenuAtEvent(e);
        });

        // マウスオーバーでハイライト
        g.addEventListener('mouseenter', () => {
            this.hoveredNode = node;
            this.highlightNode(node);
        });

        g.addEventListener('mouseleave', () => {
            this.hoveredNode = null;
            if (!this.selectedNode) {
                this.unhighlightAll();
            }
        });

        // ドラッグ開始
        g.addEventListener('mousedown', (e) => {
            if (e.button === 0) {  // 左クリック
                e.stopPropagation();
                this.startNodeDrag(e, node);
            }
        });
    }

    /**
     * グラフ用イベント設定
     */
    setupGraphEvents() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        // 既存のグラフイベントをクリア（重複防止）
        this.cleanupGraphEvents();

        // 新しいAbortControllerを作成
        this.graphEventsAbortController = new AbortController();
        const signal = this.graphEventsAbortController.signal;

        // ホイールでズーム（passive: falseでpreventDefault可能）
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.zoom(e.deltaY, x, y);
        }, { passive: false, signal });

        // 背景ドラッグでパン
        svg.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('graph-background') || e.target === svg) {
                this.startPan(e);
            }
        }, { signal });

        // マウス移動
        document.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.doPan(e);
            }
            if (this.isDraggingNode && this.draggedNode) {
                this.doNodeDrag(e);
            }
        }, { signal });

        // マウスアップ
        document.addEventListener('mouseup', () => {
            this.endPan();
            this.endNodeDrag();
        }, { signal });

        // クリックで選択解除
        svg.addEventListener('click', (e) => {
            if (e.target.classList.contains('graph-background') || e.target === svg) {
                this.clearSelection();
                this.unhighlightAll();
            }
        }, { signal });
    }

    /**
     * グラフ用イベントをクリーンアップ
     */
    cleanupGraphEvents() {
        if (this.graphEventsAbortController) {
            this.graphEventsAbortController.abort();
            this.graphEventsAbortController = null;
        }
    }

    /**
     * ネットワーク用イベント設定
     */
    setupNetworkEvents() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        // 既存のネットワークイベントをクリア（重複防止）
        this.cleanupNetworkEvents();

        // 新しいAbortControllerを作成
        this.networkEventsAbortController = new AbortController();
        const signal = this.networkEventsAbortController.signal;

        // ホイールでズーム（passive: falseでpreventDefault可能）
        svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.zoom(e.deltaY, x, y);
        }, { passive: false, signal });

        // 背景ドラッグでパン
        svg.addEventListener('mousedown', (e) => {
            // ノード上でない場合のみパン開始
            if (e.target === svg || e.target.tagName === 'svg') {
                this.startPan(e);
            }
        }, { signal });

        // マウス移動
        document.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                this.doPan(e);
            }
        }, { signal });

        // マウスアップ
        document.addEventListener('mouseup', () => {
            this.endPan();
        }, { signal });

        // クリックで選択解除
        svg.addEventListener('click', (e) => {
            if (e.target === svg || e.target.tagName === 'svg') {
                this.clearSelection();
            }
        }, { signal });
    }

    /**
     * ネットワーク用イベントをクリーンアップ
     */
    cleanupNetworkEvents() {
        if (this.networkEventsAbortController) {
            this.networkEventsAbortController.abort();
            this.networkEventsAbortController = null;
        }
    }

    // ========================================
    // Force-Directed Layout
    // ========================================

    /**
     * Force-Directed シミュレーションを開始
     */
    startSimulation() {
        this.simulationRunning = true;
        let iterations = 0;
        const maxIterations = 300;

        const animate = () => {
            if (!this.simulationRunning || iterations >= maxIterations) {
                this.simulationRunning = false;
                // シミュレーション完了時にスクロール状態を更新
                this._sendGraphScrollState();
                return;
            }

            this.calculateForces();
            this.updatePositions();
            this.updateGraphPositions();

            // 収束判定
            const totalVelocity = this.nodes.reduce((sum, n) =>
                sum + Math.abs(n.vx || 0) + Math.abs(n.vy || 0), 0);

            if (totalVelocity < 0.5) {
                this.simulationRunning = false;
                // シミュレーション完了時にスクロール状態を更新
                this._sendGraphScrollState();
                return;
            }

            iterations++;
            requestAnimationFrame(animate);
        };

        requestAnimationFrame(animate);
    }

    /**
     * 各ノードに働く力を計算
     */
    calculateForces() {
        const cfg = this.graphConfig;

        for (const node of this.nodes) {
            if (node.isDragging) continue;

            node.fx = 0;
            node.fy = 0;

            // 他の全ノードからの反発力
            for (const other of this.nodes) {
                if (node === other) continue;

                const dx = node.x - other.x;
                const dy = node.y - other.y;
                const distance = Math.max(Math.sqrt(dx * dx + dy * dy), cfg.minDistance);
                const force = cfg.repulsionForce / (distance * distance);

                node.fx += (dx / distance) * force;
                node.fy += (dy / distance) * force;
            }

            // 接続ノードへの引力
            for (const conn of this.connections) {
                if (conn.from !== node.id && conn.to !== node.id) continue;

                const otherId = conn.from === node.id ? conn.to : conn.from;
                const other = this.nodes.find(n => n.id === otherId);
                if (!other) continue;

                const dx = other.x - node.x;
                const dy = other.y - node.y;

                node.fx += dx * cfg.attractionForce;
                node.fy += dy * cfg.attractionForce;
            }

            // 中心への引力（散らばりすぎ防止）
            const centerX = this.baseWidth / 2;
            const centerY = this.baseHeight / 2;
            node.fx += (centerX - node.x) * 0.001;
            node.fy += (centerY - node.y) * 0.001;
        }
    }

    /**
     * ノード位置を更新
     */
    updatePositions() {
        const cfg = this.graphConfig;

        for (const node of this.nodes) {
            if (node.isDragging) continue;

            node.vx = ((node.vx || 0) + node.fx) * cfg.damping;
            node.vy = ((node.vy || 0) + node.fy) * cfg.damping;

            node.x += node.vx;
            node.y += node.vy;

            // 境界制限
            const margin = 50;
            node.x = Math.max(margin, Math.min(this.baseWidth - margin, node.x));
            node.y = Math.max(margin, Math.min(this.baseHeight - margin, node.y));
        }
    }

    /**
     * SVG要素の位置を更新
     */
    updateGraphPositions() {
        // ノード位置を更新
        for (const node of this.nodes) {
            const g = document.querySelector(`g[data-node-id="${node.id}"]`);
            if (g) {
                // 有効な位置のノードのみ表示
                if (this.isValidNodePosition(node)) {
                    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
                    g.style.display = '';
                } else {
                    g.style.display = 'none';
                }
            }
        }

        // 接続線を更新
        for (const conn of this.connections) {
            const fromNode = this.nodes.find(n => n.id === conn.from);
            const toNode = this.nodes.find(n => n.id === conn.to);

            const line = document.querySelector(`line[data-from="${conn.from}"][data-to="${conn.to}"]`);
            if (line) {
                // 両端のノードが有効な位置にある場合のみ表示
                if (this.isValidNodePosition(fromNode) && this.isValidNodePosition(toNode)) {
                    line.setAttribute('x1', fromNode.x);
                    line.setAttribute('y1', fromNode.y);
                    line.setAttribute('x2', toNode.x);
                    line.setAttribute('y2', toNode.y);
                    line.style.display = '';
                } else {
                    line.style.display = 'none';
                }
            }
        }
    }

    // ========================================
    // ズーム・パン
    // ========================================

    /**
     * ズーム処理
     * @param {number} delta - ホイールのデルタ値（正:ズームアウト、負:ズームイン）
     * @param {number} centerX - ズーム中心X（SVG要素内の座標）
     * @param {number} centerY - ズーム中心Y（SVG要素内の座標）
     */
    zoom(delta, centerX, centerY) {
        const factor = delta > 0 ? 1.1 : 0.9;

        // 最小・最大スケール制限
        const newScale = this.viewState.scale * (delta > 0 ? 0.9 : 1.1);
        if (newScale < 0.1 || newScale > 10) return;

        // 実際のSVG要素サイズを取得（ズーム中心の計算に使用）
        const svg = document.getElementById('network-svg');
        const rect = svg ? svg.getBoundingClientRect() : null;
        const actualWidth = rect ? rect.width : this.svgWidth;
        const actualHeight = rect ? rect.height : this.svgHeight;

        const newWidth = this.viewState.width * factor;
        const newHeight = this.viewState.height * factor;

        // viewBox座標での中心点（マウス位置を基準に）
        const viewCenterX = this.viewState.x + (centerX / actualWidth) * this.viewState.width;
        const viewCenterY = this.viewState.y + (centerY / actualHeight) * this.viewState.height;

        this.viewState.x = viewCenterX - (centerX / actualWidth) * newWidth;
        this.viewState.y = viewCenterY - (centerY / actualHeight) * newHeight;
        this.viewState.width = newWidth;
        this.viewState.height = newHeight;
        this.viewState.scale = this.baseWidth / newWidth;

        this.updateViewBox();
        this.updateNodeLabels();
    }

    /**
     * パン開始
     */
    startPan(e) {
        this.isPanning = true;
        this.panStart = { x: e.clientX, y: e.clientY };
    }

    /**
     * パン処理
     */
    doPan(e) {
        if (!this.isPanning) return;

        const dx = e.clientX - this.panStart.x;
        const dy = e.clientY - this.panStart.y;

        this.pan(dx, dy);

        this.panStart = { x: e.clientX, y: e.clientY };
    }

    /**
     * パン終了
     */
    endPan() {
        this.isPanning = false;
    }

    /**
     * パン（ビュー移動）
     * @param {number} dx - X方向の移動量（画面座標）
     * @param {number} dy - Y方向の移動量（画面座標）
     */
    pan(dx, dy) {
        const scaleX = this.viewState.width / this.svgWidth;
        const scaleY = this.viewState.height / this.svgHeight;

        this.viewState.x -= dx * scaleX;
        this.viewState.y -= dy * scaleY;

        this.updateViewBox();
    }

    /**
     * viewBoxを更新
     */
    updateViewBox() {
        const svg = document.getElementById('network-svg');
        if (!svg) return;

        svg.setAttribute('viewBox',
            `${this.viewState.x} ${this.viewState.y} ${this.viewState.width} ${this.viewState.height}`);

        // グラフ表示時はスクロール状態を通知
        if (this.displayMode === 'graph') {
            this._sendGraphScrollState();
        }
    }

    /**
     * グラフ表示用のスクロール状態を親ウィンドウに送信
     * viewBox座標系からスクロール状態を計算して通知する
     */
    _sendGraphScrollState() {
        if (!this.messageBus || !this.windowId) return;

        // ノード境界を計算してコンテンツサイズを求める
        let minX = 0, minY = 0, maxX = this.baseWidth, maxY = this.baseHeight;
        const margin = 100;  // マージン

        for (const node of this.nodes) {
            if (this.isValidNodePosition(node)) {
                const radius = this.getNodeRadius(node.id);
                minX = Math.min(minX, node.x - radius - margin);
                minY = Math.min(minY, node.y - radius - margin);
                maxX = Math.max(maxX, node.x + radius + margin);
                maxY = Math.max(maxY, node.y + radius + margin);
            }
        }

        const contentWidth = maxX - minX;
        const contentHeight = maxY - minY;

        // viewBox座標をスクロール状態に変換
        const state = {
            scrollTop: this.viewState.y - minY,
            scrollLeft: this.viewState.x - minX,
            scrollHeight: contentHeight,
            scrollWidth: contentWidth,
            clientHeight: this.viewState.height,
            clientWidth: this.viewState.width
        };

        this.messageBus.send('scroll-state-update', {
            windowId: this.windowId,
            ...state
        });
    }

    /**
     * 親からのスクロール位置設定要求を処理（オーバーライド）
     * グラフ表示モードではviewBox座標に変換して適用する
     * @param {Object} data - { scrollTop?: number, scrollLeft?: number }
     */
    handleSetScrollPosition(data) {
        if (this.displayMode !== 'graph') {
            // ネットワーク表示モードでは親クラスの処理を呼び出し
            super.handleSetScrollPosition(data);
            return;
        }

        // グラフ表示モード: スクロール位置をviewBox座標に変換
        // ノード境界を計算
        let minX = 0, minY = 0;
        const margin = 100;

        for (const node of this.nodes) {
            if (this.isValidNodePosition(node)) {
                const radius = this.getNodeRadius(node.id);
                minX = Math.min(minX, node.x - radius - margin);
                minY = Math.min(minY, node.y - radius - margin);
            }
        }

        // スクロール位置をviewBox座標に変換
        if (typeof data.scrollTop === 'number') {
            this.viewState.y = data.scrollTop + minY;
        }
        if (typeof data.scrollLeft === 'number') {
            this.viewState.x = data.scrollLeft + minX;
        }

        // viewBoxを更新（_sendGraphScrollStateは内部で呼ばれる）
        this.updateViewBox();
    }

    /**
     * コンテナサイズからbaseWidth/baseHeightを更新
     * 全画面表示切り替え時やウィンドウリサイズ時に呼び出す
     */
    updateBaseSize() {
        const container = document.querySelector('.plugin-content');
        if (container) {
            this.baseWidth = container.clientWidth || 800;
            this.baseHeight = container.clientHeight || 600;
        }

        // svgWidth/svgHeightも同期
        this.svgWidth = this.baseWidth;
        this.svgHeight = this.baseHeight;

        // viewStateのサイズも更新（スケールを維持）
        if (this.viewState) {
            this.viewState.width = this.baseWidth / this.viewState.scale;
            this.viewState.height = this.baseHeight / this.viewState.scale;
        }
    }

    /**
     * ウィンドウリサイズ完了時の処理（PluginBaseフックをオーバーライド）
     * @param {Object} data - リサイズ情報
     */
    onWindowResizedEnd(data) {
        // baseWidth/baseHeightを更新
        this.updateBaseSize();

        // 表示モードに応じて再描画
        if (this.displayMode === 'graph') {
            // グラフ表示: viewBoxを更新してスクロール状態を通知
            this.updateViewBox();
            this._sendGraphScrollState();
        } else {
            // ネットワーク表示: 再描画（render内でviewBox更新とスクロール通知も行う）
            this.render();
        }
    }

    /**
     * ユーザー環境設定のタイトル文字サイズを取得
     * @returns {number} タイトル文字サイズ（デフォルト14）
     */
    getTitleFontSize() {
        return parseInt(localStorage.getItem('title-font-size') || '14', 10);
    }

    /**
     * ズームレベルに応じてノードラベルの表示を更新
     * 選択ノードと直接接続しているノードは常に表示
     */
    updateNodeLabels() {
        // ネットワーク表示モードでは何もしない（グラフ表示専用）
        if (this.displayMode !== 'graph') return;

        const showLabels = this.viewState.scale >= this.graphConfig.zoomThresholdLabels;

        // 選択ノードと直接接続しているノードのIDを取得
        const alwaysShowIds = new Set();
        if (this.selectedNode) {
            alwaysShowIds.add(this.selectedNode.id);
            for (const conn of this.connections) {
                if (conn.from === this.selectedNode.id) alwaysShowIds.add(conn.to);
                if (conn.to === this.selectedNode.id) alwaysShowIds.add(conn.from);
            }
        }

        // 各ノードのラベル表示を更新
        document.querySelectorAll('.graph-node').forEach(g => {
            const nodeId = g.dataset.nodeId;
            const label = g.querySelector('.node-label');
            if (label) {
                // 選択ノードまたは接続ノードは常に表示、それ以外はズームレベルで判断
                const shouldShow = alwaysShowIds.has(nodeId) || showLabels;
                label.style.display = shouldShow ? 'block' : 'none';
            }
        });

        // ノードの拡大/縮小表示を更新
        this.updateNodeExpansionState();
    }

    /**
     * ズームレベルに応じてノードの拡大/縮小表示状態を更新
     */
    updateNodeExpansionState() {
        // ネットワーク表示モードでは何もしない（グラフ表示専用）
        if (this.displayMode !== 'graph') return;

        const windowWidth = this.svgWidth || 800;
        const threshold = windowWidth / 10;
        let needsRerender = false;
        const nodesToCollapse = [];

        for (const node of this.nodes) {
            const radius = this.getNodeRadius(node.id);
            const visualDiameter = radius * 2 * this.viewState.scale;
            const shouldBeExpanded = visualDiameter > threshold;

            const g = document.querySelector(`g[data-node-id="${node.id}"]`);
            if (g) {
                const currentlyExpanded = g.dataset.expanded === 'true';
                if (shouldBeExpanded !== currentlyExpanded) {
                    needsRerender = true;
                    // 縮小するノードをリストに追加（iframeを削除するため）
                    if (!shouldBeExpanded && currentlyExpanded) {
                        nodesToCollapse.push(node);
                    }
                }
            }
        }

        // 縮小するノードのiframeを削除
        for (const node of nodesToCollapse) {
            this.collapseGraphNodeContent(node);
        }

        // 拡大/縮小状態が変わったノードがあれば全体を再描画
        if (needsRerender) {
            this.renderGraphView();
        }
    }

    // ========================================
    // ノードドラッグ
    // ========================================

    /**
     * ノードドラッグ開始
     */
    startNodeDrag(e, node) {
        this.isDraggingNode = true;
        this.draggedNode = node;
        node.isDragging = true;

        const svg = document.getElementById('network-svg');
        const rect = svg.getBoundingClientRect();

        // 画面座標からviewBox座標へ変換
        const scaleX = this.viewState.width / rect.width;
        const scaleY = this.viewState.height / rect.height;

        this.dragOffset = {
            x: (e.clientX - rect.left) * scaleX + this.viewState.x - node.x,
            y: (e.clientY - rect.top) * scaleY + this.viewState.y - node.y
        };
    }

    /**
     * ノードドラッグ中
     */
    doNodeDrag(e) {
        if (!this.isDraggingNode || !this.draggedNode) return;

        const svg = document.getElementById('network-svg');
        const rect = svg.getBoundingClientRect();

        const scaleX = this.viewState.width / rect.width;
        const scaleY = this.viewState.height / rect.height;

        const newX = (e.clientX - rect.left) * scaleX + this.viewState.x - this.dragOffset.x;
        const newY = (e.clientY - rect.top) * scaleY + this.viewState.y - this.dragOffset.y;

        this.draggedNode.x = newX;
        this.draggedNode.y = newY;

        this.updateGraphPositions();
    }

    /**
     * ノードドラッグ終了
     */
    endNodeDrag() {
        if (this.draggedNode) {
            this.draggedNode.isDragging = false;
        }
        this.isDraggingNode = false;
        this.draggedNode = null;
    }

    // ========================================
    // ハイライト
    // ========================================

    /**
     * ノードと関連接続をハイライト
     */
    highlightNode(node) {
        // 全ノードを暗く
        document.querySelectorAll('.graph-node').forEach(el => {
            el.classList.add('dimmed');
        });
        document.querySelectorAll('.graph-connection').forEach(el => {
            el.classList.add('dimmed');
        });

        // 選択ノードと接続ノードをハイライト
        const connectedIds = new Set([node.id]);
        for (const conn of this.connections) {
            if (conn.from === node.id) connectedIds.add(conn.to);
            if (conn.to === node.id) connectedIds.add(conn.from);
        }

        connectedIds.forEach(id => {
            const el = document.querySelector(`g[data-node-id="${id}"]`);
            if (el) el.classList.remove('dimmed');
        });

        // 関連接続線もハイライト
        for (const conn of this.connections) {
            if (conn.from === node.id || conn.to === node.id) {
                const line = document.querySelector(
                    `line[data-from="${conn.from}"][data-to="${conn.to}"]`);
                if (line) {
                    line.classList.remove('dimmed');
                    line.classList.add('highlight');
                }
            }
        }
    }

    /**
     * 全てのハイライトを解除
     */
    unhighlightAll() {
        document.querySelectorAll('.dimmed').forEach(el => {
            el.classList.remove('dimmed');
        });
        document.querySelectorAll('.graph-connection.highlight').forEach(el => {
            el.classList.remove('highlight');
        });
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    window.virtualObjectNetworkApp = new VirtualObjectNetworkApp();
});
