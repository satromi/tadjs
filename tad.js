/**
 * 
 *   Copyright [2023] [satromi]
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 *
 * TADjs Ver0.01
 *
 * BTRONのドキュメント形式である文章TAD、図形TADをブラウザ上で表示するツールです
 * @link https://github.com/satromi/tadjs
 * @author satromi@gmail.com Tw  @satromi
 * @license https://www.apache.org/licenses/LICENSE-2.0 Apache-2.0
*/

// global
var ctx;
var canvas;
var textNest = 0;
var textCharList = new Array();
var textCharPoint = new Array();
var imageNest = 0;
var imagePoint = new Array();
var textFontSize = 9.6;
var tronCodeMask = new Array();
var startTadSegment = false;
var startByImageSegment = false;
var tabCharNum = 4;

const canvasW = 1500;
const canvasH = 800;
const virtualW = 10000;
const virtualH = 10000;


// 特殊文字コードの定義
const TNULL	    	= 0x0000
const TC_TAB	    = 0x0009
const TC_NL		    = 0x000a
const TC_NC	    	= 0x000b
const TC_FF	    	= 0x000c
const TC_CR	    	= 0x000d
const TC_LANG   	= 0xfe00
const TC_FDLM   	= 0xff21	// パスの区切り
const TC_SPEC   	= 0xff00
const TC_ESC    	= 0xff80

// 言語/スクリプト指定の定義
const TSC_SYS	    = 0x0021	// system script

// TAD 付箋/セグメントの定義(include/tad.h より引用)
const TS_INFO	    = 0xffe0		// 管理情報セグメント
const TS_TEXT	    = 0xffe1		// 文章開始セグメント
const TS_TEXTEND	= 0xffe2		// 文章終了セグメント
const TS_FIG		= 0xffe3		// 図形開始セグメント
const TS_FIGEND	    = 0xffe4		// 図形終了セグメント
const TS_IMAGE	    = 0xffe5		// 画像セグメント
const TS_VOBJ   	= 0xffe6		// 仮身セグメント
const TS_DFUSEN 	= 0xffe7		// 指定付箋セグメント
const TS_FFUSEN 	= 0xffe8		// 機能付箋セグメント
const TS_SFUSEN 	= 0xffe9		// 設定付箋セグメント

//文章付箋セグメントID
const TS_TPAGE  	= 0xffa0		// 文章ページ割付け指定付箋
const TS_TRULER	    = 0xffa1		// 行書式指定付箋
const TS_TFONT  	= 0xffa2		// 文字指定付箋
const TS_TCHAR  	= 0xffa3		// 特殊文字指定付箋
const TS_TATTR  	= 0xffa4		// 文字割り付け指定付箋
const TS_TSTYLE 	= 0xffa5		// 文字修飾指定付箋
const TS_TVAR   	= 0xffad		// 変数参照指定付箋
const TS_TMEMO  	= 0xffae		// 文章メモ指定付箋
const TS_TAPPL  	= 0xffaf		// 文章アプリケーション指定付箋

// 図形付箋セグメントID
const TS_FPRIM  	= 0xffb0		// 図形要素セグメント
const TS_FDEF   	= 0xffb1		// データ定義セグメント
const TS_FGRP   	= 0xffb2		// グループ定義セグメント
const TS_FMAC   	= 0xffb3		// マクロ定義/参照セグメント
const TS_FATTR  	= 0xffb4		// 図形修飾セグメント
const TS_FPAGE  	= 0xffb5		// 図形ページ割り付け指定付箋
const TS_FMEMO  	= 0xffbe		// 図形メモ指定付箋
const TS_FAPPL  	= 0xffbf		// 図形アプリケーション指定付箋

// 用紙サイズ
var paperSize = new Array(); // 用紙サイズ
var parepBinding = 0; // 用紙綴じ方向 0:左綴じ
var paperImposition = 0; // 用紙面付け指定 0:1面付け,1:2面付け
var paperMargin = new Array(); // 用紙マージン


// 行書式
var lineAlign = 0 // 0:左揃え,1:中央揃え,2:右揃え,3:両端揃え,4:均等揃え,5～:予約

/**
 * Unit計算
 * @param {0x0000} unit 
 * @returns 
 */
function units(unit) {
    if (unit&0x8000) unit|= ~0xffff;
    return unit;
}

/**
 * onDrag
 * @param {Event} event 
 */
function onDragOver(event) {
    event.preventDefault(); 
} 

/**
 * onDrop
 * @param {Event} event 
 */
function onDrop(event) {
    onAddFile(event);
    event.preventDefault(); 
}  

/**
 * HTML tag文字列変換
 * @param {char} str 
 * @returns 
 */
function htmlspecialchars(str) {
    return (str + '').replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;'); 
}

/**
 * IntToHex
 * @param {int} value 
 * @param {int} digits 
 * @returns 
 */
function IntToHex(value,digits) {
    var result = value.toString(16).toUpperCase();
    var len = result.length;

    for(var i=len;i<digits;i++) {
        result = '0' + result;
    }

    return '0x' + result; 
}

/**
 * 
 * @param {0x0000} uh 
 */
function uh2h(uh) {
    if (uh&0x8000) uh|= ~0xffff;
    return uh
}

