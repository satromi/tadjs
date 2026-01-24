/**
 * スライドプラグイン
 * BasicTextEditorを継承し、完全なTAD描画機能を使用
 *
 * @module BasicSlide
 * @extends BasicTextEditor
 * @license MIT
 * @author satromi
 * @version 1.0.0
 */

// DOMContentLoaded後にBasicTextEditorが利用可能になるまで待機
document.addEventListener('DOMContentLoaded', () => {
    // BasicTextEditorが読み込まれるまで待機
    const waitForBasicTextEditor = () => {
        if (window.BasicTextEditor) {
            initSlidePlugin();
        } else {
            setTimeout(waitForBasicTextEditor, 50);
        }
    };
    waitForBasicTextEditor();
});

function initSlidePlugin() {
    const logger = window.getLogger('BasicSlide');

    class BasicSlide extends window.BasicTextEditor {
        constructor() {
            // BasicTextEditorのコンストラクタを呼び出し
            super();

            // プラグイン名を上書き
            this.pluginName = 'BasicSlide';

            // スライド固有の状態
            this.slides = [];              // スライドページ配列（仮身情報）
            this.currentSlideIndex = 0;    // 現在のスライドインデックス
            this.isEndScreen = false;      // 終了画面表示中

            // 解像度設定
            this.targetWidth = 1920;       // 指定解像度（幅）
            this.targetHeight = 1080;      // 指定解像度（高さ）
            this.scale = 1.0;              // 現在の拡大率

            // 親実身情報
            this.parentXtad = null;        // 親実身のXTADデータ

            // 編集機能を無効化
            this.isModified = false;
            if (this.editor) {
                this.editor.contentEditable = 'false';
            }

            // スライド固有の初期化
            this.initSlide();

            logger.info('[BasicSlide] スライドプラグインを初期化しました');
        }

        /**
         * スライド固有の初期化
         */
        initSlide() {
            // キーボードショートカットをスライド用に置き換え
            this.setupSlideKeyboardShortcuts();

            // マウスイベントを設定
            this.setupSlideMouseHandlers();

            // ウィンドウリサイズ時に拡大率を再計算
            window.addEventListener('resize', () => this.applyScale());
        }

        /**
         * MessageBusハンドラを設定（オーバーライド）
         * 親クラスの編集系ハンドラをスキップ
         */
        setupMessageBusHandlers() {
            // 共通ハンドラを登録
            this.setupCommonMessageBusHandlers();

            // initメッセージ
            this.messageBus.on('init', async (data) => {
                await this.handleSlideInit(data);
            });

            // load-dataメッセージ
            this.messageBus.on('load-data', async (data) => {
                await this.handleSlideLoadData(data);
            });

            // 右クリックメニュー
            this.setupContextMenu();
        }

        /**
         * 初期化処理（スライド用）
         */
        async handleSlideInit(data) {
            logger.info('[BasicSlide] handleSlideInit:', data);
            this.windowId = data.windowId;
            this.fileData = data.fileData;
            this.realId = data.fileData?.realId || data.fileData?.fileId;

            // XTADデータを取得
            const xtad = data.fileData?.xmlData ||
                         data.fileData?.records?.[0]?.xtad;

            if (xtad) {
                this.parentXtad = xtad;
                await this.parseSlideData(xtad);

                if (this.slides.length > 0) {
                    // 先にプレゼンテーションモード（全画面化）を完了させる
                    await this.enterPresentationModeAndWait();
                    // 全画面化完了後にスライド表示
                    await this.showSlide(0);
                    // スライドを表示可能にする
                    this.showSlideWrapper();
                } else {
                    // スライド（仮身）がない場合はエラー表示
                    this.editor.innerHTML = '<p style="color: red; padding: 20px;">スライドがありません。仮身を追加してください。</p>';
                    this.showSlideWrapper();
                }
            }
        }

        /**
         * load-data処理（スライド用）
         */
        async handleSlideLoadData(data) {
            logger.info('[BasicSlide] handleSlideLoadData:', data);
            this.realId = data.realId;
            this.windowId = data.windowId;

            // 実身データを読み込み
            const realData = await this.loadRealObjectData(data.realId);
            if (realData && realData.xmlData) {
                this.parentXtad = realData.xmlData;
                await this.parseSlideData(realData.xmlData);

                if (this.slides.length > 0) {
                    // 先にプレゼンテーションモード（全画面化）を完了させる
                    await this.enterPresentationModeAndWait();
                    // 全画面化完了後にスライド表示
                    await this.showSlide(0);
                    // スライドを表示可能にする
                    this.showSlideWrapper();
                } else {
                    this.editor.innerHTML = '<p style="color: red; padding: 20px;">スライドがありません。仮身を追加してください。</p>';
                    this.showSlideWrapper();
                }
            }
        }

        /**
         * 実身データを読み込む（XTADと実身名の両方を取得）
         * @param {string} realId - 実身ID
         * @returns {Promise<{xmlData: string, name: string}|null>} 実身データ
         */
        async loadRealObjectData(realId) {
            return new Promise((resolve) => {
                const messageId = this.generateMessageId('load-xtad');

                const handler = (data) => {
                    if (data.messageId === messageId) {
                        this.messageBus.off('real-object-loaded', handler);
                        // レスポンスは { success: true, realObject: { xmlData: ..., metadata: { name: ... } } } 形式
                        if (data.success && data.realObject && data.realObject.xmlData) {
                            resolve({
                                xmlData: data.realObject.xmlData,
                                name: data.realObject.metadata?.name || null
                            });
                        } else {
                            logger.error('[BasicSlide] 実身データ読み込み失敗:', data.error);
                            resolve(null);
                        }
                    }
                };

                this.messageBus.on('real-object-loaded', handler);
                this.messageBus.send('load-real-object', {
                    realId: realId,
                    messageId: messageId
                });

                // タイムアウト
                setTimeout(() => {
                    this.messageBus.off('real-object-loaded', handler);
                    resolve(null);
                }, 10000);
            });
        }

        /**
         * スライドデータを解析
         * @param {string} xtadContent - 親実身のXTADデータ
         */
        async parseSlideData(xtadContent) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xtadContent, 'text/xml');

            // 1行目から%size指定を取得
            const firstParagraph = xmlDoc.querySelector('p');
            if (firstParagraph) {
                const text = firstParagraph.textContent.trim();
                const sizeMatch = text.match(/^%size:(\d+):(\d+)$/);
                if (sizeMatch) {
                    this.targetWidth = parseInt(sizeMatch[1]);
                    this.targetHeight = parseInt(sizeMatch[2]);
                    logger.info(`[BasicSlide] 解像度設定: ${this.targetWidth}x${this.targetHeight}`);
                }
            }

            // 仮身（<link>）を取得してスライドとして登録
            const linkElements = xmlDoc.getElementsByTagName('link');
            this.slides = [];

            for (let i = 0; i < linkElements.length; i++) {
                const link = linkElements[i];
                // link idから実身IDを抽出（_X.xtadサフィックスを除去）
                const linkId = link.getAttribute('id') || '';
                const realId = linkId.replace(/_\d+\.xtad$/i, '');
                this.slides.push({
                    realId: realId,
                    name: `スライド ${i + 1}`, // 一旦仮名で登録
                    index: i
                });
            }

            logger.info(`[BasicSlide] スライド数: ${this.slides.length}`);

            // 各スライドの実身名を取得してキャッシュ
            for (let i = 0; i < this.slides.length; i++) {
                const slide = this.slides[i];
                if (slide.realId) {
                    const data = await this.loadRealObjectData(slide.realId);
                    if (data && data.name) {
                        this.slides[i].name = data.name;
                    }
                }
            }
            logger.info('[BasicSlide] スライド名読み込み完了');
        }

        /**
         * スライドを表示
         * @param {number} index - スライドインデックス
         */
        async showSlide(index) {
            if (index < 0 || index >= this.slides.length) {
                if (index >= this.slides.length) {
                    this.showEndScreen();
                }
                return;
            }

            this.currentSlideIndex = index;
            this.isEndScreen = false;

            const slide = this.slides[index];
            logger.info(`[BasicSlide] スライド表示: ${index + 1}/${this.slides.length} - ${slide.name}`);

            // スライドの実身データを読み込み
            const data = await this.loadRealObjectData(slide.realId);
            if (!data || !data.xmlData) {
                this.editor.innerHTML = `<p style="color: red; padding: 20px;">スライド「${slide.name}」の読み込みに失敗しました</p>`;
                return;
            }
            const xtad = data.xmlData;

            // 終了画面から戻った場合、背景色を元に戻す
            const wrapper = document.getElementById('slide-wrapper');
            const pluginContent = document.querySelector('.plugin-content');
            const editorContainer = document.querySelector('.editor-container');

            if (wrapper) {
                wrapper.style.background = '#000';  // ラッパーは黒（スライド周囲）
            }
            if (pluginContent) {
                pluginContent.style.background = '';
            }
            if (editorContainer) {
                editorContainer.style.background = '#fff';
                editorContainer.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
            }

            // エディタの背景を白に戻す
            this.editor.style.background = '#fff';
            this.editor.style.display = '';
            this.editor.style.justifyContent = '';
            this.editor.style.alignItems = '';

            // 親クラスのrenderTADXMLを使用して完全描画
            await this.renderTADXML(xtad);

            // 編集不可に再設定
            this.editor.contentEditable = 'false';

            // 拡大縮小を適用
            this.applyScale();

            // ステータスバーを更新
            this.setStatus(`${index + 1} / ${this.slides.length}: ${slide.name}`);
        }

        /**
         * 拡大縮小を適用
         */
        applyScale() {
            const wrapper = document.getElementById('slide-wrapper');
            const editorContainer = document.querySelector('.editor-container');

            if (!wrapper || !editorContainer) return;

            // 現在のウィンドウサイズ
            const windowWidth = wrapper.clientWidth;
            const windowHeight = wrapper.clientHeight;

            // 拡大率を計算（アスペクト比を維持）
            const scaleX = windowWidth / this.targetWidth;
            const scaleY = windowHeight / this.targetHeight;
            this.scale = Math.min(scaleX, scaleY);

            // CSS transformで拡大縮小
            editorContainer.style.width = `${this.targetWidth}px`;
            editorContainer.style.height = `${this.targetHeight}px`;
            editorContainer.style.transform = `scale(${this.scale})`;
            editorContainer.style.transformOrigin = 'center center';
        }

        /**
         * 次のスライドへ
         */
        nextSlide() {
            if (this.isEndScreen) {
                this.requestCloseWindow();
                return;
            }
            this.showSlide(this.currentSlideIndex + 1);
        }

        /**
         * 前のスライドへ
         */
        prevSlide() {
            if (this.isEndScreen) {
                this.isEndScreen = false;
                this.showSlide(this.slides.length - 1);
                return;
            }
            if (this.currentSlideIndex > 0) {
                this.showSlide(this.currentSlideIndex - 1);
            }
        }

        /**
         * 終了画面を表示
         */
        showEndScreen() {
            this.isEndScreen = true;
            logger.info('[BasicSlide] 終了画面を表示');

            const wrapper = document.getElementById('slide-wrapper');
            const pluginContent = document.querySelector('.plugin-content');
            const editorContainer = document.querySelector('.editor-container');

            // ラッパー全体を黒背景に
            if (wrapper) {
                wrapper.style.background = '#000';
            }
            if (pluginContent) {
                pluginContent.style.background = '#000';
            }
            if (editorContainer) {
                editorContainer.style.transform = 'none';
                editorContainer.style.width = '100%';
                editorContainer.style.height = '100%';
                editorContainer.style.background = '#000';
                editorContainer.style.boxShadow = 'none';
            }

            this.editor.innerHTML = '';
            this.editor.style.background = '#000';
            this.editor.style.display = 'flex';
            this.editor.style.justifyContent = 'center';
            this.editor.style.alignItems = 'center';
            this.editor.style.height = '100%';

            const message = document.createElement('div');
            message.className = 'end-screen-message';
            message.textContent = 'マウスクリックでスライドを終了します';
            this.editor.appendChild(message);

            this.setStatus('スライド終了');
        }

        /**
         * ジャンプダイアログを表示
         */
        async showJumpDialog() {
            // スライド一覧のHTMLを生成（標準クラスを使用）
            let listHtml = `<input type="hidden" id="selectedIndex" value="${this.currentSlideIndex}">`;
            listHtml += '<div class="dialog-listbox">';
            this.slides.forEach((slide, index) => {
                const isCurrent = index === this.currentSlideIndex;
                listHtml += `<div class="dialog-listbox-item${isCurrent ? ' current' : ''}" data-index="${index}">`;
                listHtml += `${index + 1}. ${this.escapeHtml(slide.name)}`;
                listHtml += '</div>';
            });
            listHtml += '</div>';

            // 選択状態を管理するスクリプト（イベント委譲を使用）
            const dialogScript = `
                <script>
                    const dialogMessage = document.getElementById('input-dialog-message');
                    const hiddenInput = document.getElementById('selectedIndex');

                    // イベント委譲を使用（DOM準備後も確実に動作）
                    dialogMessage.addEventListener('click', function(e) {
                        const item = e.target.closest('.dialog-listbox-item');
                        if (item) {
                            dialogMessage.querySelectorAll('.dialog-listbox-item').forEach(i => i.classList.remove('selected'));
                            item.classList.add('selected');
                            hiddenInput.value = item.dataset.index;
                        }
                    });

                    dialogMessage.addEventListener('dblclick', function(e) {
                        const item = e.target.closest('.dialog-listbox-item');
                        if (item) {
                            dialogMessage.querySelectorAll('.dialog-listbox-item').forEach(i => i.classList.remove('selected'));
                            item.classList.add('selected');
                            hiddenInput.value = item.dataset.index;
                            // 「選択」ボタン（2番目のボタン）をクリック
                            document.querySelector('.dialog-button[data-index="1"]')?.click();
                        }
                    });

                    // 現在のスライドを初期選択
                    const current = dialogMessage.querySelector('.dialog-listbox-item.current');
                    if (current) current.classList.add('selected');
                </script>
            `;

            const result = await this.showCustomDialog({
                title: 'ジャンプ',
                dialogHtml: listHtml + dialogScript,
                buttons: [
                    { label: 'キャンセル', value: 'cancel' },
                    { label: '選択', value: 'select' }
                ],
                defaultButton: 1,
                width: 400
            });

            if (result && result.button === 'select') {
                // formDataから選択されたインデックスを取得
                const selectedIndex = result.formData?.selectedIndex;
                if (selectedIndex !== undefined && !isNaN(parseInt(selectedIndex))) {
                    this.showSlide(parseInt(selectedIndex));
                }
            }
        }

        /**
         * キーボードショートカット（スライド用）
         */
        setupSlideKeyboardShortcuts() {
            document.addEventListener('keydown', (e) => {
                // Ctrl+E: 閉じる
                if (e.ctrlKey && e.key === 'e') {
                    e.preventDefault();
                    this.requestCloseWindow();
                    return;
                }

                // Ctrl+N: 次へ進む
                if (e.ctrlKey && e.key === 'n') {
                    e.preventDefault();
                    this.nextSlide();
                    return;
                }

                // Ctrl+P: 前に戻る
                if (e.ctrlKey && e.key === 'p') {
                    e.preventDefault();
                    this.prevSlide();
                    return;
                }

                // Ctrl+J: ジャンプ
                if (e.ctrlKey && e.key === 'j') {
                    e.preventDefault();
                    this.showJumpDialog();
                    return;
                }

                // 右カーソルキー: 次へ進む
                if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.nextSlide();
                    return;
                }

                // 左カーソルキー: 前に戻る
                if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.prevSlide();
                    return;
                }
            });
        }

        /**
         * マウスイベント（スライド用）
         */
        setupSlideMouseHandlers() {
            if (!this.editor) return;

            // 左クリック: 次へ進む
            this.editor.addEventListener('click', (e) => {
                // 仮身クリックの場合は除外
                if (e.target.closest('.virtual-object')) {
                    return;
                }
                this.nextSlide();
            });
        }

        /**
         * 背景色を変更
         */
        async changeBackgroundColor() {
            const colors = [
                { label: '白', value: '#ffffff' },
                { label: '黒', value: '#000000' },
                { label: 'グレー', value: '#808080' },
                { label: '青', value: '#000080' }
            ];

            let dialogHtml = '<div class="color-list">';
            colors.forEach(color => {
                dialogHtml += `<div class="color-item" data-color="${color.value}" style="display: flex; align-items: center; padding: 8px; cursor: pointer;">`;
                dialogHtml += `<div style="width: 24px; height: 24px; background: ${color.value}; border: 1px solid #808080; margin-right: 8px;"></div>`;
                dialogHtml += `<span>${color.label}</span>`;
                dialogHtml += '</div>';
            });
            dialogHtml += '</div>';

            const dialogScript = `
                <script>
                    let selectedColor = null;
                    document.querySelectorAll('.color-item').forEach(item => {
                        item.addEventListener('click', function() {
                            document.querySelectorAll('.color-item').forEach(i => i.style.background = '');
                            this.style.background = '#c0c0ff';
                            selectedColor = this.getAttribute('data-color');
                            // hidden inputに保存
                            let input = document.getElementById('selected-color');
                            if (!input) {
                                input = document.createElement('input');
                                input.type = 'hidden';
                                input.id = 'selected-color';
                                input.name = 'selectedColor';
                                document.body.appendChild(input);
                            }
                            input.value = selectedColor;
                        });
                    });
                </script>
            `;

            const result = await this.showCustomDialog({
                title: '背景色変更',
                dialogHtml: dialogHtml + dialogScript,
                buttons: [
                    { label: 'キャンセル', value: 'cancel' },
                    { label: 'OK', value: 'ok' }
                ],
                defaultButton: 1,
                width: 200
            });

            if (result && result.button === 'ok' && result.formData?.selectedColor) {
                const wrapper = document.getElementById('slide-wrapper');
                if (wrapper) {
                    wrapper.style.background = result.formData.selectedColor;
                }
            }
        }

        /**
         * メニュー定義（スライド用にオーバーライド）
         */
        async getMenuDefinition() {
            const menuDef = [];

            // 表示メニュー
            menuDef.push({
                label: '表示',
                submenu: [
                    { label: '再表示', action: 'refresh' },
                    { label: '背景色変更', action: 'change-bg-color' }
                ]
            });

            // 操作メニュー
            menuDef.push({
                label: '操作',
                submenu: [
                    { label: '次へ進む', action: 'next-slide', shortcut: 'Ctrl+N' },
                    { label: '前に戻る', action: 'prev-slide', shortcut: 'Ctrl+P' },
                    { label: 'ジャンプ', action: 'jump', shortcut: 'Ctrl+J' }
                ]
            });

            // 実行メニュー（選択中の仮身がある場合）
            if (this.contextMenuVirtualObject) {
                const realId = this.extractRealId(this.contextMenuVirtualObject.link_id);
                if (realId) {
                    const applistData = await this.getAppListData(realId);
                    if (applistData && Object.keys(applistData).length > 0) {
                        const executeSubmenu = [];
                        for (const [pluginId, appInfo] of Object.entries(applistData)) {
                            executeSubmenu.push({
                                label: appInfo.name || pluginId,
                                action: `execute-with-${pluginId}`
                            });
                        }
                        menuDef.push({
                            label: '実行',
                            submenu: executeSubmenu
                        });
                    }
                }
            }

            // 小物メニューは親ウィンドウ側で自動追加される

            return menuDef;
        }

        /**
         * メニューアクション実行（スライド用にオーバーライド）
         */
        executeMenuAction(action) {
            switch (action) {
                case 'refresh':
                    this.showSlide(this.currentSlideIndex);
                    break;
                case 'change-bg-color':
                    this.changeBackgroundColor();
                    break;
                case 'next-slide':
                    this.nextSlide();
                    break;
                case 'prev-slide':
                    this.prevSlide();
                    break;
                case 'jump':
                    this.showJumpDialog();
                    break;
                default:
                    if (action.startsWith('execute-with-')) {
                        const pluginId = action.replace('execute-with-', '');
                        this.executeWithPlugin(pluginId);
                    } else if (action.startsWith('accessory-')) {
                        // 小物メニューは親クラスに委譲
                        super.executeMenuAction(action);
                    }
                    break;
            }
        }

        /**
         * 指定プラグインで実行
         */
        executeWithPlugin(pluginId) {
            if (!this.contextMenuVirtualObject) return;

            const realId = this.extractRealId(this.contextMenuVirtualObject.link_id);
            if (realId) {
                this.messageBus.send('open-real-object', {
                    realId: realId,
                    pluginId: pluginId
                });
            }
        }

        /**
         * 実身IDを抽出
         */
        extractRealId(linkId) {
            if (!linkId) return null;
            // link_id形式: "realId" または "realId#segmentId"
            return linkId.split('#')[0];
        }

        /**
         * applistデータを取得
         */
        async getAppListData(realId) {
            return new Promise((resolve) => {
                const messageId = this.generateMessageId('get-applist');

                const handler = (data) => {
                    if (data.messageId === messageId) {
                        this.messageBus.off('applist-data', handler);
                        resolve(data.applist || {});
                    }
                };

                this.messageBus.on('applist-data', handler);
                this.messageBus.send('get-applist', {
                    realId: realId,
                    messageId: messageId
                });

                // タイムアウト
                setTimeout(() => {
                    this.messageBus.off('applist-data', handler);
                    resolve({});
                }, 3000);
            });
        }

        /**
         * HTMLエスケープ
         */
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        /**
         * クローズ要求処理（オーバーライド）
         * プレゼンテーションモード終了を確実に実行
         * @param {string} windowId - ウィンドウID
         */
        async handleCloseRequest(windowId) {
            // プレゼンテーションモード終了（ステータスバーのz-index復元）
            this.exitPresentationMode();

            // 親クラスの処理を呼び出し（保存確認など）
            await super.handleCloseRequest(windowId);
        }

        /**
         * ウィンドウを閉じる要求
         */
        requestCloseWindow() {
            // プレゼンテーションモード終了
            this.exitPresentationMode();

            // 少し遅延してからウィンドウを閉じる（フルスクリーン解除を待つ）
            setTimeout(() => {
                this.messageBus.send('close-window', {
                    windowId: this.windowId
                });
            }, 100);
        }

        /**
         * プレゼンテーションモード開始
         * スクロールバー非表示、タイトルバー非表示、内部ウィンドウ最大化
         * ※Electronフルスクリーンはユーザーがf11で操作する
         * ※完了を待機しない（後方互換性のため残す）
         */
        enterPresentationMode() {
            logger.info('[BasicSlide] プレゼンテーションモード開始');
            this.messageBus.send('enter-presentation-mode', {
                windowId: this.windowId,
                options: {
                    hideScrollbar: true,
                    hideFrame: true,
                    electronFullscreen: false  // ユーザーがF11で操作
                }
            });
        }

        /**
         * プレゼンテーションモード開始（完了を待機）
         * ウィンドウ最大化が完了してから解決するPromiseを返す
         * @returns {Promise<void>}
         */
        enterPresentationModeAndWait() {
            return new Promise((resolve) => {
                const messageId = this.generateMessageId('presentation-mode');

                // 完了メッセージを待機
                const handler = (data) => {
                    if (data.messageId === messageId) {
                        this.messageBus.off('enter-presentation-mode-complete', handler);
                        // リサイズ完了を確実に待つ
                        requestAnimationFrame(() => {
                            resolve();
                        });
                    }
                };

                this.messageBus.on('enter-presentation-mode-complete', handler);

                // プレゼンテーションモード開始メッセージ送信
                logger.info('[BasicSlide] プレゼンテーションモード開始（待機あり）');
                this.messageBus.send('enter-presentation-mode', {
                    windowId: this.windowId,
                    messageId: messageId,
                    options: {
                        hideScrollbar: true,
                        hideFrame: true,
                        electronFullscreen: false
                    }
                });

                // タイムアウト（フォールバック）
                setTimeout(() => {
                    this.messageBus.off('enter-presentation-mode-complete', handler);
                    resolve();
                }, 500);  // 500msでタイムアウト
            });
        }

        /**
         * プレゼンテーションモード終了
         */
        exitPresentationMode() {
            logger.info('[BasicSlide] プレゼンテーションモード終了');
            this.messageBus.send('exit-presentation-mode', {
                windowId: this.windowId
            });
        }

        /**
         * スライドラッパーを表示する
         * CSSで初期非表示になっているラッパーに'ready'クラスを追加
         */
        showSlideWrapper() {
            const wrapper = document.getElementById('slide-wrapper');
            if (wrapper) {
                wrapper.classList.add('ready');
            }
        }

        /**
         * 全画面化をリクエスト（後方互換性のため残す）
         * @deprecated enterPresentationMode()を使用してください
         */
        requestFullscreen() {
            this.enterPresentationMode();
        }
    }

    // プラグインを初期化
    window.slidePlugin = new BasicSlide();
}
