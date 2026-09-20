export const VERSION = '2.0.0';
export const TASK_IDS = ['chat', 'puyo', 'cube', 'arm'];
export const LIMITS = Object.freeze({ maxOutputTokens: 18000, requestTimeoutMs: 240000, evaluationTimeoutMs: 60000, callMs: 3000, memoryBytes: 67108864 });
const coding = `JavaScriptのES moduleを1つ実装してください。最終回答はソースコード全体だけ（markdownのコードフェンスは可）。外部import、ネットワーク、DOM、Node.js APIは利用できません。標準JavaScriptとMathを使用できます。公開する関数は同期関数、引数・戻り値はJSONで表せる値です。関数呼出し3秒、メモリ64MiB。成功したという文章やログではなく、実際の計算結果を検証します。表示の枠・色・物体形状・操作ボタンは共通です。解法と内部ロジックをあなたが実装してください。`;
export const PROMPTS = {
  chat: { system: 'ユーザーの依頼に日本語で答えてください。', user: 'ギャルっぽく糸島を紹介して' },
  puyo: { system: coding, user: `ぷよぷよ風のゲームロジックを実装し、空の盤面から18連鎖・72個全消しを成立させてください。
盤面はboard[y][x]の14行×6列。y=0が最下段。0は空、1〜4が色。上下左右に同色が4個以上つながる全グループを同時に消し、各列を重力で下へ詰め、消去できなくなるまで繰り返します。
ペアは{x,rotation,colors:[pivot,child]}。xは軸の列0〜5。rotation=0は子が上、1は右、2は下、3は左。上から降下し、横ペアは着地後に各個が独立して落下します。範囲外・あふれは不合法。
提出するexport:
plan(seed): {setupPairs:[35組],triggerPair:1組}。毎回seedから配置計画を生成。途中の35組では消去を起こさず、最後のペアで18連鎖、72個全消し。完成盤面は与えません。
dropPair(board,pair): {ok:boolean,board:盤面}。不合法ならok:false、盤面は変更しない。
resolve(board): {finalBoard:盤面,chainCount:整数,steps:[{cleared:[[x,y],...],boardAfter:落下後の盤面}]}。
入力を直接変更しないこと。planの結果とゲームロジックを別々に独立検証します。複数seedと未知の盤面を使います。` },
  cube: { system: coding, user: `3×3ルービックキューブの論理とソルバー、面回転アニメーションを実装してください。
stateは54個の整数配列。面順U,R,F,D,L,B、それぞれ外から正面に見た3×3の行優先。完成形は面ごとに同じ数(0,1,2,3,4,5)。座標はx右,y上,z前。
各面の[法線,画面の右,画面の上]: U[[0,1,0],[1,0,0],[0,0,-1]], R[[1,0,0],[0,0,-1],[0,1,0]], F[[0,0,1],[1,0,0],[0,1,0]], D[[0,-1,0],[1,0,0],[0,0,1]], L[[-1,0,0],[0,0,1],[0,1,0]], B[[0,0,-1],[-1,0,0],[0,1,0]]。
手はURFDLBに空文字、'、2を付けた18種類。無印はその面の外から時計回り、'は反時計、2は180度。
export scramble(seed): 合法な25手の配列。隣接して同じ回転軸を選ばない。初期化ごとに生成する。
export applyMove(state,move): 回転後の54整数配列。入力を変更しない。
export solve(state): 完成させる合法手の配列、最大300手。solveは新しい実行環境で呼び、stateだけを渡します。seed・scramble・生成履歴は渡しません。独立生成した未知の25手スクランブルも解いてください。
export animate(move,t): {axis:0|1|2,layer:-1|1,angle:ラジアン}。tは0〜1。軸はx=0,y=1,z=2。右手系の回転角を返し、その層だけを回す。t=0は角度0、t=1は当該手の終端。途中の向き・角度も検査し、あなたが返した回転情報を共通の3D表示で再生します。視点はユーザーが自由に回せます。` },
  arm: { system: coding, user: `物理シミュレーション内の3関節ロボットアームをフィードバック制御してください。左側にある3箱を指でつかみ、仕切りを越えて右の台へ運び、下から中→小→大に積みます。手を離して退避し、3秒安定すれば成功。箱の位置や成否を直接変更できません。重力・接触・摩擦が働き、箱と指を固定する機能はありません。
export reset(config): 内部状態を初期化（戻り値は任意）。configはseed,base:[x,y],lengths:[1.9,1.85,.26],tableY:.25,stackX:1.5,barrier:{x:.75,y:.25,width:.16,height:.42},blocks:[{id,label,order,width,height,mass,initial:[x,y]}],goalSlots:[{id,x,y,width,height}],duration:65。
箱はmedium .28×.22m/.55kg、small .19×.16m/.35kg、large .38×.26m/.85kg。この順に積む。初期x配置をseedで変えます。yは上向き。肩baseは[-1.8,.4]。q[0]は肩の世界角、q[1]は肘の相対角、q[2]は手首の相対角。手首先に長さ.26mの手のひら、さらに.18m延長した場所に2本の指。toolは指の間の世界座標。手首の世界角=-π/2で指が下向き。
export step(obs,dt): {jointSpeeds:[3個のrad/s],gripperOpening:指の内側の間隔m}。50Hzで呼出し、dt=.02。速度指令の絶対値上限は[1.1,1.1,4]、モータートルク上限[90,80,45]N·m。指の開きは0〜.6m。指令がこの範囲を超えた場合は失敗です。閉じる速度は上限.14m/s、各指の最大力12N。目標位置や角度を返すAPIではありません。
obsは{t,q:[3],dq:[3],tool:[x,y],toolVelocity:[vx,vy],palmAngle,gripperOpening,blocks:[{id,x,y,angle,vx,vy,angularVelocity}],contacts:["tag|tag"],stackCount,stableSeconds}。接触tagはblock-medium/block-small/block-large,finger-left/finger-right,table,barrierなどを辞書順で結合した文字列。手の位置・箱の寸法・実際の支持高さを観測して制御してください。
物理は200Hzで進みます。最大65秒。順序と接触による支持、姿勢、静止、指から離れていること、手の退避を共通評価器が確認します。達成段数・落下・衝突・時間も記録します。` },
};