/**
 * TADセグメント UH2UB
 * 呼び出し例
 *  var tadSeg8 = uh2ub(tadSeg);
 *  for(var offsetLen=4;offsetLen<tadSeg8.length;offsetLen++) {
 *      console.log(charTronCode(tadSeg8[offsetLen]));
 *  }
 * @param {0x0000[]} UH
 * @returns
 */
function uh2ub(UH) {
    let buffer = new ArrayBuffer(2);
    var ra16db = new DataView(buffer);
    var tadSeg = new Array();
    for(var i=0;i<UH.length;i++) {
        ra16db.setUint16(0, UH[i]);
        tadSeg.push(ra16db.getUint8(0));
        tadSeg.push(ra16db.getUint8(1));
    }
    return tadSeg;
}

/**
 * カンマセット
 * @param {char} S 
 * @returns 
 */
function setComma(S) {
    var result =''; 
    var cnt = 0; 
    
    S = S +'';
    for(var i=S.length-1;i>=0;i--) {
        if (cnt == 3) {
            result =  S[i]+  ',' + result;
            cnt = 1;
        }else{
            result = S[i] + result;
            cnt++;
        }    
    }
    return result;
}

/**
 * エンディアン変換（little2big）
 * @param {int} n 
 * @returns 
 */
function changeEndian(n) {
    var r = n / 0x100;
    r += (n % 0x100) * 0x100;
    return r;
}

/**
 * UHからUB SubIDを取得
 * @param {UH} UH 
 * @returns 
 */
function getTopUBinUH(UH) {
    var SubID = ( UH >> 8);
    console.log("UB_SubID" + SubID);
    return SubID;
}

/**
 * UHからUB ATTRを取得
 * @param {UH} UH 
 * @returns 
 */
function getLastUBinUH(UH) {
    var ATTR = ( UH << 8);
    console.log("UB_SubID" + ATTR);
    return ATTR;
}

/**
 * 管理情報セグメントを処理
 * ログにバージョン出力
 * @param {0x0000[]} tadSeg 
 */
function tadVer(tadSeg) {
    if (tadSeg[0] === Number(0x0000)) {
        console.log("TadVer " + IntToHex((tadSeg[2]),4).replace('0x',''));
    }

}
/**
 * 文章開始セグメントを処理
 * 文章開始セグメントは複数入れ子になるため、テキストの配列を追加して以後のテキストを格納。
 * 文章終了セグメントで一括してテキストを表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextStart(tadSeg) {
    if (startTadSegment == false) {
        startTadSegment = true;
    }

    textNest++;
    textCharList.push('');
    tronCodeMask.push(1);

    var viewX = 0;
    var viewY = 0;
    var viewW = 0;
    var viewH = 0;
    var drawX = 0;
    var drawY = 0;
    var drawW = 0;
    var drawH = 0;

    // 文章TADの場合、全体が文章であることが示されるため、指定は無効
    if (startByImageSegment == true) {
        viewX = Number(uh2h(tadSeg[0]));
        viewY = Number(uh2h(tadSeg[1]));
        viewW = Number(uh2h(tadSeg[2])) - viewX;
        viewH = Number(uh2h(tadSeg[3])) - viewY;  
        drawX = Number(uh2h(tadSeg[4]));
        drawY = Number(uh2h(tadSeg[5]));
        drawW = Number(uh2h(tadSeg[6])) - drawX;
        drawH = Number(uh2h(tadSeg[7])) - drawY;
    }

    console.debug('view\r\n');
    console.debug("left " + viewX);
    console.debug("top " + viewY);
    console.debug("right " + viewW);
    console.debug("bottom " + viewH);
    console.debug('draw\r\n');
    console.debug("left   " + drawX);
    console.debug("top    " + drawY);
    console.debug("right  " + drawW);
    console.debug("bottom " + drawH);
    console.debug("h_unit " + units(tadSeg[8]));
    console.debug("v_unit " + units(tadSeg[9]));
    console.debug("lang   " + Number(tadSeg[10]));
    console.debug("bgpat  " + Number(tadSeg[11]));

    textCharPoint.push([viewX,viewY,viewW,viewH,drawX,drawY,drawW,drawH]);
}

/**
 * テキスト描画
 * @param {*} context 
 * @param {*} text 
 * @param {*} x
 * @param {*} y 
 * @param {*} width 
 * @param {*} lineHight 
 * @param {*} align 
 */
function fixedFillText(context, text, x, y,width, lineHight, align) {

    if (canvasW < width ) {
        width = canvasW;
    } else if (width < 10) {
        width = canvasW;
    }

	var column = [''], line = 0, padding;

	for (var i = 0; i < text.length; i++) {
		var char = text.charAt(i);
        //折り返し処理
		if (context.measureText(column[line] + char).width > width) {
			line++;
			column[line] = '';
        //改行処理
		} else if (char == String.fromCharCode(Number(0x000a)) || char == String.fromCharCode(Number(0x000d))) {
			line++;
			column[line] = '';
        // Tab処理
        } else if (char == String.fromCharCode(Number(0x0009))) {
            for(var tabLoop = 0;tabLoop < tabCharNum; tabLoop++){
                column[line] += " ";
            }
        }
		column[line] += char;
	}

	var padding, lineWidth;
	for (var i = 0; i < column.length; i++) {
		var lineWidth = context.measureText(column[i]).width;
		if (align == 'right') {
			padding = width - lineWidth;
		}
		else if (align == 'center') {
			padding = (width - lineWidth)/2;
		}
		else {
			padding = 0;
		}
        // TODO: ここにlineAlignをセット
        // context.textAlign = "left"; // "right" "center"
		context.fillText(column[i], 0 + padding + x, lineHight * i + y);
	}

}

