export class PositionTracker {
    constructor(editorElement, overlayElement) {
        this.editor = editorElement;
        this.overlay = overlayElement;
    }

    paragraphEndPosition(pElement) {
        if (!pElement.isConnected) return null;
        const range = document.createRange();
        range.selectNodeContents(pElement);
        const rects = range.getClientRects();
        if (rects.length === 0) {
            const r = pElement.getBoundingClientRect();
            return this._toEditorCoords({
                left: r.left + (this.editor.style.direction === 'rtl' ? 0 : 0),
                top: r.top,
                height: r.height || parseFloat(getComputedStyle(pElement).lineHeight) || 16,
            });
        }
        const lastRect = rects[rects.length - 1];
        return this._toEditorCoords({
            left: lastRect.right,
            top: lastRect.top,
            height: lastRect.height,
        });
    }

    brPosition(brElement) {
        if (!brElement.isConnected) return null;
        const parent = brElement.parentNode;

        // 優先: br 自身の getBoundingClientRect
        // 連続 br (<br><br><br>) でも各 br の実位置 (各行) が異なる値で取得できる
        // Range の collapsed setStartBefore は連続 br で前の line box を返すことがあり、
        // 全 ↵ が重なる問題があるため、 まず br rect を試す
        const brRect = brElement.getBoundingClientRect();
        if (brRect.height > 0 && (brRect.left !== 0 || brRect.top !== 0 || brRect.right !== 0)) {
            const lineHeight = parent && parent.nodeType === Node.ELEMENT_NODE
                ? parseFloat(getComputedStyle(parent).lineHeight) || brRect.height
                : brRect.height;
            return this._toEditorCoords({
                left: brRect.left,
                top: brRect.top,
                height: brRect.height || lineHeight,
            });
        }

        // フォールバック 1: Range の getClientRects (br の前の line box の右端)
        const range = document.createRange();
        try {
            range.setStartBefore(brElement);
            range.setEndBefore(brElement);
        } catch (e) {
            return null;
        }
        const rects = range.getClientRects();
        if (rects.length > 0) {
            const rect = rects[rects.length - 1];
            return this._toEditorCoords({
                left: rect.right,
                top: rect.top,
                height: rect.height,
            });
        }

        // フォールバック 2: parent の中身を br の前まで選択して getClientRects
        if (parent && parent.nodeType === Node.ELEMENT_NODE) {
            const parentRange = document.createRange();
            try {
                parentRange.selectNodeContents(parent);
                parentRange.setEndBefore(brElement);
                const parentRects = parentRange.getClientRects();
                if (parentRects.length > 0) {
                    const rect = parentRects[parentRects.length - 1];
                    return this._toEditorCoords({
                        left: rect.right,
                        top: rect.top,
                        height: rect.height,
                    });
                }
            } catch (e) {}
        }

        // フォールバック 3: 親段落 (P) の左上
        let p = parent;
        while (p && p.nodeName !== 'P' && p.nodeType === Node.ELEMENT_NODE) {
            p = p.parentNode;
        }
        if (p && p.nodeName === 'P') {
            const pRect = p.getBoundingClientRect();
            if (pRect.height > 0 || pRect.width > 0) {
                return this._toEditorCoords({
                    left: pRect.left,
                    top: pRect.top,
                    height: parseFloat(getComputedStyle(p).lineHeight) || 16,
                });
            }
        }
        return null;
    }

    indentAnchorPosition(anchorElement) {
        if (!anchorElement.isConnected) return null;
        const rect = anchorElement.getBoundingClientRect();
        const parent = anchorElement.parentNode;
        const lineHeight = parent && parent.nodeType === Node.ELEMENT_NODE
            ? parseFloat(getComputedStyle(parent).lineHeight) || rect.height
            : rect.height;
        if (rect.height === 0 && rect.width === 0 && rect.left === 0 && rect.top === 0) {
            return null;
        }
        return this._toEditorCoords({
            left: rect.left,
            top: rect.top,
            height: rect.height || lineHeight || 16,
        });
    }

    _toEditorCoords(viewport) {
        const editorRect = this.editor.getBoundingClientRect();
        return {
            left: viewport.left - editorRect.left + this.editor.scrollLeft,
            top: viewport.top - editorRect.top + this.editor.scrollTop,
            height: viewport.height,
        };
    }
}
