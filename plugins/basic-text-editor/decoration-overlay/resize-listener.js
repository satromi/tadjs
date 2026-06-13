export class ResizeListener {
    constructor(editorElement, manager) {
        this.editor = editorElement;
        this.manager = manager;
        this.observer = null;
        const refresh = () => this.manager.refreshAll();
        this._refreshDebounced = (typeof window !== 'undefined' && window.debounce)
            ? window.debounce(refresh, 50)
            : refresh;
        this._fontsHandlerAttached = false;
    }

    start() {
        if (typeof ResizeObserver !== 'undefined') {
            this.observer = new ResizeObserver(() => this._refreshDebounced());
            this.observer.observe(this.editor);
        }
        if (!this._fontsHandlerAttached && document.fonts && document.fonts.ready) {
            this._fontsHandlerAttached = true;
            document.fonts.ready.then(() => {
                if (this.manager.enabled) this.manager.refreshAll();
            });
        }
    }

    stop() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
}
