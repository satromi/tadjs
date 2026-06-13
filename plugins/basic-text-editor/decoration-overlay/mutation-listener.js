export class MutationListener {
    constructor(editorElement, manager) {
        this.editor = editorElement;
        this.manager = manager;
        this.observer = null;
        this.compositionActive = false;
        this._onCompositionStart = () => { this.compositionActive = true; };
        this._onCompositionEnd = () => {
            this.compositionActive = false;
            this.manager.refreshAll();
        };
    }

    start() {
        this.observer = new MutationObserver((mutations) => {
            if (this.compositionActive) return;
            this._processMutations(mutations);
        });
        this.observer.observe(this.editor, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        this.editor.addEventListener('compositionstart', this._onCompositionStart);
        this.editor.addEventListener('compositionend', this._onCompositionEnd);
    }

    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.editor.removeEventListener('compositionstart', this._onCompositionStart);
        this.editor.removeEventListener('compositionend', this._onCompositionEnd);
    }

    _processMutations(mutations) {
        const affectedParagraphs = new Set();
        let paragraphRemoved = false;  // 段落自身の削除/追加 (構造変化) を検知

        for (const m of mutations) {
            if (this._isInOverlay(m.target)) continue;

            if (m.type === 'childList') {
                m.removedNodes.forEach(removed => {
                    if (removed.nodeType !== Node.ELEMENT_NODE) return;
                    this.manager.onAnchorRemoved(removed);
                    if (removed.querySelectorAll) {
                        removed.querySelectorAll('p, br').forEach(d => this.manager.onAnchorRemoved(d));
                    }
                    // 段落 (P) or br/p を含むサブツリー が削除された場合、 周辺段落の装飾を再評価
                    if (removed.nodeName === 'P' ||
                        (removed.querySelector && removed.querySelector('p, br'))) {
                        paragraphRemoved = true;
                    }
                });
                m.addedNodes.forEach(added => {
                    if (added.nodeType !== Node.ELEMENT_NODE) return;
                    if (this._isInOverlay(added)) return;
                    // ブラウザが自動挿入する補助 br を data-filler でマーキング
                    // (handleKeyboardShortcuts による Shift+Enter 挿入 br は既に data-user-br 付き)
                    if (added.nodeName === 'BR' &&
                        !added.hasAttribute('data-user-br') &&
                        !added.hasAttribute('data-filler')) {
                        added.setAttribute('data-filler', '1');
                    }
                    // 追加されたサブツリー内の br も同様にマーキング
                    if (added.querySelectorAll) {
                        added.querySelectorAll('br').forEach(br => {
                            if (!br.hasAttribute('data-user-br') && !br.hasAttribute('data-filler')) {
                                br.setAttribute('data-filler', '1');
                            }
                        });
                    }
                    this.manager.onAnchorAdded(added);
                    // 段落 (P) が追加された場合、 構造変化として全体再評価
                    if (added.nodeName === 'P') paragraphRemoved = true;
                });
                const p = this._enclosingParagraph(m.target);
                if (p) affectedParagraphs.add(p);
            } else if (m.type === 'characterData') {
                const p = this._enclosingParagraph(m.target.parentNode);
                if (p) affectedParagraphs.add(p);
            }
        }

        affectedParagraphs.forEach(p => {
            this.manager.onAnchorChanged(p);
            this.manager.refreshScope(p);
        });

        // 段落の構造変化 (追加/削除/結合/分割) があった場合、 editor 全体を再評価
        // (Delete/Backspace で段落結合 → 残った段落の br の装飾が DOM と整合するように)
        if (paragraphRemoved) {
            this.manager.refreshScope(this.editor);
        }
    }

    _isInOverlay(node) {
        let n = node;
        while (n && n !== this.editor) {
            if (n.classList && n.classList.contains('decoration-overlay')) return true;
            n = n.parentNode;
        }
        return false;
    }

    _enclosingParagraph(node) {
        let n = node;
        while (n && n !== this.editor) {
            if (n.nodeType === Node.ELEMENT_NODE && n.nodeName === 'P') return n;
            n = n.parentNode;
        }
        return null;
    }
}
