/**
    TADjs
*/

// global
var ctx;
var textNest = 0;
var textCharList = new Array();
var textCharPoint = new Array();
var textFontSize = 9.6;

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

/**
 * Unit計算
 * @param {0x0000} unit 
 * @returns 
 */
function units(unit){
    if(unit&0x8000) unit|= ~0xffff;
    return unit;
}

/**
 * onDrag
 * @param {Event} event 
 */
function onDragOver(event){ 
    event.preventDefault(); 
} 

/**
 * onDrop
 * @param {Event} event 
 */
function onDrop(event){
    onAddFile(event);
    event.preventDefault(); 
}  

/**
 * HTML tag文字列変換
 * @param {char} str 
 * @returns 
 */
function htmlspecialchars(str){
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
function IntToHex(value,digits){
    var result = value.toString(16).toUpperCase();
    var len = result.length;

    for(var i=len;i<digits;i++){
        result = '0' + result;
    }

    return '0x' + result; 
}

/**
 * カンマセット
 * @param {char} S 
 * @returns 
 */
function setComma(S){
    var result =''; 
    var cnt = 0; 
    
    S = S +'';
    for(var i=S.length-1;i>=0;i--){
        if(cnt == 3){
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
function changeEndian(n){
    var r = n / 0x100;
    r += (n % 0x100) * 0x100;
    return r;
}

// 管理情報セグメントを処理
function tadVer(tadSeg){
    if(tadSeg[0] === Number(0x0000)){
        console.log("TadVer " + IntToHex((tadSeg[2]),4).replace('0x',''));
    }

}
/**
 * 文章開始セグメントを処理
 * 文章開始セグメントは複数入れ子になるため、テキストの配列を追加して以後のテキストを格納。
 * 文章終了セグメントで一括してテキストを表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextStart(tadSeg){
    textNest++;
    textCharList.push('');

    var viewX = Number(tadSeg[0]);
    var viewY = Number(tadSeg[1]);
    var viewW = Number(tadSeg[2]) - viewX;
    var viewH = Number(tadSeg[3]) - viewY;  
    var drawX = Number(tadSeg[4]);
    var drawY = Number(tadSeg[5]);
    var drawW = Number(tadSeg[6]) - drawX;
    var drawH = Number(tadSeg[7]) - drawY;

    console.debug('view\r\n');
    console.debug("left " + IntToHex((tadSeg[0]),4).replace('0x',''));
    console.debug("top " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("right " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug('draw\r\n');
    console.debug("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("h_unit " + units(tadSeg[8]));
    console.debug("v_unit " + units(tadSeg[9]));
    console.debug("lang   " + IntToHex((tadSeg[10]),4).replace('0x',''));
    console.debug("bgpat  " + IntToHex((tadSeg[11]),4).replace('0x',''));

    textCharPoint.push([viewX,viewY,viewW,viewH,drawX,drawY,drawW,drawH]);
}

/**
 * 文章終了セグメントを処理
 * 文章開始セグメント以降格納されていたテキストを一括して表示
 * @param {0x0000[]} tadSeg 
 */
function tsTextEnd(tadSeg){

    console.log("Text      : " + textCharList[textNest-1]);
    console.log("TextPoint : " + textCharPoint[textNest-1][0],textCharPoint[textNest-1][1]);
    
    var textFontSet = textFontSize + 'px serif';
    ctx.fillStyle = "black";
    ctx.font = textFontSet;
    ctx.fillText(textCharList[textNest-1],textCharPoint[textNest-1][0],textCharPoint[textNest-1][1]);

    textCharList.pop();
    textCharPoint.pop();
    textNest--;
}

/**
 * 用紙指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfPaperSetFusen(segLen, tadSeg){
    if(segLen < Number(0x000E)){
        return;
    }
    console.debug("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
}

/**
 * マージン指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 * @returns 
 */
function tadSizeOfMarginSetFusen(segLen, tadSeg){
    if(segLen < Number(0x000A)){
        return;
    }
    console.debug("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[4]),4).replace('0x',''));
}

/**
 * ページ指定付箋共通から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadPageSetFusen(segLen, tadSeg){
    var SubID = tadSeg[0];

    console.log("subID_mode " + IntToHex((SubID),4).replace('0x',''));
    if(SubID === Number(0x0000)){
        console.log("用紙指定付箋");
        tadSizeOfPaperSetFusen(segLen, tadSeg);
    } else if(SubID === Number(0x0100)){
        console.log("マージン指定付箋");
        tadSizeOfMarginSetFusen(segLen, tadSeg);
    } 

}

/**
 * 行書式指定付箋から付箋を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadRulerSetFusen(segLen, tadSeg){
    var SubID = tadSeg[0];

    console.log("subID_mode " + IntToHex((SubID),4).replace('0x',''));
    if(SubID === Number(0x0000)){
        console.log("行間隔指定付箋");
    } else if(SubID === Number(0x0100)){
        console.log("行揃え指定付箋");
    } else if(SubID === Number(0x0200)){
        console.log("タブ書式指定付箋");
    }
    // TODO: フィールド書式指定付箋
    // TODO: 文字方向指定付箋
    // TODO: 行頭移動指定付箋
}

function tadFontNameSetFusen(segLen,tadSeg){
    if(segLen < Number(0x0004)){
        return;
    }
    for(var offsetLen=4;offsetLen<tadSeg.length;offsetLen++){
        console.log(charTronCode(tadSeg[offsetLen]));
    }
}

/**
 * 文字サイズ指定付箋を処理
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSizeSetFusen(segLen,tadSeg){

    var tadSize = ("0000000000000000" + tadSeg[1].toString(2)).slice( -16 );
    
    var U1 = 16384;
    var U2 = 32768;
    var U3 = 49152;
    var sizeMask = 16383;
    

    if(tadSeg[1] & U2){
        textFontSize = (tadSeg[1] & sizeMask) / 20;
        console.debug("ptsize  " + textFontSize );
    } else if (tadSeg[1] & U1){
        console.debug("Qsize   " + tadSize);
    }


}

/**
 * 文字指定付箋共通を判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadFontSetFusen(segLen, tadSeg){
    var SubID = tadSeg[0];

    console.log("subID_mode " + IntToHex((SubID),4).replace('0x',''));
    if(SubID === Number(0x0000)){
        console.log("フォント指定付箋");
    } else if(SubID === Number(0x0100)){
        console.log("フォント属性指定付箋");
    } else if(SubID === Number(0x0200)){
        console.log("文字サイズ指定付箋");
        tadFontSizeSetFusen(segLen,tadSeg);
    } else if(SubID === Number(0x0300)){
        console.log("文字拡大／縮小指定付箋");
    } else if(SubID === Number(0x0400)){
        console.log("文字間隔指定付箋");
    } else if(SubID === Number(0x0500)){
        console.log("文字回転指定付箋");
    } else if(SubID === Number(0x0600)){
        console.log("文字カラー指定付箋");
    } else if(SubID === Number(0x0700)){
        console.log("文字基準位置移動付箋");
    }
}

/**
 * 図形開始セグメントを処理
 * @param {0x0000[]} tadSeg 
 */
function tsFig(tadSeg){
    // view
    console.debug("left   " + IntToHex((tadSeg[0]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[3]),4).replace('0x',''));
    // draw
    console.debug("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.debug("h_unit " + units(tadSeg[8]));
    console.debug("v_unit " + units(tadSeg[9]));
}

/**
 * 図形要素セグメント 長方形セグメントを描画
 * @param {int} segLen 
 * @param {{0x0000[]} tadSeg 
 * @returns 
 */
function tsFigRectAngleDraw(segLen, tadSeg){
    if(segLen < Number(0x0012)){
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
function tsFigPolygonDraw(segLen, tadSeg){
    if(segLen < Number(0x0016)){
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
    for(var offsetLen=8;offsetLen<tadSeg.length;offsetLen++){
        if(offsetLen % 2 === 0){
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
function tsFigLineDraw(segLen, tadSeg){
    if(segLen < Number(0x000E)){
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
    for(var offsetLen=5;offsetLen<tadSeg.length;offsetLen++){
        if(offsetLen % 2 === 0){
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
function tsFigEllipticalArcDraw(segLen, tadSeg){
    if(segLen < Number(0x0018)){
        return;
    }
    console.debug("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.debug("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.debug("angle  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.debug("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.debug("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.debug("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.debug("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));

    var linePoint = 'line   ';
    for(var offsetLen=8;offsetLen<tadSeg.length;offsetLen++){
        if(offsetLen % 2 === 0){
            linePoint += ' x:';
        } else {
            linePoint += ' y:';
        }
        linePoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(linePoint);
    return;
}

/**
 * 図形要素セグメントを判定
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tsFigDraw(segLen, tadSeg){
    var SubID = tadSeg[0];

    console.log("subID_mode " + IntToHex((SubID),4).replace('0x',''));
    if(SubID === Number(0x0000)){
        console.log("長方形");
        tsFigRectAngleDraw(segLen, tadSeg);
    } else if(SubID === Number(0x0100)){
        console.log("角丸長方形");
    } else if(SubID === Number(0x0200)){
        console.log("楕円");
    } else if(SubID === Number(0x0300)){
        console.log("扇形");
    } else if(SubID === Number(0x0400)){
        console.log("弓形");
    } else if(SubID === Number(0x0500)){
        console.log("多角形");
        tsFigPolygonDraw(segLen, tadSeg);
    } else if(SubID === Number(0x0600)){
        console.log("直線");
        tsFigLineDraw(segLen, tadSeg);
    } else if(SubID === Number(0x0700)){
        console.log("楕円弧");
        tsFigEllipticalArcDraw(segLen, tadSeg);
    } else if(SubID === Number(0x0800)){
        console.log("折れ線");
    } else if(SubID === Number(0x09900)){
        console.log("曲線");
    }
}

/**
 * TADパーサー TADセグメントを判定
 * @param {0x0000} segID 
 * @param {int} segLen 
 * @param {0x0000[]} tadSeg 
 */
function tadPerse(segID, segLen, tadSeg){
    console.log("tadSeg " + IntToHex((segID),4).replace('0x',''));
    if(segID === Number(TS_INFO)){
        console.log('管理情報セグメント');
        tadVer(tadSeg);
    } else if(segID === Number(TS_TEXT)){
        console.log('文章開始セグメント');
        tsTextStart(tadSeg);
    } else if(segID === Number(TS_TEXTEND)){
        console.log('文章終了セグメント');
        tsTextEnd(tadSeg);
    } else if(segID === Number(TS_FIG)){
        console.log('図形開始セグメント');
        tsFig(tadSeg);
    } else if(segID === Number(TS_FIGEND)){
        console.log('図形終了セグメント');
    } else if(segID === Number(TS_IMAGE)){
        console.log('画像セグメント');
    } else if(segID === Number(TS_VOBJ)){
        console.log('仮身セグメント');
    } else if(segID === Number(TS_DFUSEN)){
        console.log('指定付箋セグメント');
    } else if(segID === Number(TS_FFUSEN)){
        console.log('機能付箋セグメント');
    } else if(segID === Number(TS_TPAGE)){
        console.log('文章ページ割付け指定付箋');
        tadPageSetFusen(segLen, tadSeg);
    } else if(segID === Number(TS_TRULER)){
        console.log('行書式指定付箋');
        tadRulerSetFusen(segLen, tadSeg);
    } else if(segID === Number(TS_TFONT)){
        console.log('文字指定付箋');
        tadFontSetFusen(segLen, tadSeg);
    } else if(segID === Number(TS_TCHAR)){
        console.log('特殊文字指定付箋');
    } else if(segID === Number(TS_TATTR)){
        console.log('文字割り付け指定付箋');
    } else if(segID === Number(TS_TSTYLE)){
        console.log('文字修飾指定付箋');
    } else if(segID === Number(TS_TVAR)){
        console.log('変数参照指定付箋');
    } else if(segID === Number(TS_TMEMO)){
        console.log('文章メモ指定付箋');
    } else if(segID === Number(TS_TAPPL)){
        console.log('文章アプリケーション指定付箋');
    } else if(segID === Number(TS_FPRIM)){
        console.log('図形要素セグメント');
        tsFigDraw(segLen, tadSeg);
    } else if(segID === Number(TS_FDEF)){
        console.log('データ定義セグメント');
    } else if(segID === Number(TS_FGRP)){
        console.log('グループ定義セグメント');
    } else if(segID === Number(TS_FMAC)){
        console.log('マクロ定義/参照セグメント');
    } else if(segID === Number(TS_FATTR)){
        console.log('図形修飾セグメント');
    } else if(segID === Number(TS_FPAGE)){
        console.log('図形ページ割り付け指定付箋');
    } else if(segID === Number(TS_FMEMO)){
        console.log('図形メモ指定付箋');
    } else if(segID === Number(TS_FAPPL)){
        console.log('図形アプリケーション指定付箋');
    }
}

/**
 * TRONコードを判定
 * TODO: 現状はTRON仕様日本文字コードの第1面 Aゾーン(JIS X 0208)のみ対応
 * @param {char} char 
 * @returns 
 */
function charTronCode(char){
    let buffer = new ArrayBuffer(2);
    let dv = new DataView(buffer);
    dv.setUint16(0, char);

    var char8 = new Array(Number(dv.getUint8(0,false)),Number(dv.getUint8(1,false)));
    //var char8 = new Array();
    var int1 = Number(dv.getUint8(0,false));
    var int2 = Number(dv.getUint8(1,false));

    var text = '';

    // TRONコード 第1面 Aゾーン(JIS X 0208)をjsのUNICODEに変換
    // TODO: JIS2UNICODEが上手く動作しないため、JISをSJISに変換後、SJI2UNICODEを実施
    if((char >= Number(0x2121) && char <= Number(0x227e) )
    || (char >= Number(0x2420) && char <= Number(0x7e7e))){
        if(int1 && 1 >= 1){
            if(int2 <= Number(0x5F)){
                int2 = int2 + Number(0x1F);
            } else{
                int2 = int2 + Number(0x20);
            }
        } else{
            int2 = int2 + Number(0x7E);
        }
        if(int1 <= Number(0x5E)){
            int1 = (int1 - Number(0x21)) / 2 + Number(0x81);
        } else{
            int1 = (int1 - Number(0x21)) / 2 + Number(0xC1);
        }
        //console.log('JIS Zone');

        var unicodeArray = Encoding.convert([int1,int2], {
            to: 'UNICODE',
            from: 'SJIS'
        });

        //text = ECL.charset.convert(char, "UTF16", "SJIS");
        text = Encoding.codeToString(unicodeArray);

    } else if(char >= Number(0x2320) && char <= Number(0x237f)){
        text = String.fromCharCode(char8[1]);

    }
    return text;
}

/**
 * Canvas 描画領域を初期化
 */
function canvasInit() {
    var canvas = document.getElementById('canvas');
    if (canvas.getContext) {
        ctx = canvas.getContext('2d');
    }    
}

/**
 * TADファイル読込処理
 * @param {event} event 
 */
function onAddFile(event) {
    var files;
    var reader = new FileReader();

    canvasInit();
    
    if(event.target.files){
        files = event.target.files;
    }else{ 
        files = event.dataTransfer.files;   
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
        for(var i=0;i<1000000;i++){
        if(i >= raw.length) break;
        
        if(column === 16){
            P += '  ' + Ascii + '\r\n';
            P += IntToHex((row * 16),4).replace('0x','') + ' ';
            row++;
            column = 0;
            Ascii = '';
        }
        
        P  += ' ' + IntToHex(Number(raw[i]),2).replace('0x','');
        if(raw[i] >= 32 && raw[i] <= 126){
            Ascii += String.fromCharCode(raw[i]);
        }else{
            Ascii += ' ';
        }
        
        column++;     
        }         
    
        var i2 = 0;

        while(i2<1000000){
            var P4 = '';
            if(i2 >= raw.length) break;
            var raw16 = data_view.getUint16(i2,true);

            if (raw16 === Number(TNULL)) {
                // 終端
                P2 += 'buffer over.\r\n';
                P3 += 'EOF\r\n';
                break;
            } else if(raw16 === TC_TAB) {

            } else if(raw16 === TC_SPEC) {

            } else if(raw16 === TC_NL) {
                console.log('NL');
                Ascii2 += '\r';
                P3 += '\r';
            } else if(raw16 === TC_FF) {
                console.log('Page');
                Ascii2 += '\r\n';
                P3 += '\r\n';
            } else if(raw16 === TC_CR) {
                console.log('CR');
                Ascii2 += '\r\n';
                P3 += '\r\n';
            }

            var segID = '';
            var segLen = 0;
            var tadSeg = new Array();

            if(raw16 > Number(0xff00)){
                if(raw16 === Number(0xfffe)){
                    i2 += 2;
                    raw16 = data_view.getUint16(i2,true);
                    if(raw16 >= Number(0xfe00)){
                        i2 += 2;
                        raw16 = data_view.getUint16(i2,true);
                        // 0x321 - 0x3FD
                        if(raw16 === Number(0xfefe)){
                            i2 += 2;
                            segID = data_view.getUint16(i2,true) + 0xff00; // + 0x300;  
                            i2 += 2;

                        // 0x221 - 0x2FD
                        } else{
                            segID = data_view.getUint8(i2,true) + 0xff00; // + 0x200;  
                            i2 += 2;
                        }
                    // 0x121 - 0x1FD
                    } else {
                        segID = data_view.getUint16(i2,true) + 0xff00; // + 0x100;  
                        i2 += 2;
                    }
                // 0x80 - 0xFD
                } else {
                    segID = data_view.getUint8(i2,true) + 0xff00;  
                    i2 += 2;
                }
                P2  += ' segID = ( ' + IntToHex((segID),4).replace('0x','') + ' ) ';

                segLen = Number(data_view.getUint16(i2,true));
                if(segLen === Number(0xffff)){
                    i2 += 2;
                    segLen = Number(data_view.getUint32(i2,true));
                    i2 += 4;

                } else {
                    i2 += 2;
                }
                P2  += ' segLen = ( ' + IntToHex((segLen),4).replace('0x','') + ' ) ';

                for(var offsetLen=0;offsetLen<segLen;offsetLen=offsetLen+2){
                    var offsetRaw = data_view.getUint16(i2 + offsetLen,true);
                    P2  += ' ' + IntToHex(Number(offsetRaw),4).replace('0x','');
                    tadSeg.push(offsetRaw);
                }
                i2 += segLen;
                tadPerse(segID, segLen, tadSeg);

            } else {
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
        if(Ascii !== ''){
            var len = 16 - Ascii.length;
            for(var i=0;i<len;i++){
                Ascii = '   ' +Ascii;
            }
            P += '  ' +Ascii;
        }
    
    document.getElementById('BainryInfo').innerHTML = 
        'This File Size : ' + setComma(raw.length) +' Byte<br>Maximum displaye Size : 1000KB(1,000,000 Byte)';            
    document.getElementById('tadDumpView').innerHTML = htmlspecialchars(P2) ;  
    
    document.getElementById('tadTextView').innerHTML = htmlspecialchars(P3) ;
    };

    if (files[0]){    
        reader.readAsArrayBuffer(files[0]); 
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
    if (!txt) { return; }

    // 文字列をBlob化
    const blob = new Blob([txt], { type: 'text/plain' });

    // ダウンロード用のaタグ生成
    const a = document.createElement('a');
    a.href =  URL.createObjectURL(blob);
    a.download = 'sample.txt';
    a.click();
}