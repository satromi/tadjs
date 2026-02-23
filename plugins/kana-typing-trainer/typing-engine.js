/**
 * タイピングエンジン
 * 問題文パース、入力判定、統計計算を担当
 */
class TypingEngine {
    constructor() {
        this.kanaMapping = null;
        this.reverseMapping = {};
        this.handAssignment = null;
        this.fingerAssignment = null;

        this.allQuestions = [];
        this.questions = [];
        this.practiceQuestionCount = 10;
        this.currentQuestionIndex = 0;
        this.phrases = [];
        this.currentPhraseIndex = 0;
        this.currentCharIndex = 0;
        this.inputChars = '';

        this.stats = {
            correctCount: 0,
            wrongCount: 0,
            leftHandCount: 0,
            rightHandCount: 0,
            shiftCount: 0,
            totalKeystrokes: 0,
            totalDistance: 0,
            startTime: null,
            endTime: null
        };

        this.comboReverseMapping = {};
        this.maxComboOutputLength = 0;
        this.mappingData = null;

        this.lastKeyCode = null;
        this.isPracticing = false;
        this.isCompleted = false;
    }

    /**
     * かな入力配列を設定し、逆引きマップを構築
     */
    setKanaMapping(mappingData) {
        this.kanaMapping = mappingData.mapping || mappingData;
        this.mappingData = mappingData;
        this.handAssignment = mappingData.handAssignment || null;
        this.fingerAssignment = mappingData.fingerAssignment || null;
        this._buildReverseMapping();
    }

    /**
     * 逆引きマップ構築: かな文字 → { keyCode, shiftType }
     */
    _buildReverseMapping() {
        this.reverseMapping = {};
        this.comboReverseMapping = {};
        this.maxComboOutputLength = 0;
        const mapping = this.kanaMapping;

        for (const keyCode in mapping) {
            if (keyCode.startsWith('_')) continue;
            const entry = mapping[keyCode];

            if (entry.normal) {
                this.reverseMapping[entry.normal] = { keyCode: keyCode, shiftType: 'none' };
            }
            if (entry.leftShift) {
                this.reverseMapping[entry.leftShift] = { keyCode: keyCode, shiftType: 'left' };
            }
            if (entry.rightShift) {
                this.reverseMapping[entry.rightShift] = { keyCode: keyCode, shiftType: 'right' };
            }
        }

        // コンボ逆引きマップ構築
        var combos = this.mappingData && this.mappingData.combos;
        if (combos && Array.isArray(combos)) {
            for (var ci = 0; ci < combos.length; ci++) {
                var combo = combos[ci];
                if (combo.keys && combo.output) {
                    this.comboReverseMapping[combo.output] = { keys: combo.keys.slice() };
                    if (combo.output.length > this.maxComboOutputLength) {
                        this.maxComboOutputLength = combo.output.length;
                    }
                }
            }
        }
    }

    /**
     * 現在位置の期待入力を取得（コンボ/単一キー判別）
     * 貪欲マッチング: 長いコンボ出力を優先
     */
    _getExpectedInput() {
        if (!this.isPracticing || this.isCompleted) return null;
        if (this.currentCharIndex >= this.inputChars.length) return null;

        // コンボ貪欲マッチ: 長い出力から試行
        for (var len = this.maxComboOutputLength; len >= 1; len--) {
            if (this.currentCharIndex + len > this.inputChars.length) continue;
            var substr = this.inputChars.substring(this.currentCharIndex, this.currentCharIndex + len);
            var combo = this.comboReverseMapping[substr];
            if (combo) {
                return { isCombo: true, keys: combo.keys, output: substr };
            }
        }

        // 単一キーフォールバック
        var char = this.inputChars[this.currentCharIndex];
        var keyInfo = this.reverseMapping[char];
        if (keyInfo) {
            return { isCombo: false, keyCode: keyInfo.keyCode, shiftType: keyInfo.shiftType, output: char };
        }

        return null;
    }

