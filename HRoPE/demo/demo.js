/* Ideal shared-plane geometry, using the manuscript's H_i = K_i(R_i + t_i n^T/d). */
const displayCanvas=document.getElementById('scene'),displayCtx=displayCanvas.getContext('2d');
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
const pixelRatio=Math.min(window.devicePixelRatio||1,3);
canvas.width=1280*pixelRatio;canvas.height=560*pixelRatio;ctx.scale(pixelRatio,pixelRatio);
function present(){
 const mobile=displayCanvas.clientWidth<660, w=mobile?640:1280,h=mobile?955:560;
 if(displayCanvas.width!==Math.round(w*pixelRatio)||displayCanvas.height!==Math.round(h*pixelRatio)){displayCanvas.width=Math.round(w*pixelRatio);displayCanvas.height=Math.round(h*pixelRatio)}
 displayCtx.setTransform(pixelRatio,0,0,pixelRatio,0,0);displayCtx.fillStyle='#fff';displayCtx.fillRect(0,0,w,h);
 if(!mobile){displayCtx.drawImage(canvas,0,0,1280,560);return}
 const part=(x,y,cw,ch,dy)=>displayCtx.drawImage(canvas,x*pixelRatio,y*pixelRatio,cw*pixelRatio,ch*pixelRatio,0,dy,640,ch);
 displayCtx.fillStyle='#142d3b';displayCtx.font='600 28px Arial';displayCtx.fillText('One scene, two cameras',20,36);
 part(0,65,640,395,52);
 displayCtx.fillStyle='#142d3b';displayCtx.fillText('Two views of the same neighborhood',20,475);
 part(640,55,640,435,495);
}
const state={slant:25,distance:3,baseline:2.4,plane:true,playing:false};
const C={ink:'#142d3b',muted:'#667981',line:'#dce5e8',green:'#217c62',orange:'#d78238',purple:'#8273a8'};
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),scale=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=a=>scale(a,1/Math.hypot(...a));
const mv=(a,v)=>a.map(row=>dot(row,v)),mm=(a,b)=>a.map(row=>[0,1,2].map(c=>dot(row,b.map(r=>r[c]))));
function inv(a){const [x,y,z]=a,det=dot(x,cross(y,z));return [0,1,2].map(i=>[cross(y,z)[i],cross(z,x)[i],cross(x,y)[i]].map(v=>v/det));}
function geometry(){let th=state.slant*Math.PI/180,n=[Math.sin(th),0,Math.cos(th)],d=state.distance*n[2],center=[0,0,state.distance],u=[Math.cos(th),0,-Math.sin(th)],v=[0,1,0];let cams=[[-state.baseline/2,0,-2.4],[state.baseline/2,0,-2.4]];let K=[[1.7,0,0],[0,1.7,0],[0,0,1]];let H=cams.map(cam=>mm(K,[0,1,2].map(i=>[0,1,2].map(j=>(i===j?1:0)-cam[i]*n[j]/d))));return {n,d,center,u,v,cams,H,G:mm(H[0],inv(H[1])),point:(x,y)=>add(center,add(scale(u,x),scale(v,y)))};}
function poly(points,fill,stroke,width=1){ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}}
function line(a,b,color,width=1,dash=[]){ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([])}
function text(s,x,y,size=20,color=C.ink,weight=400,align='left'){ctx.fillStyle=color;ctx.font=`${weight} ${size}px Arial`;ctx.textAlign=align;ctx.fillText(s,x,y)}
function circle(p,r,fill){ctx.beginPath();ctx.arc(...p,r,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill()}
function arrow(a,b,color,width=2){line(a,b,color,width);const v=unit([b[0]-a[0],b[1]-a[1],0]),n=[-v[1],v[0]];poly([b,[b[0]-v[0]*11+n[0]*5,b[1]-v[1]*11+n[1]*5],[b[0]-v[0]*11-n[0]*5,b[1]-v[1]*11-n[1]*5]],color)}
const eye=[6,4,-7],look=[0,0,1],forward=unit(sub(look,eye)),right=unit(cross(forward,[0,1,0])),up=cross(right,forward);
function world(p){const v=sub(p,eye),z=dot(v,forward);return[310+dot(v,right)*780/z,255-dot(v,up)*780/z]}
function cameraView(p,c,box){const v=sub(p,c);return [box[0]+box[2]/2+(v[0]/v[2]+c[0]/(state.distance-c[2]))*box[2]*1.7,box[1]+box[3]/2-v[1]/v[2]*box[3]*1.7]}
function draw(){const g=geometry();ctx.clearRect(0,0,1280,560);ctx.fillStyle='#fff';ctx.fillRect(0,0,1280,560);
 text('The scene, shared across views',30,39,24,C.ink,600);text('Same point. Different local neighborhoods.',670,39,24,C.ink,600);
 for(let x=-3;x<=3;x++)line(world([x,-1.35,-2.5]),world([x,-1.35,4.8]),'#edf1f2');
 for(let z=-2;z<=5;z++)line(world([-3,-1.35,z]),world([3,-1.35,z]),'#edf1f2');
 const corners=[[-1.25,-1],[-1.25,1],[1.25,1],[1.25,-1]].map(p=>g.point(...p));
 if(state.plane){poly(corners.map(world),'#e7f1ec',C.green,2);for(let i=-5;i<=5;i++)line(world(g.point(i*.25,-1)),world(g.point(i*.25,1)),'#b8d7ca');for(let i=-4;i<=4;i++)line(world(g.point(-1.25,i*.25)),world(g.point(1.25,i*.25)),'#b8d7ca');}
 const patch=[[-.25,-.25],[-.25,.25],[.25,.25],[.25,-.25]].map(p=>g.point(...p));if(state.plane)poly(patch.map(world),'#82c6ab',C.green,2);circle(world(g.center),5,C.green);
 g.cams.forEach((cam,i)=>{const color=i?C.green:C.orange;const frame=[[-.37,-.25,1.05],[-.37,.25,1.05],[.37,.25,1.05],[.37,-.25,1.05]].map(p=>add(cam,p));frame.forEach(p=>line(world(cam),world(p),color,1.4));poly(frame.map(world),i?'#eaf5f0':'#fff4e8',color,1.4);line(world(cam),world(g.center),color,1.8,[5,5]);circle(world(cam),5,color);const cp=world(cam);text(i?'View j':'View i',cp[0],cp[1]+33,19,color,600,'center');});
 if(state.plane){const a=world(g.center),b=world(add(g.center,scale(g.n,.95)));arrow(a,b,C.purple,3);text('n',b[0]+12,b[1],24,C.purple,600);text('Local tangent plane',320,110,20,C.green,600)}
 else text('A point has no orientation',300,110,20,C.muted,400,'center');
 const boxes=[[664,105,268,266],[970,105,268,266]];
 boxes.forEach((box,i)=>{const color=i?C.green:C.orange;ctx.fillStyle='#f5f8f9';ctx.fillRect(...box);for(let j=1;j<6;j++){line([box[0]+j*box[2]/6,box[1]],[box[0]+j*box[2]/6,box[1]+box[3]],'#e6edef');line([box[0],box[1]+j*box[3]/6],[box[0]+box[2],box[1]+j*box[3]/6],'#e6edef')}
  const project=p=>cameraView(p,g.cams[i],box);ctx.save();ctx.beginPath();ctx.rect(...box);ctx.clip();if(state.plane){for(let u=-5;u<5;u++)for(let v=-4;v<4;v++){const tile=[[u*.25,v*.25],[u*.25,(v+1)*.25],[(u+1)*.25,(v+1)*.25],[(u+1)*.25,v*.25]].map(p=>project(g.point(...p)));poly(tile,(u+v)%2?'#c0d8cd':'#e3ede7','#b1cabf',.8)}poly(patch.map(project),'#f4ca75',color,3)}circle(project(g.center),5,color);ctx.restore();text(i?'Patch neighborhood in view j':'Patch neighborhood in view i',box[0]+box[2]/2,84,18,color,600,'center');});
 arrow([961,237],[939,237],C.ink,2);text('Hᵢ Hⱼ⁻¹',950,415,31,C.green,600,'center');text(state.plane?'The plane determines the cross-view warp.':'Position alone leaves this warp unspecified.',950,454,21,C.ink,400,'center');
 if(!window.captureClean)text(state.plane?'Orientation changes the patch footprint.':'The patch center stays fixed as slant changes.',30,491,21,C.ink,400);
 text('Ideal shared-plane illustration',30,530,15,C.muted);text('HRoPE learns per-patch transforms from image features.',670,530,17,C.muted);
 const q=[.7,-.3,1],k=[.2,.5,1];document.getElementById('score').textContent=dot(q,mv(g.G,k)).toFixed(3);document.getElementById('matrix').textContent='Relative homography Hᵢ Hⱼ⁻¹\n'+g.G.map(r=>'[ '+r.map(v=>v.toFixed(3).padStart(7)).join('  ')+' ]').join('\n');
 for(const name of ['slant','distance','baseline']){document.getElementById(name).value=state[name];document.getElementById(name+'Val').textContent=name==='slant'?Math.round(state[name])+'°':state[name].toFixed(1)}
 present();window.lastGeometry=g;
}
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let wantedAnimation=!motionPreference.matches, visible=false, frameRequest=0, phase=Math.asin(state.slant/45);
function controlsPlaying(){document.getElementById('animate').setAttribute('aria-pressed',String(state.playing));document.getElementById('animate').textContent=state.playing?'Pause animation':'Animate slant'}
function stop(manual=true){if(manual)wantedAnimation=false;state.playing=false;cancelAnimationFrame(frameRequest);controlsPlaying()}
function start(){if(state.playing||!visible||document.hidden||!wantedAnimation)return;state.playing=true;controlsPlaying();let previous=performance.now();function tick(now){if(!state.playing)return;phase+=(now-previous)/2600;previous=now;state.slant=45*Math.sin(phase);draw();frameRequest=requestAnimationFrame(tick)}frameRequest=requestAnimationFrame(tick)}
for(const name of ['slant','distance','baseline'])document.getElementById(name).addEventListener('input',e=>{stop();state[name]=Number(e.target.value);phase=Math.asin(Math.max(-1,Math.min(1,state.slant/45)));draw()});
function mode(on){state.plane=on;document.getElementById('planeMode').setAttribute('aria-pressed',String(on));document.getElementById('pointMode').setAttribute('aria-pressed',String(!on));draw()}
document.getElementById('planeMode').onclick=()=>mode(true);document.getElementById('pointMode').onclick=()=>mode(false);
document.getElementById('reset').onclick=()=>{stop();Object.assign(state,{slant:25,distance:3,baseline:2.4});phase=Math.asin(25/45);mode(true)};
document.getElementById('animate').onclick=()=>{if(state.playing){stop();return}wantedAnimation=true;start()};
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)start();else stop(false)},{threshold:.1}).observe(displayCanvas);
document.addEventListener('visibilitychange',()=>document.hidden?stop(false):start());
motionPreference.addEventListener('change',e=>{wantedAnimation=!e.matches;if(e.matches)stop(false);else start()});
window.renderAt=t=>{stop();state.plane=true;state.slant=42*Math.sin(t*.75);draw()};
window.setDemoState=s=>{stop();Object.assign(state,s);draw()};
window.demoMath={geometry,mv,mm,inv,dot};
const embedded=new URLSearchParams(location.search).has('embed');
if(embedded)document.body.classList.add('embed');
let lastHeight=0;
function reportHeight(){if(!embedded)return;const height=Math.ceil(document.querySelector('main').getBoundingClientRect().height)+2;if(height!==lastHeight){lastHeight=height;parent.postMessage({type:'hrope-demo-height',height},location.protocol==='file:'?'*':location.origin)}}
new ResizeObserver(()=>{draw();reportHeight()}).observe(document.querySelector('main'));
window.addEventListener('resize',()=>{draw();reportHeight()});draw();reportHeight();