/**
 * 文章終了セグメントを処理
 * 文章開始セグメント以降格納されていたテキストを一括して表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextEnd(tadSeg) {

    console.debug("Text      : " + textCharList[textNest-1]);
    console.debug("TextPoint : " + textCharPoint[textNest-1][0],textCharPoint[textNest-1][1]);

    var textFontSet = textFontSize + 'px serif';
    ctx.fillStyle = "black";
    ctx.font = textFontSet;
    ctx.textBaseline = "top";
    fixedFillText(ctx, textCharList[textNest-1], textCharPoint[textNest-1][0],textCharPoint[textNest-1][1] ,textCharPoint[textNest-1][2], textFontSize * 1.2, "left")
    //ctx.fillText(textCharList[textNest-1],textCharPoint[textNest-1][0],textCharPoint[textNest-1][1]);

    textCharList.pop();
    textCharPoint.pop();
    tronCodeMask.pop();
    textNest--;
}

/**
 * 用紙指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }

    var ATTR = getLastUBinUH(tadSeg[0]);

    if (ATTR === Number(0x00)) {
        parepBinding = 0; // 用紙綴じ方向 0:左綴じ
        paperImposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x01)) {
        parepBinding = 0; // 用紙綴じ方向 0:左綴じ
        paperImposition = 1; // 用紙面付け指定 1:2面付け
    } else if (ATTR === Number(0x02)) {
        parepBinding = 1; // 用紙綴じ方向 1:右綴じ
        paperImposition = 0; // 用紙面付け指定 0:1面付け
    } else if (ATTR === Number(0x03)) {
        parepBinding = 1; // 用紙綴じ方向 1:右綴じ
        paperImposition = 1; // 用紙面付け指定 1:2面付け
    }

    console.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));

    var peperLength = Number(tadSeg[1]);
    var paperWidth = Number(tadSeg[2]);
    var paperTop = Number(tadSeg[3]);
    var paperBottom = Number(tadSeg[4]);
    var paperLeft = Number(tadSeg[5]);
    var paperRight = Number(tadSeg[6]);

    paperSize.push(peperLength, paperWidth, paperTop, paperBottom, paperLeft, paperRight)

    //textCharPoint[textNest-1][3] = viewH;
    //textCharPoint[textNest-1][2] = viewW;
}

/**
 * マージン指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfMarginSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x000A)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }

    console.debug("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[4]),4).replace('0x',''));

    var marginTop = Number(tadSeg[1]);
    var marginBottom = Number(tadSeg[2]);
    var marginLeft = Number(tadSeg[3]);
    var marginRight = Number(tadSeg[4]);

    paperMargin.push(marginTop, marginBottom, marginLeft, marginRight)
}

/**
 * コラム指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfColumnSetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }
    // TODO: 未実装
}

/**
 * 用紙オーバーレイ定義付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperOverlayDefineFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }
    // TODO: 未実装
}

/**
 * 用紙オーバーレイ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperOverlaySetFusen(segLen, tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    // 図形TADの場合は無視される
    if (startByImageSegment == true) {
        return;
    }
    // TODO: 未実装
}

/**
 * ページ指定付箋共通から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadPageSetFusen(segLen, tadSeg) {
    var UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.log("用紙指定付箋");
        tadSizeOfPaperSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.log("マージン指定付箋");
        tadSizeOfMarginSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x02)) {
        console.log("コラム指定付箋");
        tadSizeOfColumnSetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.log("用紙オーバーレイ定義付箋");
        tadSizeOfPaperOverlayDefineFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x04)) {
        console.log("用紙オーバーレイ指定付箋");
        tadSizeOfPaperOverlaySetFusen(segLen, tadSeg);
    } else if (UB_SubID === Number(0x05)) {
        console.log("枠あけ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x06)) {
        console.log("ページ番号指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x07)) {
        console.log("条件改ページ指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x08)) {
        console.log("充填行指定付箋");
        // TODO: 未実装
    } 
}

/**
 * 行間隔指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerLineSpacingSetFusen(segLen, tadSeg) {
    var ATTR = getLastUBinUH(tadSeg[0]);

}

/**
 * 行揃え指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerLineAlignmentSetFusen(segLen, tadSeg) {
    var ATTR = getLastUBinUH(tadSeg[0]);

    lineAlign = Number(ATTR);
    console.debug("行揃え : " + lineAlign);
}

/**
 * 行書式指定付箋から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerSetFusen(segLen, tadSeg) {
    var UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.log("行間隔指定付箋");
        tadRulerLineSpacingSetFusen(segLen, tadSeg);
        // TODO: 未実装
    } else if (UB_SubID === Number(0x01)) {
        console.log("行揃え指定付箋");
        tadRulerLineAlignmentSetFusen(segLen, tadSeg);
        // TODO: 未実装
    } else if (UB_SubID === Number(0x02)) {
        console.log("タブ書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x03)) {
        console.log("フィールド書式指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x04)) {
        console.log("文字方向指定付箋");
        // TODO: 未実装
    } else if (UB_SubID === Number(0x05)) {
        console.log("行頭移動指定付箋");
        // TODO: 未実装
    }
}

/**
 * フォント指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadFontNameSetFusen(segLen,tadSeg) {
    if (segLen < Number(0x0004)) {
        return;
    }
    for(var offsetLen=2;offsetLen<tadSeg.length;offsetLen++) {
        console.log(IntToHex((tadSeg[offsetLen]),4).replace('0x',''));
        console.log(charTronCode(tadSeg[offsetLen]));
    }
}

/**
 * 文字サイズ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSizeSetFusen(segLen,tadSeg) {

    var tadSize = ("0000000000000000" + tadSeg[1].toString(2)).slice( -16 );
    
    var U1 = 16384;
    var U2 = 32768;
    var U3 = 49152;
    var sizeMask = 16383;
    

    if (tadSeg[1] & U2) {
        textFontSize = (tadSeg[1] & sizeMask) / 20;
        console.debug("ptsize  " + textFontSize );
    } else if (tadSeg[1] & U1) {
        console.debug("Qsize   " + tadSize);
        textFontSize = (tadSeg[1] & sizeMask) / (20 * 0.3528);
    }


}

/**
 * 文字指定付箋共通を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSetFusen(segLen, tadSeg) {
    var UB_SubID = getTopUBinUH(tadSeg[0]);

    if (UB_SubID === Number(0x00)) {
        console.log("フォント指定付箋");
        tadFontNameSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x01)) {
        console.log("フォント属性指定付箋");
    } else if (UB_SubID === Number(0x02)) {
        console.log("文字サイズ指定付箋");
        tadFontSizeSetFusen(segLen,tadSeg);
    } else if (UB_SubID === Number(0x03)) {
        console.log("文字拡大／縮小指定付箋");
    } else if (UB_SubID === Number(0x04)) {
        console.log("文字間隔指定付箋");
    } else if (UB_SubID === Number(0x05)) {
        console.log("文字回転指定付箋");
    } else if (UB_SubID === Number(0x06)) {
        console.log("文字カラー指定付箋");
    } else if (UB_SubID === Number(0x07)) {
        console.log("文字基準位置移動付箋");
    }
}

/**
 * 図形開始セグメントを処理
 * @param {0x0000[]} tadSeg 
 */
