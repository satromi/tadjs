import { PositionTracker } from './position-tracker.js';
import { MutationListener } from './mutation-listener.js';
import { ResizeListener } from './resize-listener.js';

export class DecorationManager {
    constructor(editorElement, overlayElement) {
        this.editor = editorElement;
        this.overlay = overlayElement;
        this.renderers = new Map();
        this.decorations = new Map();
        this.anchorToIds = new WeakMap();
        this.nextId = 1;
        this.enabled = false;
        this.pendingUpdate = false;

        this.positionTracker = new PositionTracker(editorElement, overlayElement);
        this.mutationListener = new MutationListener(editorElement, this);
        this.resizeListener = new ResizeListener(editorElement, this);
    }

    registerRenderer(renderer) {
        this.renderers.set(renderer.type, renderer);
    }

    enable() {
        if (this.enabled) return;
        this.enabled = true;
        this.mutationListener.start();
        this.resizeListener.start();
        this.scanAndCreate();
    }

    disable() {
        if (!this.enabled) return;
        this.enabled = false;
        this.mutationListener.stop();
        this.resizeListener.stop();
        this.clearAll();
    }

    rebuild() {
        if (!this.enabled) return;
        this.clearAll();
        this.scanAndCreate();
    }

    refreshAll() {
        if (!this.enabled) return;
        this._scheduleUpdate();
    }

    scanAndCreate() {
        for (const renderer of this.renderers.values()) {
            const anchors = renderer.findAnchors(this.editor);
            for (const anchor of anchors) {
                if (this._isInOverlay(anchor)) continue;
                this._createDecoration(renderer.type, anchor);
            }
        }
        this._scheduleUpdate();
    }

    onAnchorAdded(node) {
        if (this._isInOverlay(node)) return;
        for (const renderer of this.renderers.values()) {
            if (renderer.matches(node)) {
                this._createDecoration(renderer.type, node);
            }
            const descendants = renderer.findAnchors(node);
            for (const d of descendants) {
                if (d === node) continue;
                if (this._isInOverlay(d)) continue;
                this._createDecoration(renderer.type, d);
            }
        }
        this._scheduleUpdate();
    }

    onAnchorRemoved(anchor) {
        const ids = this.anchorToIds.get(anchor);
        if (!ids) return;
        for (const id of [...ids]) this._removeDecoration(id);
        this.anchorToIds.delete(anchor);
    }

    onAnchorChanged(anchor) {
        const ids = this.anchorToIds.get(anchor);
        if (!ids || ids.size === 0) return;
        this._scheduleUpdate();
    }

    // scope 要素配下の anchor について、 装飾の有無を Renderer の findAnchors で再評価する
    // (例: 段落の状態変化で「空段落補助 br」 → 「ユーザー意図 br」 に変わったとき装飾を追加)
    refreshScope(scope) {
        if (!this.enabled || !scope) return;
        for (const renderer of this.renderers.values()) {
            const validAnchors = new Set(renderer.findAnchors(scope));
            // この scope 内に存在する既存装飾を列挙
            const existing = [];
            for (const [id, deco] of this.decorations) {
                if (deco.type !== renderer.type) continue;
                if (deco.anchor === scope || scope.contains(deco.anchor)) {
                    existing.push({ id, anchor: deco.anchor });
                }
            }
            // 既存装飾のうち、 装飾対象でなくなったものは削除
            for (const { id, anchor } of existing) {
                if (!validAnchors.has(anchor)) {
                    this._removeDecoration(id);
                }
            }
            // 装飾対象だがまだ装飾されていないものは追加
            for (const anchor of validAnchors) {
                const ids = this.anchorToIds.get(anchor);
                const alreadyHasThisType = ids && [...ids].some(id => {
                    const d = this.decorations.get(id);
                    return d && d.type === renderer.type;
                });
                if (!alreadyHasThisType) {
                    this._createDecoration(renderer.type, anchor);
                }
            }
        }
        this._scheduleUpdate();
    }

    clearAll() {
        for (const deco of this.decorations.values()) {
            deco.dom.remove();
        }
        this.decorations.clear();
        this.anchorToIds = new WeakMap();
    }

    _createDecoration(type, anchor) {
        const renderer = this.renderers.get(type);
        if (!renderer) return null;
        const existing = this.anchorToIds.get(anchor);
        if (existing) {
            for (const id of existing) {
                const d = this.decorations.get(id);
                if (d && d.type === type) return id;
            }
        }
        const id = this.nextId++;
        const dom = renderer.create();
        this.overlay.appendChild(dom);
        this.decorations.set(id, { type, anchor, dom });
        let ids = this.anchorToIds.get(anchor);
        if (!ids) {
            ids = new Set();
            this.anchorToIds.set(anchor, ids);
        }
        ids.add(id);
        return id;
    }

    _removeDecoration(id) {
        const deco = this.decorations.get(id);
        if (!deco) return;
        deco.dom.remove();
        const ids = this.anchorToIds.get(deco.anchor);
        if (ids) ids.delete(id);
        this.decorations.delete(id);
    }

    _scheduleUpdate() {
        if (this.pendingUpdate) return;
        this.pendingUpdate = true;
        requestAnimationFrame(() => {
            this.pendingUpdate = false;
            this._updateAllPositions();
        });
    }

    _updateAllPositions() {
        const orphaned = [];
        for (const [id, deco] of this.decorations) {
            if (!deco.anchor.isConnected) {
                orphaned.push(id);
                continue;
            }
            const renderer = this.renderers.get(deco.type);
            if (!renderer) continue;
            const pos = renderer.position(deco.anchor, this.positionTracker);
            if (pos) {
                deco.dom.style.left = `${pos.left}px`;
                deco.dom.style.top = `${pos.top}px`;
                if (pos.height) deco.dom.style.height = `${pos.height}px`;
            }
        }
        orphaned.forEach(id => this._removeDecoration(id));
    }

    _isInOverlay(node) {
        let n = node;
        while (n && n !== this.editor) {
            if (n.classList && n.classList.contains('decoration-overlay')) return true;
            n = n.parentNode;
        }
        return false;
    }
}
