import { DEFAULT_DATA, FIELD_SKINS } from '../../shared/data';
import { fieldSegments, fieldPosts, fieldArtMapping, dragIntent, insideField } from '../../packages/game-core/src';
import { Renderer, type Skin } from './render';
// Vite development entry only; never imported by the production page.
if (!import.meta.env.DEV) throw new Error('Development field tools are disabled');
const query = new URL(location.href).searchParams,
  auditOnly = query.has('audit');
const selected = query.get('skin'),
  sideQuery = query.get('side');
const requestedQuality = query.get('quality') === 'low' ? 'low' : 'high';
const width = Math.max(120, Math.min(1920, Number(query.get('width')) || 260));
const height = Math.max(160, Math.min(1920, Number(query.get('height')) || 420));
const root = document.getElementById('app')!;
root.innerHTML = `<h1>球场几何标定</h1>
<form><label>皮肤 <select name="skin"><option value="">全部</option>${FIELD_SKINS.map((s) => `<option value="${s.id}">${s.id}</option>`).join('')}</select></label>
<label>视角 <select name="side"><option value="">双方</option><option value="0">side 0</option><option value="1">side 1</option></select></label>
<label>宽 <input name="width" type="number" value="${width}"></label><label>高 <input name="height" type="number" value="${height}"></label><button>检查</button></form>
<p>洋红=墙，青=门柱，橙=弹簧/朝内法线，绿=网。红点=原图锚点，白轴=相机。拖拽显示世界意图；大厅等距图仅展示。</p><output id="intent">点击可玩区域并拖拽查看坐标</output><div id="grid"></div><h2>大厅展示资源</h2><div id="lobby"></div>`;
(root.querySelector('[name=skin]') as HTMLSelectElement).value = selected ?? '';
(root.querySelector('[name=side]') as HTMLSelectElement).value = sideQuery ?? '';
const style = document.createElement('style');
style.textContent = `body{margin:12px;background:#172b34;color:white;font:14px sans-serif}#grid,#lobby{display:grid;grid-template-columns:${selected ? '1fr' : 'repeat(3,260px)'};gap:10px}figure{margin:0}canvas{touch-action:none;display:block}img{width:260px;height:200px;object-fit:contain}h1{font-size:24px}input{width:70px}output{display:block;margin:8px}`;
document.head.append(style);
const rows: { skin: string; side: number; maxErrorM: number; maxErrorPx: number }[] = [];
const renderers: Renderer[] = [];
const previews: Promise<unknown>[] = [];
const blank = () => ({
  pieces: [],
  ball: { x: 0, y: 0, spin: 0 },
  aim: null,
  selectable: new Set<string>(),
  hoverId: null,
  effects: [],
  now: 0,
  springHits: [],
  trail: [],
});
for (const skin of auditOnly ? [] : FIELD_SKINS.filter((s) => !selected || s.id === selected))
  for (const side of [0, 1] as const) {
    if (sideQuery !== null && sideQuery !== '' && Number(sideQuery) !== side) continue;
    const figure = document.createElement('figure'),
      canvas = document.createElement('canvas');
    figure.innerHTML = `<figcaption>${skin.id} / side ${side}</figcaption>`;
    figure.append(canvas);
    root.querySelector('#grid')!.append(figure);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const renderer = new Renderer(canvas, DEFAULT_DATA.geometry, DEFAULT_DATA.physics, skin as Skin);
    renderer.setQuality(requestedQuality);
    renderer.flip = side === 1;
    renderer.resize();
    renderers.push(renderer);
    const paint = () => {
      renderer.draw(blank());
      const ctx = canvas.getContext('2d')!,
        dpr = canvas.width / width;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 1;
      for (const segment of fieldSegments(DEFAULT_DATA.geometry)) {
        ctx.strokeStyle = segment.kind === 'wall' ? '#ff00d4' : segment.kind === 'spring' ? '#ff9b22' : '#44ff88';
        const a = renderer.toScreen(...segment.a),
          b = renderer.toScreen(...segment.b);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        if (segment.n) {
          const mid = { x: (segment.a[0] + segment.b[0]) / 2, y: (segment.a[1] + segment.b[1]) / 2 };
          const start = renderer.toScreen(mid.x, mid.y),
            end = renderer.toScreen(mid.x + segment.n[0] * 0.4, mid.y + segment.n[1] * 0.4);
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(end.x, end.y);
          ctx.stroke();
        }
      }
      for (const p of fieldPosts(DEFAULT_DATA.geometry)) {
        const q = renderer.toScreen(p.x, p.y);
        ctx.strokeStyle = '#00eaff';
        ctx.beginPath();
        ctx.arc(q.x, q.y, p.radius * renderer.scale, 0, Math.PI * 2);
        ctx.stroke();
      }
      const origin = renderer.toScreen(0, 0),
        x = renderer.toScreen(0.6, 0),
        y = renderer.toScreen(0, 0.6);
      ctx.strokeStyle = 'white';
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(x.x, x.y);
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(y.x, y.y);
      ctx.stroke();
      if (skin.artCrop) {
        const mapping = fieldArtMapping(DEFAULT_DATA.geometry, skin),
          [l, t, r, b] = skin.artCrop;
        for (const source of [
          { x: l, y: t },
          { x: r, y: t },
          { x: r, y: b },
          { x: l, y: b },
        ]) {
          const world = mapping.sourceToWorld(source),
            p = renderer.toScreen(world.x, world.y);
          ctx.fillStyle = '#ff4858';
          ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
        }
      }
    };
    previews.push(
      renderer.preloadField().then(() => {
        paint();
        let maxErrorM = 0;
        if (skin.artCrop) {
          const map = fieldArtMapping(DEFAULT_DATA.geometry, skin);
          for (const p of fieldPosts(DEFAULT_DATA.geometry)) {
            const a = map.sourceToWorld(map.worldToSource(p));
            maxErrorM = Math.max(maxErrorM, Math.hypot(a.x - p.x, a.y - p.y));
          }
        }
        rows.push({ skin: skin.id, side, maxErrorM, maxErrorPx: maxErrorM * renderer.scale });
      }),
    );
    let start: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (event) => {
      const point = renderer.clientToWorld(event.clientX, event.clientY);
      if (!insideField(DEFAULT_DATA.geometry, point.x, point.y, DEFAULT_DATA.physics.disc.radius, 0)) return;
      start = point;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!start) return;
      const point = renderer.clientToWorld(event.clientX, event.clientY),
        intent = dragIntent(start, point, DEFAULT_DATA.physics.disc.radius, 2.4);
      paint();
      const ctx = canvas.getContext('2d')!,
        a = renderer.toScreen(start.x, start.y),
        b = renderer.toScreen(point.x, point.y);
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      root.querySelector('#intent')!.textContent = JSON.stringify({ from: start, to: point, ...intent });
    });
    canvas.addEventListener('pointerup', () => {
      start = null;
    });
    canvas.addEventListener('pointercancel', () => {
      start = null;
    });
  }
