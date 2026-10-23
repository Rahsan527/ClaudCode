// Ищет щели и дыры, сквозь которые видно изнанку модели (п. 4 ТЗ: «Сквозных щелей нет»).
//
//   node tools/check_gaps.mjs model.glb [--out=папка] [--three=путь/к/three] [--playwright=путь]
//
// Модель снимается в three.js так же, как в игре: материалы односторонние. Изнанка граней красится красным.
// Камера идёт вдоль модели (по X) и с близкого расстояния снимает в четырёх ракурсах сверху-сбоку.
// Длинная тонкая красная линия — это щель (палуба не дошла до переборки, фонарь без задней стенки,
// шов между частями трубы). Красное пятно — открытая труба или раструб, это не щель.
// Материалы с doubleSided (ограждения, сетки) не проверяются: изнанка у них видна по задумке.
// Код выхода 0 — щелей нет; 1 — найдены (снимки с ними в --out, если задан).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const glb = args.find((a) => !a.startsWith('--'));
if (!glb) {
  console.log('node tools/check_gaps.mjs model.glb [--out=папка] [--three=путь/к/three] [--playwright=путь]');
  process.exit(2);
}
const out = opt('out', '');
const req = createRequire(path.resolve(opt('playwright', '/opt/node22/lib/node_modules/')) + '/');
const { chromium } = req('playwright');
const threeRoot = path.resolve(opt('three', '') || createRequire(path.resolve('package.json')).resolve('three/package.json').replace(/package\.json$/, ''));
if (out) fs.mkdirSync(out, { recursive: true });

const W = 1200, H = 700;
const html = `<!doctype html><html><body style="margin:0">
<script type="importmap">{"imports":{"three":"http://x/three/build/three.module.js","three/addons/":"http://x/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const W=${W},H=${H}, BG=[0x8f,0xa8,0xd8];
const r=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true}); r.setSize(W,H); document.body.appendChild(r.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x8fa8d8);
scene.add(new THREE.HemisphereLight(0xffffff,0x445566,2.2));
const g=await new GLTFLoader().loadAsync('http://x/m.glb'); scene.add(g.scene);
const box=new THREE.Box3().setFromObject(g.scene), size=box.getSize(new THREE.Vector3());
const L=Math.max(size.x,size.z), D=Math.max(2.5,L*0.13);
const red=new THREE.MeshBasicMaterial({color:0xff0000,side:THREE.BackSide});
const front=[]; g.scene.traverse(o=>{ if(o.isMesh && o.material.side===THREE.FrontSide) front.push(o); });
front.forEach(o=>o.add(new THREE.Mesh(o.geometry,red)));
const cam=new THREE.PerspectiveCamera(30,W/H,0.05,5000);
const views={aft_q:[-0.75,0.4,0.55],bow_q:[0.75,0.4,0.55],aft_p:[-0.75,0.4,-0.55],bow_p:[0.75,0.4,-0.55]};
// точки вдоль модели: верх основного тела (корпус, фюзеляж) над осью X
const rc=new THREE.Raycaster(); const pts=[];
const step=Math.max(L/20,0.4);
for(let x=box.min.x+step/2;x<box.max.x;x+=step){
  rc.set(new THREE.Vector3(x,box.max.y+1,0),new THREE.Vector3(0,-1,0));
  const hits=rc.intersectObjects(front,false);
  // основное тело: корпус, палуба, фюзеляж по имени, иначе самая крупная сетка (провода и мачты пропускаем)
  const body=hits.filter(h=>/hull|deck|fuselage/i.test(h.object.name));
  const pick=body[0]||hits.slice().sort((a,b)=>b.object.geometry.attributes.position.count-a.object.geometry.attributes.position.count)[0];
  if(pick) pts.push([x,pick.point.y+D*0.08]);
}
// тонкие длинные красные компоненты
function lines(px){
  const isR=new Uint8Array(W*H); for(let i=0;i<W*H;i++){const R=px[i*4],G=px[i*4+1],B=px[i*4+2]; isR[i]=R>200&&G<60&&B<60?1:0;}
  const seen=new Uint8Array(W*H), found=[], q=new Int32Array(W*H);
  for(let s=0;s<W*H;s++){ if(!isR[s]||seen[s]) continue;
    let h=0,t=0,n=0,x0=W,x1=0,y0=H,y1=0; q[t++]=s; seen[s]=1;
    while(h<t){ const p=q[h++]; n++; const x=p%W,y=(p/W)|0; x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const X=x+dx,Y=y+dy; if(X<0||Y<0||X>=W||Y>=H)continue; const k=Y*W+X; if(isR[k]&&!seen[k]){seen[k]=1;q[t++]=k;}}}
    const len=Math.max(x1-x0,y1-y0)+1, wid=n/len;
    if(len>120 && wid>1.5 && wid<12) found.push(len);
  }
  return found;
}
window.scan=()=>{ const res=[]; const gl=r.getContext(); const px=new Uint8Array(W*H*4);
  pts.forEach(([x,y],i)=>{ for(const [name,v] of Object.entries(views)){
    cam.position.set(x+v[0]*D,y+v[1]*D,v[2]*D); cam.lookAt(x,y,0); r.render(scene,cam);
    gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px); const f=lines(px);
    if(f.length) res.push({i,x,y,name,len:Math.max(...f)}); } });
  return {res,n:pts.length,step,D,pts}; };
window.shot=(x,y,name)=>{ const v=views[name]; cam.position.set(x+v[0]*D,y+v[1]*D,v[2]*D); cam.lookAt(x,y,0); r.render(scene,cam); };
window.ready=true;
</script></body></html>`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('http://x/**', (route) => {
  const u = new URL(route.request().url()).pathname;
  if (u === '/') return route.fulfill({ body: html, contentType: 'text/html' });
  if (u === '/m.glb') return route.fulfill({ path: path.resolve(glb) });
  if (u.startsWith('/three/')) return route.fulfill({ path: path.join(threeRoot, u.slice(7)) });
  return route.fulfill({ status: 404 });
});
await page.goto('http://x/');
try {
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
} catch {
  console.log('не загрузилось:', errors.join('; '));
  process.exit(2);
}
const { res, n, step, D, pts } = await page.evaluate(() => window.scan());
if (process.env.GAPS_DEBUG) console.log(pts.map(([x, y]) => x.toFixed(1) + ':' + y.toFixed(1)).join(' '));
console.log(`${path.basename(glb)}: снято ${n} точек × 4 ракурса (шаг ${step.toFixed(2)} м, камера в ${D.toFixed(1)} м)`);
for (const h of res) {
  console.log(`  щель? x = ${h.x.toFixed(1)} м, ракурс ${h.name}, красная линия ${h.len} px`);
  if (out) {
    await page.evaluate(([x, y, nm]) => window.shot(x, y, nm), [h.x, h.y, h.name]);
    await page.locator('canvas').screenshot({ path: path.join(out, `gap_x${h.x.toFixed(1)}_${h.name}.png`) });
  }
}
console.log(res.length ? `Найдено мест со щелями: ${res.length}. Красное на снимках — изнанка, видная сквозь щель.` : 'Сквозных щелей не найдено.');
await browser.close();
process.exit(res.length ? 1 : 0);