function tsFig(tadSeg) {
    if (startTadSegment == false) {
        startTadSegment = true;
        startByImageSegment = true;
    }
    imageNest++;

    var viewX = 0;
    var viewY = 0;
    var viewW = 0;
    var viewH = 0;
    var drawX = 0;
    var drawY = 0;
    var drawW = 0;
    var drawH = 0;

    // 図形TADの場合、全体が図形であることが示されるため、指定は無効
    if (startByImageSegment == false) {
        viewW = Number(uh2h(tadSeg[2])) - Number(uh2h(tadSeg[0]));
        viewH = Number(uh2h(tadSeg[3])) - Number(uh2h(tadSeg[1]));
        drawX = Number(uh2h(tadSeg[4]));
        drawY = Number(uh2h(tadSeg[5]));
        drawW = Number(uh2h(tadSeg[6])) - drawX;
        drawH = Number(uh2h(tadSeg[7])) - drawY;  
    } else if (imageNest > 1 && startByImageSegment == true) {
        viewX = Number(uh2h(tadSeg[0]));
        viewY = Number(uh2h(tadSeg[1]));
        viewW = Number(uh2h(tadSeg[2])) - viewX;
        viewH = Number(uh2h(tadSeg[3])) - viewY;  
        drawX = Number(uh2h(tadSeg[4]));
        drawY = Number(uh2h(tadSeg[5]));
        drawW = Number(uh2h(tadSeg[6])) - drawX;
        drawH = Number(uh2h(tadSeg[7])) - drawY;
    }

    // TODO: なぜか、図形TADなのに図形開始セグメントにview定義されていることがあるためcanvasサイズを変更
    // canvasサイズを図形開始セグメントのサイズにあわせる
    if ( startByImageSegment == true && imageNest == 1) {
        //canvas.width = viewW;
        //canvas.height = viewH;
    }

    // view
    var view
    console.debug("left   " + Number(uh2h(tadSeg[0])));
    console.debug("top    " + Number(uh2h(tadSeg[1])));
    console.debug("right  " + Number(uh2h(tadSeg[2])));
    console.debug("bottom " + Number(uh2h(tadSeg[3])));
    // draw
    console.debug("left   " + Number(uh2h(tadSeg[4])));
    console.debug("top    " + Number(uh2h(tadSeg[5])));
    console.debug("right  " + Number(uh2h(tadSeg[6])));
    console.debug("bottom " + Number(uh2h(tadSeg[7])));
    console.debug("h_unit " + units(tadSeg[8]));
    console.debug("v_unit " + units(tadSeg[9]));

    imagePoint.push([viewX,viewY,viewW,viewH,drawX,drawY,drawW,drawH]);
}

