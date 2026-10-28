import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from 'file:///C:/Users/kris5/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';

const OUT = path.resolve('pptx-build-private/draft.pptx');
const PREVIEW = path.resolve('pptx-build-private');
const W = 1280, H = 720;
const C = {
  ink: '#142B3B', muted: '#536B78', teal: '#087F8C', tealPale: '#E6F4F3',
  blue: '#356B9A', bluePale: '#EAF1F8', amber: '#B97819', amberPale: '#FFF3DD',
  green: '#397A58', greenPale: '#EAF4ED', paper: '#F7F8F6', white: '#FFFFFF',
  line: '#CBD5D8', faint: '#E8ECEB', red: '#A65349', redPale: '#F9ECE9'
};
const FONT = 'Yu Gothic';
const p = Presentation.create({ slideSize: { width: W, height: H } });

function shape(slide, name, x,y,w,h, {fill='none',stroke='none',sw=0,geometry='rect'}={}) {
  return slide.shapes.add({geometry,name,position:{left:x,top:y,width:w,height:h},fill,
    line:{style:'solid',fill:stroke,width:sw}});
}
function text(slide, name, value, x,y,w,h, {size=20,color=C.ink,bold=false,align='left',valign='middle',fill='none'}={}) {
  const s=shape(slide,name,x,y,w,h,{fill}); s.text=value; s.text.style={fontFamily:FONT,fontSize:size,color,bold,alignment:align,verticalAlignment:valign,wrap:true}; s.text.insets={left:0,right:0,top:0,bottom:0}; return s;
}
function box(slide,name,x,y,w,h,title,body,accent=C.teal,background=C.white, {titleSize=22,bodySize=16}={}) {
  const s=shape(slide,name,x,y,w,h,{fill:background,stroke:C.line,sw:1,geometry:'roundRect'});
  shape(slide,`${name}-accent`,x,y,7,h,{fill:accent});
  text(slide,`${name}-title`,title,x+20,y+12,w-38,32,{size:titleSize,bold:true,color:accent});
  text(slide,`${name}-body`,body,x+20,y+49,w-38,h-58,{size:bodySize,color:C.ink,valign:'top'});
  return s;
}
function header(slide,title,sub,index) {
  text(slide,`title-${index}`,title,64,36,1150,54,{size:34,bold:true});
  text(slide,`sub-${index}`,sub,66,91,1148,29,{size:16,color:C.muted});
  shape(slide,`rule-${index}`,64,132,1152,2,{fill:C.teal});
  text(slide,`page-${index}`,String(index).padStart(2,'0'),1170,676,46,24,{size:13,color:C.muted,align:'right'});
}
function connect(slide,from,to,{fromSide='right',toSide='left',color=C.muted,kind='elbow',dashed=false,bidirectional=false}={}) {
  return slide.shapes.connect(from,to,{kind,fromSide,toSide,line:{style:dashed?'dashed':'solid',fill:color,width:2},
    ...(bidirectional?{head:{type:'arrow',width:'sm',length:'sm'},tail:{type:'arrow',width:'sm',length:'sm'}}:{tail:{type:'arrow',width:'med',length:'med'}})});
}

// 1. Cover: short framing, one concrete architecture statement.
{
  const s=p.slides.add(); s.background.fill=C.paper;
  shape(s,'cover-accent',0,0,18,H,{fill:C.teal});
  text(s,'cover-kicker','MICHIRU  /  TRIP ASSIST',72,94,600,28,{size:16,bold:true,color:C.teal});
  text(s,'cover-title','システム構成',72,162,790,80,{size:50,bold:true});
  text(s,'cover-subtitle','フロントエンド・処理・データ保存・外部サービスのつながり',76,258,1000,42,{size:24,color:C.muted});
  shape(s,'cover-rule',76,332,790,3,{fill:C.teal});
  text(s,'cover-summary','Chrome拡張機能が画面と処理を担い、FirebaseとGoogle APIへ直接接続する構成',76,374,880,72,{size:22,color:C.ink});
  text(s,'cover-note','コードと設定ファイルをもとに作成',76,626,700,28,{size:15,color:C.muted});
  s.speakerNotes.text='対象はChrome拡張機能 Trip Assist。リポジトリ内のmanifest、background、offscreen、panel、Firebase設定をもとに整理。';
}

