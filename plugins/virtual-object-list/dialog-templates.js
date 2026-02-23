/**
 * virtual-object-list ダイアログテンプレート
 * showCustomDialog() に渡すHTMLテンプレートを関数として定義
 */

/**
 * 整頓ダイアログのHTMLテンプレートを生成
 * @param {Object} params - テンプレートパラメータ
 * @param {number} params.selectedCount - 選択数
 * @param {string} params.disabledClass - 無効状態のCSSクラス（'disabled' or ''）
 * @param {string} params.disabledAttr - 無効状態のHTML属性（'disabled' or ''）
 * @returns {string} HTMLテンプレート文字列
 */
function buildArrangeDialogHtml(params) {
    const { selectedCount, disabledClass, disabledAttr } = params;

    return `
<div class="arrange-dialog" style="font-size:11px">
    <div style="margin:0 0 8px 0;padding:0">選択: ${selectedCount}個</div>
    <div style="display:flex;gap:12px;margin:0;padding:0">
        <!-- 第1列: 横、縦、段組数 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">横</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="horizontal" value="left" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>左揃え</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="horizontal" value="right" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>右揃え</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="horizontal" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">縦</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="vertical" value="compact" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>詰める</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="vertical" value="align" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>上揃え</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="vertical" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:4px">
                <span style="font-weight:bold;min-width:40px">段組数</span>
                <input type="number" id="columnCount" min="1" value="1" style="width:40px;font-size:11px" ${disabledAttr}>
            </div>
        </div>
        <!-- 第2列: 段組、幅調整 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">段組</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="single" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>1段</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="multi-horizontal" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>左右</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="column" value="multi-vertical" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>上下</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="column" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">幅調整</span>
                <div class="radio-group-vertical">
                    <label class="radio-label">
                        <input type="radio" name="length" value="first">
                        <span class="radio-indicator"></span>
                        <span>最初</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="full">
                        <span class="radio-indicator"></span>
                        <span>全項目</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="icon-name">
                        <span class="radio-indicator"></span>
                        <span>名前まで</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="with-relation">
                        <span class="radio-indicator"></span>
                        <span>続柄まで</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="without-date">
                        <span class="radio-indicator"></span>
                        <span>日付除く</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="length" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
        </div>
        <!-- 第3列: 整列順、順序 -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">整列順</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="name" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>名前</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="created" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>作成日</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="updated" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>更新日</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortBy" value="size" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>サイズ</span>
                    </label>
                    <label class="radio-label">
                        <input type="radio" name="sortBy" value="none" checked>
                        <span class="radio-indicator"></span>
                        <span>なし</span>
                    </label>
                </div>
            </div>
            <div style="display:flex;align-items:flex-start;gap:4px">
                <span style="font-weight:bold;min-width:40px">順序</span>
                <div class="radio-group-vertical">
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortOrder" value="asc" checked ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>昇順</span>
                    </label>
                    <label class="radio-label ${disabledClass}">
                        <input type="radio" name="sortOrder" value="desc" ${disabledAttr}>
                        <span class="radio-indicator"></span>
                        <span>降順</span>
                    </label>
                </div>
            </div>
        </div>
    </div>
</div>`;
}
