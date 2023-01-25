

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



function units(unit){
    if(unit&0x8000) unit|= ~0xffff;
    return unit;
}

function ohayou() {
    alert("Hello!");
}

function onDragOver(event){ 
    event.preventDefault(); 
} 
    
function onDrop(event){
    onAddFile(event);
    event.preventDefault(); 
}  

function htmlspecialchars(str){
    return (str + '').replace(/&/g,'&amp;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;'); 
}

function IntToHex(value,digits){
    var result = value.toString(16).toUpperCase();
    var len = result.length;

    for(var i=len;i<digits;i++){
        result = '0' + result;
    }

    return '0x' + result; 
}

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

  // エンディアン変換
function changeEndian(n){
    var r = n / 0x100;
    r += (n % 0x100) * 0x100;
    return r;
}

function tadVer(tadSeg){
    if(tadSeg[0] === Number(0x0000)){
        console.log("TadVer " + IntToHex((tadSeg[2]),4).replace('0x',''));
    }

}

function tsText(tadSeg){
    console.log('view\r\n');
    console.log("left " + IntToHex((tadSeg[0]),4).replace('0x',''));
    console.log("top " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("right " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.log('draw\r\n');
    console.log("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.log("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.log("h_unit " + units(tadSeg[8]));
    console.log("v_unit " + units(tadSeg[9]));
    console.log("lang   " + IntToHex((tadSeg[10]),4).replace('0x',''));
    console.log("bgpat  " + IntToHex((tadSeg[11]),4).replace('0x',''));
}

function tadSizeOfPaperSetFusen(segLen, tadSeg){
    if(segLen < Number(0x000E)){
        return;
    }
    console.log("length " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("width  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("top    " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.log("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
}

function tadSizeOfMarginSetFusen(segLen, tadSeg){
    if(segLen < Number(0x000A)){
        return;
    }
    console.log("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("left   " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[4]),4).replace('0x',''));
}

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
}

function tadFontSetFusen(setLen, tadSeg){
    var SubID = tadSeg[0];

    console.log("subID_mode " + IntToHex((SubID),4).replace('0x',''));
    if(SubID === Number(0x0000)){
        console.log("フォント指定付箋");
    } else if(SubID === Number(0x0100)){
        console.log("フォント属性指定付箋");
    } else if(SubID === Number(0x0200)){
        console.log("文字サイズ指定付箋");
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

function tsFig(tadSeg){
    // view
    console.log("left   " + IntToHex((tadSeg[0]),4).replace('0x',''));
    console.log("top    " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[3]),4).replace('0x',''));
    // draw
    console.log("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.log("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.log("h_unit " + units(tadSeg[8]));
    console.log("v_unit " + units(tadSeg[9]));
}


function tsFigRectAngleDraw(segLen, tadSeg){
    if(segLen < Number(0x0012)){
        return;
    }
    console.log("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.log("angle  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.log("left   " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.log("top    " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[7]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[8]),4).replace('0x',''));

    return;
}

function tsFigPolygonDraw(segLen, tadSeg){
    if(segLen < Number(0x0016)){
        return;
    }
    console.log("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("f_pat  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.log("round  " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.log("np     " + IntToHex((tadSeg[5]),4).replace('0x',''));

    var polygonPoint = 'polygon ';
    for(var offsetLen=6;offsetLen<tadSeg.length;offsetLen++){
        if(offsetLen % 2 === 0){
            polygonPoint += ' x:';
        } else {
            polygonPoint += ' y:';
        }
        polygonPoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(polygonPoint);
    return;
}

function tsFigLineDraw(segLen, tadSeg){
    if(segLen < Number(0x000E)){
        return;
    }
    console.log("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));

    var linePoint = 'line   ';
    for(var offsetLen=3;offsetLen<tadSeg.length;offsetLen++){
        if(offsetLen % 2 === 0){
            linePoint += ' y:';
        } else {
            linePoint += ' x:';
        }
        linePoint += IntToHex((tadSeg[offsetLen]),4).replace('0x','');
    }
    console.log(linePoint);
    return;
}

function tsFigEllipticalArcDraw(segLen, tadSeg){
    if(segLen < Number(0x0018)){
        return;
    }
    console.log("l_atr  " + IntToHex((tadSeg[1]),4).replace('0x',''));
    console.log("l_pat  " + IntToHex((tadSeg[2]),4).replace('0x',''));
    console.log("angle  " + IntToHex((tadSeg[3]),4).replace('0x',''));
    console.log("left   " + IntToHex((tadSeg[4]),4).replace('0x',''));
    console.log("top    " + IntToHex((tadSeg[5]),4).replace('0x',''));
    console.log("right  " + IntToHex((tadSeg[6]),4).replace('0x',''));
    console.log("bottom " + IntToHex((tadSeg[7]),4).replace('0x',''));

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

function tadPerse(segID, segLen, tadSeg){
    console.log("tadSeg " + IntToHex((segID),4).replace('0x',''));
    if(segID === Number(TS_INFO)){
        console.log('管理情報セグメント');
        tadVer(tadSeg);
    } else if(segID === Number(TS_TEXT)){
        console.log('文章開始セグメント');
        tsText(tadSeg);
    } else if(segID === Number(TS_TEXTEND)){
        console.log('文章終了セグメント');
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
        tadFontSetFusen(setLen, tadSeg);
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

function charTronCode(char){
    let buffer = new ArrayBuffer(2);
    let dv = new DataView(buffer);
    dv.setUint16(0, char);

    var char8 = new Array(Number(dv.getUint8(0,false)),Number(dv.getUint8(1,false)));
    //var char8 = new Array();
    var int1 = Number(dv.getUint8(0,false));
    var int2 = Number(dv.getUint8(1,false));

    var text = '';
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

        text = ECL.charset.convert(char, "UTF16", "SJIS");
        text = Encoding.codeToString(unicodeArray);
        //console.log('SJIS Code: ' + int1 + ' ' + int2);
        //console.log(text);


    } else if(char >= Number(0x2320) && char <= Number(0x237f)){
        //console.log('ASCII Zone');
        //console.log(char8[1]);
        text = String.fromCharCode(char8[1]);
        //text = String.fromCharCode(IntToHex(Number(char8[1]),4).replace('0x',''));

    }
    return text;
}

function onAddFile(event) {
    var files;
    var reader = new FileReader();
    
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
            if(i2 >= raw.length) break;
            var raw16 = data_view.getUint16(i2,true);
            //console.log(raw16);

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

                i2 += 2;
            }


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