/**
 * 図形要素セグメント 長方形セグメントを描画
 * @param {int} segLen 
 * @param {{0x0000[]} tadSeg 
 * @returns 
 */
function tsFigRectAngleDraw(segLen, tadSeg) {
    if (segLen < Number(0x0012)) {
        return;
    }
    var figX = Number(tadSeg[5]);
    var figY = Number(tadSeg[6]);
    var figW = Number(tadSeg[7]) - Number(tadSeg[5]);
    var figH = Number(tadSeg[8]) - Number(tadSeg[6]);


    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[8]),4).replace('0x',''));



    ctx.beginPath();
    ctx.rect(figX , figY, figW, figH);
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'black';
    ctx.stroke();


    return;
}

/**
 * 図形セグメント 多角形セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigPolygonDraw(segLen, tadSeg) {
    if (segLen < Number(0x0016)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("round  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("np     " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("x      " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("y      " + IntToHex((tadSeg[7]),4).replace('0x',''));

    var x = Number(tadSeg[6]);
    var y = Number(tadSeg[7]);

    ctx.strokeStyle = 'black';
    ctx.beginPath();
    ctx.moveTo(x,y);

    var polygonPoint = 'polygon ';
    for(var offsetLen=8;offsetLen<tadSeg.length;offsetLen++) {
        if (offsetLen % 2 === 0) {
            polygonPoint += ' x:';
            x = Number(tadSeg[offsetLen]);
        } else {
            polygonPoint += ' y:';
            y = Number(tadSeg[offsetLen]);
            ctx.lineTo(x,y);
        }
        polygonPoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(polygonPoint);
    ctx.closePath();
    ctx.stroke();


    return;
}

/**
 * 図形セグメント 直線セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigLineDraw(segLen, tadSeg) {
    if (segLen < Number(0x000E)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));

    var x = Number(tadSeg[3]);
    var y = Number(tadSeg[4]);

    ctx.strokeStyle = 'black';
    ctx.beginPath();
    ctx.moveTo(x,y);

    var linePoint = 'line   ';
    for(var offsetLen=5;offsetLen<tadSeg.length;offsetLen++) {
        if (offsetLen % 2 === 0) {
            linePoint += ' y:';
            y = Number(tadSeg[offsetLen]);
            ctx.lineTo(x,y);
        } else {
            linePoint += ' x:';
            x = Number(tadSeg[offsetLen]);
        }
        linePoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(linePoint);

    ctx.stroke();
    return;
}

/**
 * 図形セグメント 楕円弧セグメントを描画
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tsFigEllipticalArcDraw(segLen, tadSeg) {
    if (segLen < Number(0x0018)) {
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("startx " + IntToHex((tadSeg[8]),4).replace('0x',''));
    console.debug("starty " + IntToHex((tadSeg[9]),4).replace('0x',''));
    console.debug("endx   " + IntToHex((tadSeg[10]),4).replace('0x',''));
    console.debug("endy   " + IntToHex((tadSeg[11]),4).replace('0x',''));

    var angle = Number(uh2h(tadSeg[3]));
    var frameLeft = Number(uh2h(tadSeg[4]));
    var frameTop = Number(uh2h(tadSeg[5]));
    var frameRight = Number(uh2h(tadSeg[6]));
    var frameBottom = Number(uh2h(tadSeg[7]));
    var startX = Number(uh2h(tadSeg[8]));
    var startY = Number(uh2h(tadSeg[9]));
    var endX = Number(uh2h(tadSeg[10]));
    var endY = Number(uh2h(tadSeg[11]));
    var radiusX = ( frameRight - frameLeft ) / 2;
    var radiusY = (frameBottom - frameTop) / 2;
    var frameCenterX = frameLeft + radiusX;
    var frameCenterY = frameTop + radiusY;
    var radianStart = Math.atan2(startY - frameCenterY, startX - frameCenterX)
    var radianEnd = Math.atan2(endY - frameCenterY, endX - frameCenterX)
    var radianAngle = angle * Math.PI / 180;

    console.debug(radianAngle);
    console.debug(frameCenterX);
    console.debug(frameCenterY);
    console.debug(startX);
    console.debug(startY);
    console.debug(radiusX);
    console.debug(radiusY);
    console.debug(radianStart);
    console.debug(radianEnd);

    ctx.beginPath();
    ctx.ellipse(frameCenterX, frameCenterY, radiusX, radiusY, radianAngle, radianStart, radianEnd,false);
    ctx.stroke();

    return;
}

/**
 * 図形要素セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsFigDraw(segLen, tadSeg) {
    var UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.log("長方形セグメント");
        tsFigRectAngleDraw(segLen, tadSeg);
    // TODO :未対応
    } else if (UB_SubID === Number(0x01)) {
        console.log("角丸長方形セグメント");
    // TODO :未対応
    } else if (UB_SubID === Number(0x02)) {
        console.log("楕円セグメント");
    // TODO :未対応
    } else if (UB_SubID === Number(0x03)) {
        console.log("扇形セグメント");
    // TODO :未対応
    } else if (UB_SubID === Number(0x04)) {
        console.log("弓形セグメント");
    } else if (UB_SubID === Number(0x05)) {
        console.log("多角形セグメント");
        tsFigPolygonDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x06)) {
        console.log("直線セグメント");
        tsFigLineDraw(segLen, tadSeg);
    } else if (UB_SubID === Number(0x07)) {
        console.log("楕円弧セグメント");
        tsFigEllipticalArcDraw(segLen, tadSeg);
    // TODO :未対応
    } else if (UB_SubID === Number(0x08)) {
        console.log("折れ線セグメント");
    // TODO :未対応
    } else if (UB_SubID === Number(0x09)) {
        console.log("曲線セグメント");
    }
}

/**
 * データ定義セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsDataSet(segLen, tadSeg) {
    var UB_SubID = getTopUBinUH(tadSeg[0]);
    
    if (UB_SubID === Number(0x00)) {
        console.log("カラーマップ定義セグメント");

    } else if (UB_SubID === Number(0x01)) {
        console.log("マスクデータ定義セグメント");

    } else if (UB_SubID === Number(0x02)) {
        console.log("パターン定義セグメント");

    } else if (UB_SubID === Number(0x03)) {
        console.log("線種定義セグメント");

    } else if (UB_SubID === Number(0x04)) {
        console.log("マーカー定義セグメント");

    }
    

}

function tsLinkSegment(segLen, tadSeg) {
    if (segLen < Number(0x001E)) {
        return;
    }
    console.debug("left   " + IntToHex((tadSeg[0]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("height " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("chsz   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("dlen   " + IntToHex((tadSeg[14]),4).replace('0x',''));

    var linkRecordData = '';
    for(var offsetLen=15;offsetLen<tadSeg.length;offsetLen++) {
        linkRecordData += tadSeg[offsetLen];
    }
}

/**
 * TADパーサー TADセグメントを判定
 * @param {0x0000} segID 
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadPerse(segID, segLen, tadSeg) {
    console.log("tadSeg " + IntToHex((segID),4).replace('0x',''));
    if (segID === Number(TS_INFO)) {
        console.log('管理情報セグメント');
        tadVer(tadSeg);
    } else if (segID === Number(TS_TEXT)) {
        console.log('文章開始セグメント');
        tsTextStart(tadSeg);
    } else if (segID === Number(TS_TEXTEND)) {
        console.log('文章終了セグメント');
        tsTextEnd(tadSeg);
    } else if (segID === Number(TS_FIG)) {
        console.log('図形開始セグメント');
        tsFig(tadSeg);
    } else if (segID === Number(TS_FIGEND)) {
        console.log('図形終了セグメント');
    } else if (segID === Number(TS_IMAGE)) {
        console.log('画像セグメント');
    } else if (segID === Number(TS_VOBJ)) {
        console.log('仮身セグメント');
        tsLinkSegment(segLen, tadSeg);
    } else if (segID === Number(TS_DFUSEN)) {
        console.log('指定付箋セグメント');
    } else if (segID === Number(TS_FFUSEN)) {
        console.log('機能付箋セグメント');
    } else if (segID === Number(TS_TPAGE)) {
        console.log('文章ページ割付け指定付箋');
        tadPageSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TRULER)) {
        console.log('行書式指定付箋');
        tadRulerSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TFONT)) {
        console.log('文字指定付箋');
        tadFontSetFusen(segLen, tadSeg);
    } else if (segID === Number(TS_TCHAR)) {
        console.log('特殊文字指定付箋');
    } else if (segID === Number(TS_TATTR)) {
        console.log('文字割り付け指定付箋');
    } else if (segID === Number(TS_TSTYLE)) {
        console.log('文字修飾指定付箋');
    } else if (segID === Number(TS_TVAR)) {
        console.log('変数参照指定付箋');
    } else if (segID === Number(TS_TMEMO)) {
        console.log('文章メモ指定付箋');
    } else if (segID === Number(TS_TAPPL)) {
        console.log('文章アプリケーション指定付箋');
    } else if (segID === Number(TS_FPRIM)) {
        console.log('図形要素セグメント');
        tsFigDraw(segLen, tadSeg);
    } else if (segID === Number(TS_FDEF)) {
        console.log('データ定義セグメント');
        tsDataSet(segLen, tadSeg);
    } else if (segID === Number(TS_FGRP)) {
        console.log('グループ定義セグメント');
    } else if (segID === Number(TS_FMAC)) {
        console.log('マクロ定義/参照セグメント');
    } else if (segID === Number(TS_FATTR)) {
        console.log('図形修飾セグメント');
    } else if (segID === Number(TS_FPAGE)) {
        console.log('図形ページ割り付け指定付箋');
    } else if (segID === Number(TS_FMEMO)) {
        console.log('図形メモ指定付箋');
    } else if (segID === Number(TS_FAPPL)) {
        console.log('図形アプリケーション指定付箋');
    }
}

/**
 * TRONコードを判定
 * TODO: 現状はTRON仕様日本文字コードの第1面 Aゾーン(JIS X 0208)のみ対応
 * @param {char} char 
 * @returns 
 */