    /**
     * 問題文XTADをパース
     * @param {string} xtadText - XTAD形式の問題文テキスト
     */
    parseQuestions(xtadText) {
        this.allQuestions = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(xtadText, 'text/xml');
        const paragraphs = doc.querySelectorAll('p');

        for (const p of paragraphs) {
            const text = p.textContent.trim();
            if (text) {
                this.allQuestions.push(text);
            }
        }

        if (this.allQuestions.length === 0) {
            this.allQuestions.push('こんにちは');
        }
        this.questions = this.allQuestions.slice();
    }

    /**
     * 現在の問題をパースして文節・入力文字列を生成
     */
    loadQuestion(index) {
        if (index < 0 || index >= this.questions.length) return;
        this.currentQuestionIndex = index;

        const text = this.questions[index];
        this.phrases = this._parsePhrases(text);
        this.currentPhraseIndex = 0;
        this.currentCharIndex = 0;
        this.inputChars = this._getPhraseInputText(0);
    }

    /**
     * 問題文テキストを文節にパース
     * 形式: "漢字(ふりがな) の 天気(てんき)"
     */
    _parsePhrases(text) {
        const parts = text.split(/\s+/);
        const phrases = [];
        const rubyRegex = /([^(（]+)[(（]([^)）]+)[)）]/g;

        for (const part of parts) {
            if (!part) continue;

            const segments = [];
            let inputText = '';
            let lastIndex = 0;

            let match;
            rubyRegex.lastIndex = 0;
            while ((match = rubyRegex.exec(part)) !== null) {
                if (match.index > lastIndex) {
                    const before = part.substring(lastIndex, match.index);
                    segments.push({ display: before, ruby: null });
                    inputText += before;
                }
                segments.push({ display: match[1], ruby: match[2] });
                inputText += match[2];
                lastIndex = match.index + match[0].length;
            }

            if (lastIndex < part.length) {
                const remaining = part.substring(lastIndex);
                segments.push({ display: remaining, ruby: null });
                inputText += remaining;
            }

            phrases.push({
                segments: segments,
                inputText: inputText,
                originalText: part
            });
        }

        return phrases;
    }

    /**
     * 指定文節の入力テキストを取得
     */
    _getPhraseInputText(phraseIndex) {
        if (phraseIndex < this.phrases.length) {
            return this.phrases[phraseIndex].inputText;
        }
        return '';
    }

    /**
     * 練習開始（ランダム出題: 全問からN問を重複なしで選出）
     */
    startPractice() {
        this._selectRandomQuestions();
        this.resetStats();
        this.loadQuestion(0);
        this.isPracticing = true;
        this.isCompleted = false;
        this.stats.startTime = Date.now();
    }

    /**
     * 全問プールからランダムにN問を重複なしで選出
     */
    _selectRandomQuestions() {
        const pool = this.allQuestions.slice();
        const count = Math.min(this.practiceQuestionCount, pool.length);
        this.questions = [];
        for (var i = 0; i < count; i++) {
            var idx = Math.floor(Math.random() * pool.length);
            this.questions.push(pool[idx]);
            pool.splice(idx, 1);
        }
    }

    /**
     * 統計リセット
     */
    resetStats() {
        this.stats = {
            correctCount: 0,
            wrongCount: 0,
            leftHandCount: 0,
            rightHandCount: 0,
            shiftCount: 0,
            totalKeystrokes: 0,
            totalDistance: 0,
            startTime: null,
            endTime: null
        };
        this.lastKeyCode = null;
    }

