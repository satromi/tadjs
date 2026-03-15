/**
 * FigureClipboardMixin - クリップボード・ドラッグ&ドロップ関連機能
 *
 * ドラッグ&ドロップ、画像挿入、図形のコピー/カット/ペースト、
 * 図形削除を担当するMixin。
 *
 * 提供メソッド:
 * - setupDragAndDrop() - ドラッグ&ドロップイベントを設定
 * - insertImage(x, y, file) - 画像を配置
 * - getMemoryMaxImageNumber() - メモリ上の最大画像番号を取得
 * - getMemoryMaxPixelmapNumber() - メモリ上の最大pixelmap番号を取得
 * - getNextPixelmapNumber() - 次のpixelmap番号を取得
 * - deleteSelectedShapes() - 選択図形を削除
 * - deleteVirtualObjectShapes(shapesToDelete, options) - 仮身図形を削除
 * - copyShapes() - 選択図形をコピー
 * - cutShapes() - 選択図形を切り取り
 * - pasteShapes() - クリップボードから貼り付け
 * - pasteFigureSegmentFromClipboard(clipboardData) - figure-segmentデータを貼り付け
 * - pasteMove() - クリップボードから移動
 */

const logger = window.getLogger('BasicFigureEditor');

export const FigureClipboardMixin = (Base) => class extends Base {

    setupDragAndDrop() {
        // 重複登録を防ぐ
        if (this._dragDropSetup) {
            return;
        }
        this._dragDropSetup = true;

        // ドラッグオーバー
        this.canvas.addEventListener('dragover', (e) => {
            // 読み取り専用モードではドラッグ&ドロップを無効化
            if (this.readonly) {
                return;
            }
            e.preventDefault();
            // ドラッグ移動を検出（hasMovedフラグ設定）
            this.detectVirtualObjectDragMove(e);
            // copy と move の両方を受け付ける
            if (e.dataTransfer.effectAllowed === 'move' || e.dataTransfer.effectAllowed === 'copyMove') {
                e.dataTransfer.dropEffect = 'move';
            } else {
                e.dataTransfer.dropEffect = 'copy';
            }
            this.canvas.style.opacity = '0.8';
        });

        // ドラッグリーブ
        this.canvas.addEventListener('dragleave', (e) => {
            e.preventDefault();
            this.canvas.style.opacity = '1.0';
        });

        // ドロップ
        this.canvas.addEventListener('drop', async (e) => {
            e.preventDefault();
            this.canvas.style.opacity = '1.0';

            // URLドロップをチェック（PluginBase共通メソッド）
            const dropX = e.clientX;
            const dropY = e.clientY;
            if (this.checkAndHandleUrlDrop(e, dropX, dropY)) {
                return; // URLドロップは親ウィンドウで処理
            }

            try {
                // 画像ファイルのドロップをチェック
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    if (file.type.startsWith('image/')) {
                        const rect = this.canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        logger.debug('[FIGURE EDITOR] 画像ファイルドロップ:', file.name);
                        await this.insertImage(x, y, file);
                        return;
                    }
                }

                // PluginBase共通メソッドでdragDataをパース
                const dragData = this.parseDragData(e.dataTransfer);
                if (dragData) {
                    if (dragData.type === 'virtual-object-drag') {
                        // 仮身ドロップ（仮身一覧、基本文章編集などから）
                        logger.info(`[FIGURE EDITOR] 仮身ドロップを検出: source=${dragData.source}, isDuplicateDrag=${dragData.isDuplicateDrag}`);
                        const rect = this.canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;

                        const virtualObjects = dragData.virtualObjects || [dragData.virtualObject];
                        logger.debug('[FIGURE EDITOR] 仮身ドロップ受信:', virtualObjects.length, '個');

                        for (let index = 0; index < virtualObjects.length; index++) {
                            const virtualObject = virtualObjects[index];
                            let targetVirtualObject = virtualObject;

                            // ダブルクリックドラッグ（実身複製）の場合
                            if (dragData.isDuplicateDrag) {
                                logger.info('[FIGURE EDITOR] 実身複製ドラッグを検出');
                                try {
                                    targetVirtualObject = await this.duplicateRealObjectForDrag(virtualObject);
                                    logger.info(`[FIGURE EDITOR] 実身複製成功: ${virtualObject.link_id} -> ${targetVirtualObject.link_id}`);
                                } catch (error) {
                                    logger.error('[FIGURE EDITOR] 実身複製エラー:', error);
                                    continue;
                                }
                            }

                            const offsetX = targetVirtualObject.offsetX || 0;
                            const offsetY = targetVirtualObject.offsetY || 0;
                            // dragDataを渡してmode判定を正確に行う
                            await this.insertVirtualObject(x - offsetX, y - offsetY, targetVirtualObject, dragData);
                        }

                        if (dragData.sourceWindowId !== this.windowId) {
                            this.messageBus.send('cross-window-drop-in-progress', {
                                targetWindowId: this.windowId,
                                sourceWindowId: dragData.sourceWindowId
                            });
                            this.notifyCrossWindowDropSuccess(dragData, virtualObjects);
                        }
                        return;
                    } else if ((dragData.type === 'base-file-copy' || dragData.type === 'user-base-file-copy') && dragData.source === 'base-file-manager') {
                        // 原紙箱からのコピー（システム原紙またはユーザ原紙）
                        const rect = this.canvas.getBoundingClientRect();
                        const x = e.clientX - rect.left;
                        const y = e.clientY - rect.top;
                        this.handleBaseFileDrop(dragData, e.clientX, e.clientY, { dropPosition: { x, y } });
                        return;
                    }
                }
            } catch (error) {
                logger.error('[FIGURE EDITOR] ドロップ処理エラー:', error);
            }
        });

        // クリップボードペースト
        document.addEventListener('paste', async (e) => {
            // このエディタがアクティブな場合のみ処理
            if (!this.canvas || document.activeElement !== this.canvas) {
                return;
            }

            // ローカルクリップボードを優先チェック（図形データ）
            // 直近のローカル操作を優先する（basic-text-editorと同様の挙動）
            if (this.clipboard && this.clipboard.length > 0) {
                e.preventDefault();
                await this.pasteShapes();
                return;
            }

            // ローカルが空の場合、グローバルクリップボードをチェック
            const globalClipboard = await this.getGlobalClipboard();

            // 図形セグメント（xmlTAD）の場合
            if (globalClipboard && globalClipboard.type === 'figure-segment' && globalClipboard.xmlTad) {
                e.preventDefault();
                await this.pasteFigureSegmentFromClipboard(globalClipboard);
                return;
            }

            // グループ構造の場合（後方互換）
            if (globalClipboard && globalClipboard.type === 'group' && globalClipboard.group) {
                e.preventDefault();
                const group = JSON.parse(JSON.stringify(globalClipboard.group));
                this.offsetGroupCoordinates(group, 20, 20);
                group.zIndex = this.getNextZIndex();
                this.shapes.push(group);
                this.selectedShapes = [group];
                this.redraw();
                this.isModified = true;
                this.setStatus('グループを貼り付けました');
                return;
            }

            // 仮身データの場合
            if (globalClipboard && globalClipboard.link_id) {
                e.preventDefault();
                // 論理座標の中央に配置
                const x = this.canvas.width / this.zoomLevel / 2;
                const y = this.canvas.height / this.zoomLevel / 2;
                this.insertVirtualObject(x, y, globalClipboard);
                this.setStatus('仮身をクリップボードから貼り付けました');
                return;
            }

            // 画像データをチェック
            const items = e.clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    logger.debug('[FIGURE EDITOR] 画像をクリップボードからペースト');
                    // 論理座標の中央に配置
                    const x = this.canvas.width / this.zoomLevel / 2;
                    const y = this.canvas.height / this.zoomLevel / 2;
                    await this.insertImage(x, y, blob);
                    return;
                }
            }
        });
    }

    async insertImage(x, y, file) {
        logger.debug('[FIGURE EDITOR] 画像を配置:', file.name, 'at', x, y);

        // Undo用に状態を保存
        this.saveStateForUndo();

        // 画像をロード
        const img = new Image();
        const reader = new FileReader();

        return new Promise((resolve, reject) => {
            reader.onload = async (e) => {
                img.onload = async () => {
                    logger.debug('[FIGURE EDITOR] 画像ロード完了:', img.width, 'x', img.height);

                    // 画像が大きすぎる場合は縮小（最大10000px）
                    const maxSize = 10000;
                    let width = img.width;
                    let height = img.height;

                    if (width > maxSize || height > maxSize) {
                        const scale = Math.min(maxSize / width, maxSize / height);
                        width = width * scale;
                        height = height * scale;
                    }

                    // 画像番号を取得
                    const imgNo = await this.getNextImageNumber();

                    // ファイル名を生成: fileId_recordNo_imgNo.png
                    const fileId = this.realId || 'unknown';
                    const recordNo = 0;  // 常に0（レコード番号は使用しない）
                    const savedFileName = `${fileId}_${recordNo}_${imgNo}.png`;

                    // 画像ファイルを保存
                    await this.saveImageFile(file, savedFileName);

                    // 画像を図形として追加
                    const imageShape = {
                        type: 'image',
                        startX: x - width / 2,  // 中心に配置
                        startY: y - height / 2,
                        endX: x + width / 2,
                        endY: y + height / 2,
                        imageElement: img,
                        imageData: e.target.result,  // Base64データ（後方互換性のため保持）
                        fileName: savedFileName,  // 保存されたファイル名
                        originalFileName: file.name,  // 元のファイル名
                        mimeType: file.type,
                        imgNo: imgNo,
                        rotation: 0,
                        flipH: false,
                        flipV: false,
                        zIndex: this.getNextZIndex()
                    };

                    this.shapes.push(imageShape);
                    this.redraw();
                    this.isModified = true;
                    this.hasUnsavedChanges = true;
                    this.setStatus(`画像「${file.name}」を配置しました`);
                    // スクロールバー更新を通知
                    this.resizeCanvas();
                    resolve();
                };

                img.onerror = () => {
                    logger.error('[FIGURE EDITOR] 画像読み込みエラー');
                    this.setStatus('画像の読み込みに失敗しました');
                    reject(new Error('画像読み込みエラー'));
                };

                img.src = e.target.result;
            };

            reader.onerror = () => {
                logger.error('[FIGURE EDITOR] ファイル読み込みエラー');
                this.setStatus('ファイルの読み込みに失敗しました');
                reject(new Error('ファイル読み込みエラー'));
            };

            reader.readAsDataURL(file);
        });
    }

    /**
     * メモリ上の最大画像番号を取得（PluginBase.getNextImageNumber から呼ばれる）
     * @returns {number} 最大画像番号（-1で画像なし）
     */
    getMemoryMaxImageNumber() {
        let maxImgNo = -1;
        this.shapes.forEach(shape => {
            if (shape.type === 'image' && shape.imgNo !== undefined) {
                maxImgNo = Math.max(maxImgNo, shape.imgNo);
            }
        });
        return maxImgNo;
    }

    /**
     * メモリ上の最大pixelmap番号を取得
     * @returns {number} 最大pixelmap番号（-1でpixelmapなし）
     */
    getMemoryMaxPixelmapNumber() {
        let maxPixelmapNo = -1;
        this.shapes.forEach(shape => {
            if (shape.type === 'pixelmap' && shape.pixelmapNo !== undefined) {
                maxPixelmapNo = Math.max(maxPixelmapNo, shape.pixelmapNo);
            }
        });
        return maxPixelmapNo;
    }

    /**
     * 次のpixelmap番号を取得（メモリ+ディスク両方を考慮）
     * @returns {Promise<number>} 次のpixelmap番号
     */
    async getNextPixelmapNumber() {
        return this.getNextResourceNumber(() => this.getMemoryMaxPixelmapNumber());
    }

    async deleteSelectedShapes() {
        if (this.selectedShapes.length === 0) return;

        // 保護されている図形をフィルタリング
        const protectedShapes = this.selectedShapes.filter(shape =>
            shape.locked || shape.isBackground
        );
        const deletableShapes = this.selectedShapes.filter(shape =>
            !shape.locked && !shape.isBackground
        );

        // 保護されている図形がある場合は警告を表示
        if (protectedShapes.length > 0) {
            const protectionTypes = protectedShapes.map(shape => {
                if (shape.isBackground) return '背景化';
                if (shape.locked) return '固定化';
                return '';
            }).filter(t => t).join('、');

            logger.debug('[FIGURE EDITOR] 保護されている図形が含まれているため削除できません:', protectionTypes);
            this.setStatus(`${protectedShapes.length}個の図形が保護されているため削除できません (${protectionTypes})`);

            // 削除可能な図形がない場合は終了
            if (deletableShapes.length === 0) {
                return;
            }
        }

        // 画像またはピクセルマップが含まれているかチェック（後で自動保存するため）
        const hasImageOrPixelmap = deletableShapes.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );

        // 削除可能な図形のみ削除
        deletableShapes.forEach(shape => {
            // 仮身の場合はDOM要素を削除
            if (shape.type === 'vobj') {
                // vobjElement（仮身のDOM要素）を削除
                if (shape.vobjElement && shape.vobjElement.parentNode) {
                    shape.vobjElement.parentNode.removeChild(shape.vobjElement);
                }

                // expandedElement（開いた仮身のiframe要素）を削除
                if (shape.expanded && shape.expandedElement) {
                    shape.expandedElement.remove();
                    delete shape.expandedElement;
                }

                // refCount-1（ユーザーによる削除/カット）
                this.requestDeleteVirtualObject(shape.virtualObject.link_id);
            }

            // 画像の場合はPNGファイルを削除
            if (shape.type === 'image' && shape.fileName) {
                this.deleteImageFile(shape.fileName);
            }

            // ピクセルマップの場合もPNGファイルを削除
            if (shape.type === 'pixelmap' && shape.fileName) {
                this.deleteImageFile(shape.fileName);
            }

            const index = this.shapes.indexOf(shape);
            if (index > -1) {
                this.shapes.splice(index, 1);
            }
        });

        // 削除された図形を選択から除外し、保護された図形のみを選択状態に保つ
        this.selectedShapes = protectedShapes;
        this.redraw();
        this.isModified = true;
        // スクロールバー更新を通知
        this.resizeCanvas();

        // 画像またはピクセルマップが含まれていた場合は削除後に自動保存
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップを削除後: 自動保存を実行');
            await this.saveFile();
        }
    }

    /**
     * 仮身図形を削除する（共通処理）
     * @param {Array} shapesToDelete - 削除する仮身図形の配列
     * @param {Object} options - オプション {redraw: boolean, setModified: boolean}
     */
    deleteVirtualObjectShapes(shapesToDelete, options = {redraw: true, setModified: true}) {
        // 削除する図形のインデックスを記録（降順でソート）
        const indicesToDelete = shapesToDelete
            .map(s => this.shapes.indexOf(s))
            .filter(index => index > -1)
            .sort((a, b) => b - a); // 降順でソート（後ろから削除）

        logger.debug('[FIGURE EDITOR] 削除するインデックス:', indicesToDelete);

        shapesToDelete.forEach(s => {
            // 図形を削除
            const index = this.shapes.indexOf(s);
            if (index > -1) {
                this.shapes.splice(index, 1);
            }

            // 選択状態をクリア
            const selectedIndex = this.selectedShapes.indexOf(s);
            if (selectedIndex > -1) {
                this.selectedShapes.splice(selectedIndex, 1);
            }

            // DOM要素を削除
            if (s.vobjElement && s.vobjElement.parentNode) {
                s.vobjElement.parentNode.removeChild(s.vobjElement);
                logger.debug('[FIGURE EDITOR] 仮身DOM要素を削除:', s.virtualObject.link_name);
            }

            // 展開されたiframeがあれば削除
            if (s.expandedElement && s.expandedElement.parentNode) {
                s.expandedElement.parentNode.removeChild(s.expandedElement);
            }
        });

        // 削除後、接続線のインデックスを更新
        indicesToDelete.forEach(deletedIndex => {
            this.shapes.forEach(shape => {
                if (shape.type === 'line') {
                    // startConnection のインデックスを更新
                    if (shape.startConnection && shape.startConnection.shapeId > deletedIndex) {
                        const oldIndex = shape.startConnection.shapeId;
                        shape.startConnection.shapeId--;
                        logger.debug('[FIGURE EDITOR] 線の始点接続インデックスを更新:', oldIndex, '→', shape.startConnection.shapeId);
                    }
                    // endConnection のインデックスを更新
                    if (shape.endConnection && shape.endConnection.shapeId > deletedIndex) {
                        const oldIndex = shape.endConnection.shapeId;
                        shape.endConnection.shapeId--;
                        logger.debug('[FIGURE EDITOR] 線の終点接続インデックスを更新:', oldIndex, '→', shape.endConnection.shapeId);
                    }
                }
            });
        });

        // 再描画
        if (options.redraw) {
            this.redraw();
        }
        if (options.setModified) {
            this.isModified = true;
        }
    }

    // === クリップボード操作 ===
    async copyShapes() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 画像またはピクセルマップが含まれている場合は自動保存
        // realIdが未設定の場合はsaveFile内で新規実身を作成する
        const hasImageOrPixelmap = this.selectedShapes.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップをコピー: 自動保存を実行');
            await this.saveFile();
        }

        // 画像とピクセルマップを特別に処理してコピー
        this.clipboard = this.selectedShapes.map(shape => {
            const copiedShape = JSON.parse(JSON.stringify(shape));

            // 画像セグメントの場合
            if (shape.type === 'image' && shape.imageElement) {
                // imageElementは参照を保持
                copiedShape.imageElement = shape.imageElement;
                copiedShape.imageData = shape.imageData;
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                // ImageDataは新しいインスタンスを作成
                copiedShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
            }

            return copiedShape;
        });

        // グローバルクリップボードに送信
        const vobjShape = this.selectedShapes.find(shape => shape.type === 'vobj' && shape.virtualObject);
        if (vobjShape && vobjShape.virtualObject) {
            // 仮身が含まれている場合は仮身データを優先（virtual-object-listとの互換性）
            const clipboardData = JSON.parse(JSON.stringify(vobjShape.virtualObject));
            this.setClipboard(clipboardData);
        } else {
            // 選択図形をxmlTADに変換してfigure-segmentとして設定
            const xmlTad = await this.convertSelectedShapesToXmlTad(this.selectedShapes);
            if (xmlTad) {
                // 選択範囲のバウンディングボックスを計算
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const shape of this.selectedShapes) {
                    if (shape.startX !== undefined) {
                        minX = Math.min(minX, shape.startX);
                        minY = Math.min(minY, shape.startY);
                        maxX = Math.max(maxX, shape.endX);
                        maxY = Math.max(maxY, shape.endY);
                    }
                }
                this.setFigureSegmentClipboard(xmlTad, {
                    width: maxX - minX,
                    height: maxY - minY,
                    sourceRealId: this.realId
                });
            }
        }

        logger.debug('[FIGURE EDITOR] copyShapes完了: clipboard.length=', this.clipboard.length, 'shapes:', this.clipboard.map(s => s.type));
        this.setStatus(`${this.selectedShapes.length}個の図形をコピーしました`);
    }

    async cutShapes() {
        if (this.selectedShapes.length === 0) {
            this.setStatus('図形が選択されていません');
            return;
        }

        // 仮身が含まれている場合はグローバルクリップボードにも送信（削除前に取得）
        const vobjShape = this.selectedShapes.find(shape => shape.type === 'vobj' && shape.virtualObject);
        if (vobjShape && vobjShape.virtualObject) {
            // 仮身オブジェクト全体をコピー（virtual-object-listと同じ方式）
            const clipboardData = JSON.parse(JSON.stringify(vobjShape.virtualObject));
            this.setClipboard(clipboardData);
        } else {
            // 画像セグメントが含まれている場合はグローバルクリップボードにも送信（削除前に取得）
            const imageShape = this.selectedShapes.find(shape => shape.type === 'image' && shape.imageElement);
            if (imageShape && imageShape.imageElement) {
                this.setImageClipboard(imageShape.imageElement, {
                    width: imageShape.width,
                    height: imageShape.height,
                    name: imageShape.name || 'image.png'
                });
            }
        }

        // 画像とピクセルマップを特別に処理してコピー
        this.clipboard = this.selectedShapes.map(shape => {
            const copiedShape = JSON.parse(JSON.stringify(shape));

            // 画像セグメントの場合
            if (shape.type === 'image' && shape.imageElement) {
                copiedShape.imageElement = shape.imageElement;
                copiedShape.imageData = shape.imageData;
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                copiedShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
            }

            return copiedShape;
        });

        await this.deleteSelectedShapes();
        this.setStatus(`${this.clipboard.length}個の図形を切り取りました`);
    }

    async pasteShapes() {
        logger.debug('[FIGURE EDITOR] pasteShapes開始: clipboard=', this.clipboard ? this.clipboard.length : 'null', 'shapes:', this.clipboard ? this.clipboard.map(s => s.type) : []);
        // ローカルクリップボードを優先チェック（図形データ）
        // basic-text-editorと同様に、直近のローカル操作を優先
        if (this.clipboard && this.clipboard.length > 0) {
            // ローカルクリップボードから貼り付け（下のコードで処理）
            logger.debug('[FIGURE EDITOR] ローカルクリップボードから貼り付け');
        } else {
            // ローカルが空の場合、グローバルクリップボードをチェック
            logger.debug('[FIGURE EDITOR] ローカルクリップボードが空、グローバルをチェック');
            const globalClipboard = await this.getGlobalClipboard();

            // 図形セグメント（xmlTAD）の場合
            if (globalClipboard && globalClipboard.type === 'figure-segment' && globalClipboard.xmlTad) {
                await this.pasteFigureSegmentFromClipboard(globalClipboard);
                return;
            }

            // グループ構造の場合（後方互換）
            if (globalClipboard && globalClipboard.type === 'group' && globalClipboard.group) {
                logger.debug('[FIGURE EDITOR] グローバルクリップボードにグループがあります');
                const group = JSON.parse(JSON.stringify(globalClipboard.group));

                // 座標をオフセット（貼り付け位置調整）
                const offsetX = 20;
                const offsetY = 20;
                this.offsetGroupCoordinates(group, offsetX, offsetY);

                // 新しいz-indexを割り当て
                group.zIndex = this.getNextZIndex();

                this.shapes.push(group);
                this.selectedShapes = [group];
                this.redraw();
                this.isModified = true;
                this.setStatus('グループを貼り付けました');
                return;
            }

            // 仮身の場合
            if (globalClipboard && globalClipboard.link_id) {
                logger.debug('[FIGURE EDITOR] グローバルクリップボードに仮身があります:', globalClipboard.link_name);
                // キャンバス中央に配置
                const x = this.canvas.width / 2;
                const y = this.canvas.height / 2;
                this.insertVirtualObject(x, y, globalClipboard);
                this.setStatus('仮身をクリップボードから貼り付けました');
                return;
            }

            logger.debug('[FIGURE EDITOR] グローバルクリップボードも空');
            this.setStatus('クリップボードが空です');
            return;
        }

        // クリップボードの図形を複製して貼り付け（少しずらす）
        const pastedShapes = [];
        const imageSavePromises = [];

        for (const shape of this.clipboard) {
            const newShape = JSON.parse(JSON.stringify(shape));
            newShape.startX += 20;
            newShape.startY += 20;
            newShape.endX += 20;
            newShape.endY += 20;

            // 画像セグメントの場合
            if (shape.type === 'image') {
                // imageElementを復元
                if (shape.imageElement) {
                    newShape.imageElement = shape.imageElement;
                }
                if (shape.imageData) {
                    newShape.imageData = shape.imageData;
                }
                // 新しい画像番号を割り当て
                newShape.imgNo = await this.getNextImageNumber();
                // ファイル名を更新（this.realIdを使用）
                const fileId = this.realId || 'unknown';
                const recordNo = 0;
                newShape.fileName = `${fileId}_${recordNo}_${newShape.imgNo}.png`;

                // 画像ファイルを保存（imageElementがある場合）
                if (shape.imageElement) {
                    imageSavePromises.push(this.saveImageFromElement(shape.imageElement, newShape.fileName));
                    logger.debug('[FIGURE EDITOR] 画像ペースト: ファイル保存予約', newShape.fileName);
                }
            }

            // ピクセルマップの場合
            if (shape.type === 'pixelmap' && shape.imageData) {
                // ImageDataを復元
                newShape.imageData = new ImageData(
                    new Uint8ClampedArray(shape.imageData.data),
                    shape.imageData.width,
                    shape.imageData.height
                );
                // 新しいピクセルマップ番号を割り当て
                newShape.pixelmapNo = await this.getNextPixelmapNumber();
                // ファイル名を更新（this.realIdを使用）
                const fileId = this.realId || 'unknown';
                const recordNo = 0;
                newShape.fileName = `${fileId}_${recordNo}_${newShape.pixelmapNo}.png`;

                // ピクセルマップ画像ファイルを保存
                imageSavePromises.push(this.savePixelmapImageFile(newShape.imageData, newShape.fileName));
                logger.debug('[FIGURE EDITOR] ピクセルマップペースト: ファイル保存予約', newShape.fileName);
            }

            // 新しいz-indexを割り当て
            newShape.zIndex = this.getNextZIndex();

            pastedShapes.push(newShape);
        }

        // 画像ファイルの保存を待つ
        if (imageSavePromises.length > 0) {
            await Promise.all(imageSavePromises);
            logger.debug('[FIGURE EDITOR] 画像ファイル保存完了:', imageSavePromises.length, '件');
        }

        this.shapes.push(...pastedShapes);
        this.selectedShapes = pastedShapes;
        this.redraw();
        this.isModified = true;
        this.setStatus(`${pastedShapes.length}個の図形を貼り付けました`);
        // スクロールバー更新を通知
        this.resizeCanvas();

        // 画像またはピクセルマップが含まれている場合は自動保存
        const hasImageOrPixelmap = pastedShapes.some(shape =>
            shape.type === 'image' || shape.type === 'pixelmap'
        );
        if (hasImageOrPixelmap) {
            logger.debug('[FIGURE EDITOR] 画像/ピクセルマップをペースト: 自動保存を実行');
            await this.saveFile();
        }
        // クリップボードの位置を更新（次回ペースト時にさらにオフセット）
        for (const shape of this.clipboard) {
            shape.startX += 20;
            shape.startY += 20;
            shape.endX += 20;
            shape.endY += 20;
        }

        logger.debug('[FIGURE EDITOR] pasteShapes完了: clipboard.length=', this.clipboard ? this.clipboard.length : 'null');
    }

    /**
     * グローバルクリップボードのfigure-segmentデータを図形として貼り付け
     * @param {Object} clipboardData - { type: 'figure-segment', xmlTad, width, height }
     */
    async pasteFigureSegmentFromClipboard(clipboardData) {
        // parseXmlTadDataは初期読み込み用でthis.shapes等を全クリアするため、
        // 全状態を退避し、パース後に復元してから新規図形のみ追加する
        const prevShapes = [...this.shapes];
        const prevFigView = this.figView ? {...this.figView} : null;
        const prevFigDraw = this.figDraw ? {...this.figDraw} : null;
        const prevFigScale = this.figScale ? {...this.figScale} : null;
        const prevPaperWidth = this.paperWidth;
        const prevPaperHeight = this.paperHeight;
        const prevPaperSize = this.paperSize;
        const prevPaperMargin = this.paperMargin;

        // xmlTADをパースして図形データを読み込み（既存のパーサーを利用）
        await this.parseXmlTadData(clipboardData.xmlTad);

        // パースされた新規図形を取得（parseXmlTadDataがthis.shapesを差し替えているため全てが新規）
        const newShapes = [...this.shapes];

        // 全状態を復元
        this.shapes = prevShapes;
        if (prevFigView) this.figView = prevFigView;
        if (prevFigDraw) this.figDraw = prevFigDraw;
        if (prevFigScale) this.figScale = prevFigScale;
        this.paperWidth = prevPaperWidth;
        this.paperHeight = prevPaperHeight;
        this.paperSize = prevPaperSize;
        this.paperMargin = prevPaperMargin;

        if (newShapes.length === 0) {
            this.setStatus('図形セグメントの貼り付けに失敗しました');
            return;
        }

        // 座標をオフセット（貼り付け位置調整）して既存図形配列に追加
        for (const shape of newShapes) {
            if (shape.startX !== undefined) shape.startX += 20;
            if (shape.startY !== undefined) shape.startY += 20;
            if (shape.endX !== undefined) shape.endX += 20;
            if (shape.endY !== undefined) shape.endY += 20;
            // polyline/curveのpoints
            if (shape.points) {
                for (const p of shape.points) {
                    if (p.x !== undefined) p.x += 20;
                    if (p.y !== undefined) p.y += 20;
                }
            }
            // グループの場合は子図形も移動
            if (shape.type === 'group' && shape.shapes) {
                this.moveGroupShapes(shape, 20, 20);
            }
            // 新しいz-indexを割り当て
            shape.zIndex = this.getNextZIndex();
            this.shapes.push(shape);
        }

        this.selectedShapes = newShapes;
        this.redraw();
        this.isModified = true;
        this.setStatus(`${newShapes.length}個の図形を貼り付けました`);
    }

    // === 編集（追加） ===
    async pasteMove() {
        // ローカルクリップボードを優先チェック
        if (this.clipboard && this.clipboard.length > 0) {
            // クリップボードから移動（貼り付け後、クリップボードをクリア）
            await this.pasteShapes();
            this.clipboard = [];
            this.setStatus('クリップボードから移動しました');
            return;
        }

        // ローカルが空の場合、グローバルクリップボードをチェック
        const globalClipboard = await this.getGlobalClipboard();
        if (globalClipboard && globalClipboard.link_id) {
            // グローバルクリップボードからの場合は通常のペーストと同じ
            await this.pasteShapes();
            return;
        }

        this.setStatus('クリップボードが空です');
    }
};