// 2. Architecture map: all editable native shapes and connectors.
{
  const s=p.slides.add(); s.background.fill=C.paper;
  header(s,'システム構成','Chrome拡張機能を中心に、FirebaseとGoogleの外部APIを接続',2);
  const ui=box(s,'ui',64,220,232,176,'フロントエンド','Google マップ上の画面\n日程・候補地・投票・ルート\n画面状態と操作入力',C.teal,C.tealPale,{titleSize:21,bodySize:15});
  const sw=box(s,'sw',362,191,260,174,'Service Worker','OAuth トークン取得\nメッセージの振り分け\nCalendar / Gmail / Gemini / Geocoding',C.blue,C.bluePale,{titleSize:21,bodySize:15});
  const off=box(s,'off',362,405,260,155,'offscreen document','Firebase SDKで認証・常時接続\nRealtime Databaseの変更を監視',C.blue,C.bluePale,{titleSize:20,bodySize:15});
  const db=box(s,'db',715,254,225,164,'データベース','Firebase Realtime Database\n旅行・メンバー・候補日\n出欠・候補地・投票',C.green,C.greenPale,{titleSize:20,bodySize:15});
  const local=box(s,'local',715,458,225,119,'端末内保存','chrome.storage.local\n幹事の訪問地点・日程など',C.muted,'#EEF0F0',{titleSize:19,bodySize:14});
  const google=box(s,'google',1010,192,220,136,'Google連携','Calendar API\nGmail API',C.amber,C.amberPale,{titleSize:20,bodySize:15});
  const ai=box(s,'ai',1010,364,220,94,'AI・位置検索','Gemini API\nGeocoding API',C.amber,C.amberPale,{titleSize:19,bodySize:14});
  const maps=box(s,'maps',1010,494,220,89,'地図サービス','Google マップ\nルート案内を開く',C.amber,C.amberPale,{titleSize:19,bodySize:14});
  connect(s,ui,sw,{color:C.teal});
  connect(s,ui,off,{fromSide:'right',toSide:'left',color:C.teal});
  connect(s,off,db,{color:C.green,bidirectional:true});
  connect(s,sw,local,{fromSide:'bottom',toSide:'top',color:C.muted,kind:'elbow'});
  connect(s,sw,google,{color:C.amber});
  connect(s,sw,ai,{fromSide:'right',toSide:'left',color:C.amber});
  connect(s,ui,maps,{fromSide:'right',toSide:'left',color:C.amber});
  // Arrow labels as restrained text placed next to the flow.
  text(s,'label-messages','拡張機能内メッセージ',300,186,180,23,{size:13,color:C.muted});
  text(s,'label-oauth','Google OAuth',839,186,118,22,{size:13,color:C.amber});
  text(s,'label-local','ローカル保存',793,429,112,22,{size:13,color:C.muted});
  text(s,'arch-foot','独立した自前のWebサーバーはなく、拡張機能の各実行領域がFirebaseと外部APIに接続',66,619,1100,32,{size:17,bold:true,color:C.ink});
  s.speakerNotes.text='Service WorkerはMV3のbackground service worker。offscreen documentがFirebase Realtime Databaseへの常時接続と認証状態を保持する。Google MapsはAPI呼び出しに加え、画面からURLを開く連携もある。';
}