    /**
     * 入力を処理
     * @param {string} keyCode - KeyboardEvent.code
     * @param {boolean} leftShiftHeld - 左シフトが押されているか
     * @param {boolean} rightShiftHeld - 右シフトが押されているか
     * @param {Function} getKeyPosition - キー座標取得関数
     * @param {Set} heldKeys - 現在押下中のキーのSet（コンボ判定用）
     * @returns {Object} { correct, char, keyCode, finished, phraseFinished, partial, comboKeys }
     */
    processInput(keyCode, leftShiftHeld, rightShiftHeld, getKeyPosition, heldKeys) {
        if (!this.isPracticing || this.isCompleted) {
            return { correct: false, char: null, keyCode: keyCode, finished: false, phraseFinished: false };
        }

        var expected = this._getExpectedInput();
        if (!expected) {
            return { correct: false, char: null, keyCode: keyCode, finished: false, phraseFinished: false };
        }

        // 共通統計: 打鍵数・左右手・移動距離
        this.stats.totalKeystrokes++;
        if (this.handAssignment) {
            if (this.handAssignment.left && this.handAssignment.left.includes(keyCode)) {
                this.stats.leftHandCount++;
            } else if (this.handAssignment.right && this.handAssignment.right.includes(keyCode)) {
                this.stats.rightHandCount++;
            }
        }
        if (getKeyPosition && this.lastKeyCode) {
            var lastPos = getKeyPosition(this.lastKeyCode);
            var currentPos = getKeyPosition(keyCode);
            if (lastPos && currentPos) {
                var dx = currentPos.x - lastPos.x;
                var dy = currentPos.y - lastPos.y;
                this.stats.totalDistance += Math.sqrt(dx * dx + dy * dy);
            }
        }
        this.lastKeyCode = keyCode;

        // === コンボ入力パス ===
        if (expected.isCombo) {
            // コンボキーに含まれないキー → 誤入力
            if (!expected.keys.includes(keyCode)) {
                this.stats.wrongCount++;
                return { correct: false, char: null, keyCode: keyCode, finished: false, phraseFinished: false, comboWrong: true };
            }
            // 全キー揃っていない → 部分入力（待機）
            if (!heldKeys || !expected.keys.every(function(k) { return heldKeys.has(k); })) {
                return { correct: null, partial: true, char: null, keyCode: keyCode, finished: false, phraseFinished: false, comboKeys: expected.keys };
            }
            // 全キー揃った → 正解
            this.stats.correctCount++;
            this.currentCharIndex += expected.output.length;
            var result = this._checkAdvance(expected.output, keyCode);
            result.comboKeys = expected.keys;
            return result;
        }

        // === 単一キー入力パス（既存ロジック） ===
        var mapping = this.kanaMapping[keyCode];
        if (!mapping) {
            return { correct: false, char: null, keyCode: keyCode, finished: false, phraseFinished: false };
        }

        var inputChar;
        if (leftShiftHeld && mapping.leftShift) {
            inputChar = mapping.leftShift;
        } else if (rightShiftHeld && mapping.rightShift) {
            inputChar = mapping.rightShift;
        } else {
            inputChar = mapping.normal;
        }

        if (!inputChar) {
            return { correct: false, char: null, keyCode: keyCode, finished: false, phraseFinished: false };
        }

        var expectedChar = this.inputChars[this.currentCharIndex];

        if (inputChar === expectedChar) {
            this.stats.correctCount++;
            var expectedKeyInfo = this.reverseMapping[expectedChar];
            if (expectedKeyInfo && expectedKeyInfo.shiftType !== 'none') {
                this.stats.shiftCount++;
            }
            this.currentCharIndex++;
            return this._checkAdvance(inputChar, keyCode);
        } else {
            this.stats.wrongCount++;
            return { correct: false, char: inputChar, keyCode: keyCode, finished: false, phraseFinished: false };
        }
    }

    /**
     * 正解後の文節・問題送りチェック
     */
    _checkAdvance(inputChar, keyCode) {
        var phraseFinished = false;
        var questionFinished = false;
        var finished = false;

        if (this.currentCharIndex >= this.inputChars.length) {
            phraseFinished = true;
            this.currentPhraseIndex++;

            if (this.currentPhraseIndex >= this.phrases.length) {
                if (this.currentQuestionIndex + 1 < this.questions.length) {
                    this.currentQuestionIndex++;
                    this.phrases = this._parsePhrases(this.questions[this.currentQuestionIndex]);
                    this.currentPhraseIndex = 0;
                    this.currentCharIndex = 0;
                    this.inputChars = this._getPhraseInputText(0);
                    questionFinished = true;
                } else {
                    finished = true;
                    this.isCompleted = true;
                    this.isPracticing = false;
                    this.stats.endTime = Date.now();
                }
            } else {
                this.currentCharIndex = 0;
                this.inputChars = this._getPhraseInputText(this.currentPhraseIndex);
            }
        }

        return { correct: true, char: inputChar, keyCode: keyCode, finished: finished, phraseFinished: phraseFinished, questionFinished: questionFinished };
    }