function charTronCode(char) {
    let buffer = new ArrayBuffer(2);
    let dv = new DataView(buffer);
    dv.setUint16(0, char);

    var char8 = new Array(Number(dv.getUint8(0,false)),Number(dv.getUint8(1,false)));
    //var char8 = new Array();
    var int1 = Number(dv.getUint8(0,false));
    var int2 = Number(dv.getUint8(1,false));

    var text = '';

    // TRONコード 面切替
    if ((char >= Number(0xfe21) && char <= Number(0xfe7e) )
    || (char >= Number(0xfe80) && char <= Number(0xfefe))) {
        tronCodeMask[textNest] = char - Number(0xfe21) + 1;
        console.log("TRON Code面 :" + tronCodeMask[textNest])
    }


    // TRONコード 第1面 Aゾーン(JIS X 0208)をjsのUNICODEに変換
    // TODO: JIS2UNICODEが上手く動作しないため、JISをSJISに変換後、SJI2UNICODEを実施
    if ((char >= Number(0x2121) && char <= Number(0x227e) )
    || (char >= Number(0x2420) && char <= Number(0x7e7e))) {
        if (int1 % 2) {
            int1 = ((int1 + 1) / 2) + Number(0x70);
            int2 = int2 + Number(0x1f);
        } else{
            int1 = (int1 / 2) + Number(0x70);
            int2 = int2 + Number(0x7d);
        }
        if (int1 >= Number(0xa0)) {
            int1 = int1 + Number(0x40);
        }
        if (int2 >= Number(0x7f)) {
            int2 = int2 + Number(1);
        }
        
        //console.log('JIS Zone');

        var unicodeArray = Encoding.convert([int1,int2],{
            to: 'UNICODE',
            from: 'SJIS'
        });

        //text = ECL.charset.convert(char, "UTF16", "SJIS");
        text = Encoding.codeToString(unicodeArray);

    } else if (char >= Number(0x2320) && char <= Number(0x237f)) {
        text = String.fromCharCode(char8[1]);
    } else if (char == Number(0x000a)) {
        text = String.fromCharCode(char8[1]);
    }
    return text;
}
var moveflg = 0,
    Xpoint,
    Ypoint;