if (!auditOnly)
  for (let i = 1; i <= 5; i++) {
    const figure = document.createElement('figure');
    figure.innerHTML = `<figcaption>lobby Image_0${i} · presentation only</figcaption><img src="/assets/orig_ui/stadium/Image_0${i}.png">`;
    root.querySelector('#lobby')!.append(figure);
  }
Promise.all(previews).then(async () => {
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode()));
  (window as unknown as { __fieldCalibration: unknown }).__fieldCalibration = {
    rows,
    ready: true,
    resourceAudit,
    matrixAudit,
    resources: () => renderers.map((renderer) => renderer.resourceStats()),
  };
});
window.addEventListener(
  'pagehide',
  () => {
    for (const renderer of renderers) renderer.dispose();
  },
  { once: true },
);
async function resourceAudit() {
  const stats = [];
  for (const quality of ['low', 'medium', 'high'] as const)
    for (let i = 0; i < 5; i++) {
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:390px;height:700px;position:absolute;left:-10000px;top:0';
      document.body.append(canvas);
      const renderer = new Renderer(canvas, DEFAULT_DATA.geometry, DEFAULT_DATA.physics, FIELD_SKINS[0] as Skin);
      try {
        renderer.setQuality(quality);
        renderer.resize();
        for (const skin of FIELD_SKINS) {
          renderer.skin = skin as Skin;
          await renderer.preloadField();
          renderer.resize();
          renderer.draw(blank());
        }
        for (const id of Object.keys(DEFAULT_DATA.players).slice(0, 40)) await renderer.preloadAvatar(id);
        const before = renderer.resourceStats();
        renderer.dispose();
        const after = renderer.resourceStats();
        stats.push({ before, after });
      } finally {
        renderer.dispose();
        canvas.remove();
      }
    }
  return stats;
}
async function matrixAudit(quality: 'low' | 'high' = 'high') {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:-10000px;top:0';
  document.body.append(canvas);
  const renderer = new Renderer(canvas, DEFAULT_DATA.geometry, DEFAULT_DATA.physics, FIELD_SKINS[0] as Skin),
    results = [];
  const from = { x: 0.5, y: 1 },
    to = { x: 1, y: 2.2 },
    expected = dragIntent(from, to, DEFAULT_DATA.physics.disc.radius, 2.4);
  try {
    renderer.setQuality(quality);
    for (const skin of FIELD_SKINS)
      for (const side of [0, 1])
        for (const [w, h] of [
          [320, 568],
          [390, 844],
          [768, 1024],
          [1440, 900],
        ]) {
          canvas.style.width = w + 'px';
          canvas.style.height = h + 'px';
          renderer.skin = skin as Skin;
          renderer.flip = side === 1;
          await renderer.preloadField();
          renderer.resize();
          renderer.draw(blank());
          const rect = canvas.getBoundingClientRect();
          const inverse = (p: { x: number; y: number }) => {
            const screen = renderer.toScreen(p.x, p.y);
            return renderer.clientToWorld(rect.left + screen.x, rect.top + screen.y);
          };
          const actual = dragIntent(inverse(from), inverse(to), DEFAULT_DATA.physics.disc.radius, 2.4);
          const error = Math.max(...(['dirX', 'dirY', 'power'] as const).map((k) => Math.abs(actual[k] - expected[k])));
          results.push({ skin: skin.id, side, width: w, height: h, dpr: devicePixelRatio, quality, error });
        }
  } finally {
    renderer.dispose();
    canvas.remove();
  }
  return results;
}