// 3. Data flow: sign-in, real-time sync, external API paths.
{
  const s=p.slides.add(); s.background.fill=C.paper;
  header(s,'データの流れ','画面操作は拡張機能内のメッセージを経由し、用途別の保存先・APIへ進む',3);
  text(s,'lane-user','利用者の操作',68,160,210,30,{size:17,bold:true,color:C.teal});
  const u=box(s,'flow-ui',68,207,214,126,'画面','旅行作成・招待\n候補地の投票・日程調整',C.teal,C.tealPale,{titleSize:20,bodySize:15});
  const m=box(s,'flow-message',348,207,224,126,'拡張機能内通信','chrome.runtime\nメッセージで処理を依頼',C.blue,C.bluePale,{titleSize:19,bodySize:15});
  const worker=box(s,'flow-worker',642,207,250,126,'Service Worker','処理を振り分け\nGoogle OAuthが必要なAPIを実行',C.blue,C.bluePale,{titleSize:20,bodySize:15});
  connect(s,u,m,{color:C.teal}); connect(s,m,worker,{color:C.blue});
  const fba=box(s,'flow-firebase-auth',348,391,224,110,'Google認証','Firebase Authentication\nGoogleサインイン',C.green,C.greenPale,{titleSize:19,bodySize:14});
  const fbdb=box(s,'flow-firebase-db',642,376,250,136,'共有データ','Realtime Database\n変更をリアルタイム監視',C.green,C.greenPale,{titleSize:20,bodySize:15});
  const local=box(s,'flow-local',969,207,250,126,'ローカルデータ','chrome.storage.local\n端末ごとの訪問地点・確定日程',C.muted,'#EEF0F0',{titleSize:19,bodySize:15});
  connect(s,worker,fbdb,{fromSide:'bottom',toSide:'top',color:C.green,bidirectional:true});
  connect(s,fba,fbdb,{color:C.green});
  connect(s,worker,local,{color:C.muted});
  const ex=box(s,'flow-google',969,391,250,110,'Google API','Calendar予定の取得・登録\nGmailで招待メールを送信',C.amber,C.amberPale,{titleSize:19,bodySize:14});
  const ai=box(s,'flow-ai',68,391,214,110,'提案・位置検索','Geminiのスポット提案\nGeocodingで座標を取得',C.amber,C.amberPale,{titleSize:18,bodySize:14});
  connect(s,worker,ex,{fromSide:'right',toSide:'top',color:C.amber,kind:'elbow'});
  connect(s,worker,ai,{fromSide:'left',toSide:'top',color:C.amber,kind:'elbow'});
  shape(s,'legend-green',72,552,13,13,{fill:C.green}); text(s,'legend-green-t','共有データは旅行メンバー間で同期',94,546,390,27,{size:15,color:C.ink});
  shape(s,'legend-gray',538,552,13,13,{fill:C.muted}); text(s,'legend-gray-t','ローカルデータは端末内に保存',560,546,340,27,{size:15,color:C.ink});
  text(s,'flow-note','Firebaseの共有データと、幹事端末に保存する日程・訪問地点を使い分ける',68,602,1100,34,{size:18,bold:true,color:C.ink});
  s.speakerNotes.text='Firebase同期はoffscreen.jsが担当し、FirebaseのスナップショットをService Worker経由でchrome.storage.localのfb:*領域へ中継する。画面側は変更を受けて再描画する。独自に保存する日程等はlocal:<旅行ID>キーを使う。';
}

await fs.mkdir(path.dirname(OUT),{recursive:true});
await fs.mkdir(PREVIEW,{recursive:true});
for (let i=0;i<p.slides.items.length;i++) {
  const png=await p.export({slide:p.slides.items[i],format:'png',scale:1});
  await fs.writeFile(path.join(PREVIEW,`slide-${i+1}.png`),new Uint8Array(await png.arrayBuffer()));
}
const pptx=await PresentationFile.exportPptx(p); await pptx.save(OUT);
console.log(`Created ${OUT} (${p.slides.items.length} slides)`);