//初期値（サイズ、色、アルファ値）の決定
var defSize = 7,
    defColor = "#555";

function startPoint(e) {
    e.preventDefault();
    ctx.beginPath();
    Xpoint = e.pageX - canvas.offsetLeft;
    Ypoint = e.pageY - canvas.offsetTop;
    ctx.moveTo(Xpoint, Ypoint);
}

function movePoint(e) {
    if (e.buttons === 1 || e.witch === 1 || e.type == 'touchmove') {
        Xpoint = e.pageX - canvas.offsetLeft;;
        Ypoint = e.pageY - canvas.offsetTop;;
        moveflg = 1;

        ctx.lineTo(Xpoint, Ypoint);
        ctx.lineCap = "round";
        ctx.lineWidth = defSize * 2;
        ctx.strokeStyle = defColor;
        ctx.stroke(); 
    }
}

function endPoint(e) {
    if (moveflg === 0) {
        ctx.lineTo(Xpoint-1, Ypoint-1);
        ctx.lineCap = "round";
        ctx.lineWidth = defSize * 2;
        ctx.strokeStyle = defColor;
        ctx.stroke();
    }
    moveflg = 0;
}

/**
 * Canvas 描画領域を初期化
 */
function canvasInit() {
    canvas = document.getElementById('canvas');
    if (canvas.getContext) {
        ctx = canvas.getContext('2d');
    }
    
    canvas.width = canvasW;
    canvas.height = canvasH;

    ctx.clearRect(0, 0, ctx.canvas.clientWidth, ctx.canvas.clientHeight);
    
    // PC対応
    canvas.addEventListener('mousedown', startPoint, false);
    canvas.addEventListener('mousemove', movePoint, false);
    canvas.addEventListener('mouseup', endPoint, false);
    // スマホ対応
    canvas.addEventListener('touchstart', startPoint, false);
    canvas.addEventListener('touchmove', movePoint, false);
    canvas.addEventListener('touchend', endPoint, false);
}

/**
 * TADファイル読込処理
 * @param {event} event 
 */
