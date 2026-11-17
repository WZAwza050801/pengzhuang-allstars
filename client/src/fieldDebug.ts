import { DEFAULT_DATA,FIELD_SKINS } from '../../shared/data';
import { fieldSegments,fieldPosts,fieldArtMapping } from '../../packages/game-core/src';
import { Renderer,type Skin } from './render';
// Separate Vite development entry. The production entry never imports or builds this page.
if (!import.meta.env.DEV) throw new Error('Development field tools are disabled');
const auditOnly=new URL(location.href).searchParams.has('audit');
const root=document.getElementById('app')!;
root.innerHTML='<h1>球场几何标定</h1><p>洋红=墙，青=门柱，橙=弹簧，绿=网。大厅图为等距展示，不参与碰撞。</p><div id="grid"></div><h2>大厅展示资源</h2><div id="lobby"></div>';
const style=document.createElement('style');style.textContent='body{margin:12px;background:#172b34;color:white;font:14px sans-serif}#grid,#lobby{display:grid;grid-template-columns:repeat(3,260px);gap:10px}figure{margin:0}canvas{width:260px;height:420px;display:block}img{width:260px;height:200px;object-fit:contain}h1{font-size:24px}';document.head.append(style);
const rows: {skin:string;side:number;maxErrorM:number;maxErrorPx:number}[]=[];
const renderers:Renderer[]=[];
const previews:Promise<unknown>[]=[];
for(const skin of (auditOnly?[]:FIELD_SKINS))for(const side of [0,1] as const) {
  const figure=document.createElement('figure'),canvas=document.createElement('canvas');figure.innerHTML=`<figcaption>${skin.id} / side ${side}</figcaption>`;figure.append(canvas);root.querySelector('#grid')!.append(figure);
  const renderer=new Renderer(canvas,DEFAULT_DATA.geometry,DEFAULT_DATA.physics,skin as Skin);renderer.flip=side===1;renderer.resize();renderers.push(renderer);
  previews.push(renderer.preloadField().then(()=>{
    renderer.draw({pieces:[],ball:{x:0,y:0,spin:0},aim:null,selectable:new Set(),hoverId:null,effects:[],now:0,springHits:[],trail:[]});
    const ctx=canvas.getContext('2d')!,dpr=canvas.width/260;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.lineWidth=1;
    for(const segment of fieldSegments(DEFAULT_DATA.geometry)) {
      ctx.strokeStyle=segment.kind==='wall'?'#ff00d4':segment.kind==='spring'?'#ff9b22':'#44ff88';
      const a=renderer.toScreen(...segment.a),b=renderer.toScreen(...segment.b);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
    for(const p of fieldPosts(DEFAULT_DATA.geometry)) {const q=renderer.toScreen(p.x,p.y);ctx.strokeStyle='#00eaff';ctx.beginPath();ctx.arc(q.x,q.y,p.radius*renderer.scale,0,Math.PI*2);ctx.stroke();}
    let maxErrorM=0;
    if(skin.artCrop) {
      const map=fieldArtMapping(DEFAULT_DATA.geometry,skin);
      for(const p of fieldPosts(DEFAULT_DATA.geometry)) {const a=map.sourceToWorld(map.worldToSource(p));maxErrorM=Math.max(maxErrorM,Math.hypot(a.x-p.x,a.y-p.y));}
    }
    rows.push({skin:skin.id,side,maxErrorM,maxErrorPx:maxErrorM*renderer.scale});
  }));
}
if(!auditOnly)for(let i=1;i<=5;i++) {
  const figure=document.createElement('figure');figure.innerHTML=`<figcaption>lobby Image_0${i} · presentation only</figcaption><img src="/assets/orig_ui/stadium/Image_0${i}.png">`;root.querySelector('#lobby')!.append(figure);
}
Promise.all(previews).then(async()=>{
  await Promise.all([...root.querySelectorAll('img')].map(img=>img.decode()));
  (window as unknown as {__fieldCalibration:unknown}).__fieldCalibration={rows,ready:true,resourceAudit};
});

async function resourceAudit() {
  const stats=[];
  for(const quality of ['low','medium','high'] as const)for(let i=0;i<5;i++) {
    const canvas=document.createElement('canvas');canvas.style.cssText='width:390px;height:700px;position:absolute;left:-10000px;top:0';document.body.append(canvas);
    const renderer=new Renderer(canvas,DEFAULT_DATA.geometry,DEFAULT_DATA.physics,FIELD_SKINS[0] as Skin);
    try {
      renderer.setQuality(quality);renderer.resize();
      for(const skin of FIELD_SKINS) {
        renderer.skin=skin as Skin;await renderer.preloadField();renderer.resize();
        renderer.draw({pieces:[],ball:{x:0,y:0,spin:0},aim:null,selectable:new Set(),hoverId:null,effects:[],now:0,springHits:[],trail:[]});
      }
      for(const id of Object.keys(DEFAULT_DATA.players).slice(0,40))await renderer.avatar(id).decode();
      const before=renderer.resourceStats();renderer.dispose();const after=renderer.resourceStats();
      stats.push({before,after});
    }finally{renderer.dispose();canvas.remove();}
  }
  return stats;
}
