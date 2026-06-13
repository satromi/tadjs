export class ParagraphMarkRenderer {
    constructor() {
        this.type = 'paragraph-mark';
    }

    create() {
        const el = document.createElement('span');
        el.className = 'overlay-paragraph-mark';
        el.setAttribute('contenteditable', 'false');
        el.textContent = '¶';
        return el;
    }

    matches(node) {
        return node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'P';
    }

    findAnchors(root) {
        const results = [];
        if (root.nodeType === Node.ELEMENT_NODE) {
            if (root.nodeName === 'P') results.push(root);
            if (root.querySelectorAll) {
                root.querySelectorAll('p').forEach(p => results.push(p));
            }
        }
        return results;
    }

    position(anchor, tracker) {
        return tracker.paragraphEndPosition(anchor);
    }
}