function onAddFile(event) {
    var files;
    var reader = new FileReader();
    var tadRecord = ''
    var linkRecord = ''

    canvasInit();
    
    if (event.target.files) {
        files = event.target.files;
    }else{
        files = event.dataTransfer.files;   
    }
    var fileNum  = files.length;
    tadRecord = files[0];
    for(var numLoop=0;numLoop<fileNum;numLoop++) {
        if (files[numLoop].name.includes('.000')) {
            linkRecord = files[numLoop]
            console.log("link Record" + linkRecord)
        }
        if (numLoop = fileNum - 1) {
            tadRecord = files[numLoop]
            console.log("TAD Record" + tadRecord)
        }
    }

    reader.onload = function (event) {
        var raw = new Uint8Array(reader.result);
        var rawBuffer = raw.buffer;
        var data_view = new DataView( rawBuffer );
        
        var Ascii = '';
        var Ascii2 = '';
        var P = '0000 ';
        var P2 = '00000000 ';
        var P3 = '';
        var row    = 1; // 行
        var row2   = 1;
        var column = 0; // 列
        var lenth = 0;

        // 最大1000kbまで
        for(var i=0;i<1000000;i++) {
        if (i >= raw.length) break;
        
        if (column === 16) {
            P += '  ' + Ascii + '\r\n';
            P += IntToHex((row * 16),4).replace('0x','') + ' ';
            row++;
            column = 0;
            Ascii = '';
        }
        
        P  += ' ' + IntToHex(Number(raw[i]),2).replace('0x','');
        if (raw[i] >= 32 && raw[i] <= 126) {
            Ascii += String.fromCharCode(raw[i]);
        }else{
            Ascii += ' ';
        }
        
        column++;     
        }         
    
        var i2 = 0;

        while(i2<1000000) {
            var P4 = '';
            if (i2 >= raw.length) break;
            var raw16 = data_view.getUint16(i2,true);

            if (raw16 === Number(TNULL)) {
                // 終端
                P2 += 'buffer over.\r\n';
                P3 += 'EOF\r\n';
                break;
            }else if (raw16 === TC_TAB) {

            }else if (raw16 === TC_SPEC) {

            }else if (raw16 === TC_NL) {
                console.log('NL');
                Ascii2 += '\r';
                P3 += '\r';
            }else if (raw16 === TC_FF) {
                console.log('Page');
                Ascii2 += '\r\n';
                P3 += '\r\n';
            }else if (raw16 === TC_CR) {
                console.log('CR');
                Ascii2 += '\r\n';
                P3 += '\r\n';
            }

            var segID = '';
            var segLen = 0;
            var tadSeg = new Array();

            if (raw16 > Number(0xff00)) {
                if (raw16 === Number(0xfffe)) {
                    i2 += 2;
                    raw16 = data_view.getUint16(i2,true);
                    if (raw16 >= Number(0xfe00)) {
                        i2 += 2;
                        raw16 = data_view.getUint16(i2,true);
                        // 0x321 - 0x3FD
                        if (raw16 === Number(0xfefe)) {
                            i2 += 2;
                            segID = data_view.getUint16(i2,true) + 0xff00; // + 0x300;  
                            i2 += 2;

                        // 0x221 - 0x2FD
                        } else{
                            segID = data_view.getUint8(i2,true) + 0xff00; // + 0x200;  
                            i2 += 2;
                        }
                    // 0x121 - 0x1FD
                    } else{
                        segID = data_view.getUint16(i2,true) + 0xff00; // + 0x100;  
                        i2 += 2;
                    }
                // 0x80 - 0xFD
                } else{
                    segID = data_view.getUint8(i2,true) + 0xff00;  
                    i2 += 2;
                }
                P2  += ' segID = ( ' + IntToHex((segID),4).replace('0x','') + ' ) ';

                segLen = Number(data_view.getUint16(i2,true));
                if (segLen === Number(0xffff)) {
                    i2 += 2;
                    segLen = Number(data_view.getUint32(i2,true));
                    i2 += 4;

                }else{
                    i2 += 2;
                }
                P2  += ' segLen = ( ' + IntToHex((segLen),4).replace('0x','') + ' ) ';

                for(var offsetLen=0;offsetLen<segLen;offsetLen=offsetLen+2) {
                    var offsetRaw = data_view.getUint16(i2 + offsetLen,true);
                    P2  += ' ' + IntToHex(Number(offsetRaw),4).replace('0x','');
                    tadSeg.push(offsetRaw);
                }
                i2 += segLen;
                tadPerse(segID, segLen, tadSeg);

            }else{
                var raw8Plus1 = Number(data_view.getUint16(i2,true));
                P2  += 'char = ( ' + IntToHex((raw8Plus1),4).replace('0x','') + ' )';
                var char = charTronCode(raw8Plus1)
                Ascii2 += char;
                P3 += char;
                P4 += char;

                i2 += 2;

            }

            textCharList[textNest-1] += P4;


            P2 += '  ' + Ascii2 +'\r\n';
            Ascii2 = '';
            // P2 += '  ' + '\r\n';
            P2 += IntToHex((i2),8).replace('0x','') + ' ';
        }
        
        // 端数
        if (Ascii !== '') {
            var len = 16 - Ascii.length;
            for(var i=0;i<len;i++) {
                Ascii = '   ' +Ascii;
            }
            P += '  ' +Ascii;
        }
    
    document.getElementById('BainryInfo').innerHTML = 
        'This File Size : ' + setComma(raw.length) +' Byte<br>Maximum displaye Size : 1000KB(1,000,000 Byte)';            
    document.getElementById('tadDumpView').innerHTML = htmlspecialchars(P2) ;  
    
    document.getElementById('tadTextView').innerHTML = htmlspecialchars(P3) ;
    };

    if (fileNum > 0) {
        reader.readAsArrayBuffer(tadRecord);
        document.getElementById("inputfile").value = '';
    }

}

/**
 * TAD保存処理
 * TODO: 未実装
 * @returns null
 */
function save() {
    // テキストエリアより文字列を取得
    const txt = document.getElementById('txt').value;
    if (!txt) {return;}

    // 文字列をBlob化
    const blob = new Blob([txt],{ type: 'text/plain' });

    // ダウンロード用のaタグ生成
    const a = document.createElement('a');
    a.href =  URL.createObjectURL(blob);
    a.download = 'sample.txt';
    a.click();
}