    /**
     * 同じ指で打つキーかどうかを判定
     */
    _sameFingerKeys(keyCode1, keyCode2) {
        if (!this.fingerAssignment) return false;
        for (const finger in this.fingerAssignment) {
            const keys = this.fingerAssignment[finger];
            if (keys.includes(keyCode1) && keys.includes(keyCode2)) {
                return true;
            }
        }
        return false;
    }

    /**
     * 次に打つべきキーのリストを取得（先読み用）
     * @param {number} count - 先読みキー数
     * @returns {Array} [{keyCode, shiftType, char},...]
     */
    getNextKeys(count) {
        if (!this.isPracticing || this.isCompleted) return [];

        var result = [];
        var phraseIdx = this.currentPhraseIndex;
        var charIdx = this.currentCharIndex;
        var currentInput = this.inputChars;

        for (var i = 0; i < count; i++) {
            if (phraseIdx >= this.phrases.length) break;
            if (charIdx >= currentInput.length) {
                phraseIdx++;
                if (phraseIdx >= this.phrases.length) break;
                charIdx = 0;
                currentInput = this._getPhraseInputText(phraseIdx);
            }

            var matched = false;

            // コンボ貪欲マッチ（長い出力から試行）
            for (var len = this.maxComboOutputLength; len >= 1; len--) {
                if (charIdx + len > currentInput.length) continue;
                var substr = currentInput.substring(charIdx, charIdx + len);
                var combo = this.comboReverseMapping[substr];
                if (combo) {
                    result.push({
                        keys: combo.keys,
                        isCombo: true,
                        char: substr
                    });
                    charIdx += len;
                    matched = true;
                    break;
                }
            }

            // 単一キーフォールバック
            if (!matched) {
                var char = currentInput[charIdx];
                var keyInfo = this.reverseMapping[char];
                if (keyInfo) {
                    result.push({
                        keyCode: keyInfo.keyCode,
                        shiftType: keyInfo.shiftType,
                        char: char
                    });
                }
                charIdx++;
            }
        }

        return result;
    }

    /**
     * 統計情報を取得
     */
    getStats() {
        const elapsed = this._getElapsedMinutes();
        const total = this.stats.correctCount + this.stats.wrongCount;

        return {
            speed: elapsed > 0 ? Math.round(this.stats.correctCount / elapsed) : 0,
            accuracy: total > 0 ? (this.stats.correctCount / total * 100).toFixed(1) : '100.0',
            leftHandCount: this.stats.leftHandCount,
            rightHandCount: this.stats.rightHandCount,
            shiftRatio: this.stats.correctCount > 0
                ? (this.stats.shiftCount / this.stats.correctCount * 100).toFixed(1)
                : '0.0',
            distance: this.stats.correctCount > 0
                ? (this.stats.totalDistance / this.stats.correctCount).toFixed(2)
                : '0.00',
            totalDistance: this.stats.totalDistance.toFixed(1),
            correctCount: this.stats.correctCount,
            wrongCount: this.stats.wrongCount,
            totalKeystrokes: this.stats.totalKeystrokes,
            elapsedSeconds: this._getElapsedSeconds()
        };
    }

    _getElapsedMinutes() {
        if (!this.stats.startTime) return 0;
        const end = this.stats.endTime || Date.now();
        return (end - this.stats.startTime) / 60000;
    }

    _getElapsedSeconds() {
        if (!this.stats.startTime) return 0;
        const end = this.stats.endTime || Date.now();
        return Math.round((end - this.stats.startTime) / 1000);
    }

    /**
     * 現在の問題数 / 総問題数
     */
    getProgress() {
        return {
            current: this.currentQuestionIndex + 1,
            total: this.questions.length
        };
    }

    /**
     * 現在の文節情報を取得
     */
    getCurrentState() {
        var expected = this._getExpectedInput();
        return {
            phrases: this.phrases,
            currentPhraseIndex: this.currentPhraseIndex,
            currentCharIndex: this.currentCharIndex,
            inputChars: this.inputChars,
            isPracticing: this.isPracticing,
            isCompleted: this.isCompleted,
            expectedLength: expected ? expected.output.length : 1
        };
    }
}
