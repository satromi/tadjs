export class IndentMarkRenderer {
    constructor() {
        this.type = 'indent-mark';
    }

    create() {
        const el = document.createElement('span');
        el.className = 'overlay-indent-mark';
        el.setAttribute('contenteditable', 'false');
        // Г 字形: 左に太い縦線 + 上から右に短い細い水平線
        el.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
            + '<line x1="2" y1="0" x2="2" y2="16" stroke="currentColor" stroke-width="3" stroke-linecap="butt"/>'
            + '<line x1="2" y1="1" x2="9" y2="1" stroke="currentColor" stroke-width="1" stroke-linecap="butt"/>'
            + '</svg>';
        return el;
    }

    matches(node) {
        return node.nodeType === Node.ELEMENT_NODE
            && node.classList
            && node.classList.contains('indent-anchor');
    }

    findAnchors(root) {
        const results = [];
        if (root.nodeType !== Node.ELEMENT_NODE) return results;
        if (root.classList && root.classList.contains('indent-anchor')) {
            results.push(root);
        }
        if (root.querySelectorAll) {
            root.querySelectorAll('.indent-anchor').forEach(a => results.push(a));
        }
        return results;
    }

    position(anchor, tracker) {
        return tracker.indentAnchorPosition(anchor);
    }
}
