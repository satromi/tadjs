export class BrMarkRenderer {
    constructor() {
        this.type = 'br-mark';
    }

    create() {
        const el = document.createElement('span');
        el.className = 'overlay-br-mark';
        el.setAttribute('contenteditable', 'false');
        el.textContent = '↵';
        return el;
    }

    matches(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.nodeName !== 'BR') return false;
        return !this._isParagraphFillerBr(node);
    }

    findAnchors(root) {
        const results = [];
        if (root.nodeType !== Node.ELEMENT_NODE) return results;
        if (root.nodeName === 'BR' && !this._isParagraphFillerBr(root)) {
            results.push(root);
        }
        if (root.querySelectorAll) {
            root.querySelectorAll('br').forEach(br => {
                if (!this._isParagraphFillerBr(br)) results.push(br);
            });
        }
        return results;
    }

    position(anchor, tracker) {
        return tracker.brPosition(anchor);
    }

    // 補助 br (data-filler 属性付き) のみ装飾対象外、 それ以外の br は全て装飾
    // data-filler は parser (空段落表示用) と MutationListener (ブラウザ自動挿入検知) が付与
    _isParagraphFillerBr(br) {
        return br.hasAttribute && br.hasAttribute('data-filler');
    }
}
