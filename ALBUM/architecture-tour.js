(() => {
  const figure = document.querySelector('.architecture-tour');
  if (!figure) return;
  const canvas = figure.querySelector('canvas');
  const title = figure.querySelector('.arch-title');
  const copy = figure.querySelector('.arch-copy');
  const play = figure.querySelector('.arch-play');
  const range = figure.querySelector('input[type=range]');
  const stops = [...figure.querySelectorAll('[data-station]')];
  const assets = {};
  const names = ['view-1','view-2','view-3','outline-1','outline-2','outline-3',
    'library-armchair','library-round-table','library-vase','library-coffee-table',
    'portrait','turn','room-empty','room-placed','placed-mask',
    'canonical-020','canonical-140','canonical-260'];
  const ready = Promise.all(names.map(async name => {
    const image = new Image();
    image.src = new URL('assets/paper-table/'+name+'.webp', document.baseURI);
    await image.decode();
    assets[name] = image;
  }));
  const duration = 33;
  const stages = [
    {from:0,at:3.7,title:'Specify the target with a point',text:'A point in one input view specifies the wooden coffee table in front of the sofa. The other views provide additional evidence about the same instance.'},
    {from:5.8,at:9.6,title:'Encode the target across views',text:'The multiview encoder aggregates SAM appearance features and Depth Anything 3 geometric features into instance tokens. Both decoders attend to these tokens.'},
    {from:11.1,at:18.3,title:'Match the target to a library asset',text:'DINOv3 encodes canonical renders of each candidate. A shared matcher compares the reference tokens with the target’s instance tokens and selects the highest-scoring asset.'},
    {from:19.5,at:25.6,title:'Estimate the selected asset’s 7-DoF layout',text:'Three orthographic RGB views show the selected asset at azimuths of 20°, 140°, and 260°, each at 30° elevation. Their surface-position and viewing-direction maps encode its canonical geometry. The layout decoder uses this geometry and the shared instance tokens to predict translation, rotation, and uniform scale.'},
    {from:26.8,at:32.4,title:'Place the asset in the shared scene frame',text:'The predicted transform maps the canonical mesh into the camera frame of the first input image. Here it places the retrieved coffee table in front of the sofa.'}
  ];
  const clamp=(x,lo=0,hi=1)=>Math.min(hi,Math.max(lo,x));
  const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
  const ramp=(t,a,b)=>smooth((t-a)/(b-a));
  const mix=(a,b,u)=>a+(b-a)*u;
  const colors={ink:'#242a30',sub:'#58636c',line:'#657783',memory:'#7296a4',match:'#594c6d',layout:'#435c65',peach:'#e1c9b6',gold:'#b66e23'};
  const stage=t=>Math.max(0,stages.findLastIndex(s=>t>=s.from));
  const label=(c,s,x,y,size=17,weight=500,color=colors.ink,align='center')=>{
    c.save();c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;
    c.font=weight+' '+size+'px "Helvetica Neue",Helvetica,Arial,sans-serif';c.fillText(s,x,y);c.restore();
  };
  function layer(c,opacity,draw){
    if(opacity<=0)return;
    c.save();c.globalAlpha*=clamp(opacity);draw();c.restore();
  }
  function round(c,x,y,w,h,r,fill,stroke){
    c.beginPath();c.roundRect(x,y,w,h,r);
    if(fill){c.fillStyle=fill;c.fill();}if(stroke){c.strokeStyle=stroke;c.lineWidth=1.3;c.stroke();}
  }
  function tile(c,x,y,w,h,fill,lines,alpha){
    layer(c,alpha,()=>{
      const rise=(1-alpha)*11;
      round(c,x,y+rise,w,h,12,fill);
      const light=fill===colors.match||fill===colors.layout;
      lines.forEach((line,j)=>label(c,line,x+w/2,y+h/2+rise+(j-(lines.length-1)/2)*23,18,560,light?'#fff':colors.ink));
    });
  }
  const glintSurface=document.createElement('canvas');
  const glintContext=glintSurface.getContext('2d');
  // Tint only the asset's alpha matte. The moving band never touches the card or photograph.
  function glint(c,image,x,y,w,h,phase,source){
    if(!(phase>0 && phase<1))return;
    const scale=Math.min(1.6,640/Math.max(w,h));
    const pw=Math.ceil(w*scale),ph=Math.ceil(h*scale);
    const g=glintContext;
    if(glintSurface.width!==pw || glintSurface.height!==ph){glintSurface.width=pw;glintSurface.height=ph;}
    g.clearRect(0,0,pw,ph);
    if(source)g.drawImage(image,...source,0,0,pw,ph);
    else g.drawImage(image,0,0,pw,ph);
    const span=pw*.48, center=mix(-span,pw+span,phase);
    const band=g.createLinearGradient(center-span,ph*.36,center+span,ph*.64);
    band.addColorStop(0,'rgba(255,255,255,.58)');band.addColorStop(.5,'white');band.addColorStop(1,'rgba(255,255,255,.58)');
    g.globalCompositeOperation='source-in';g.fillStyle=band;g.fillRect(0,0,pw,ph);g.globalCompositeOperation='source-over';
    layer(c,ramp(phase,0,.27)*(1-ramp(phase,.38,1)),()=>{
      c.shadowColor='rgba(255,255,255,.9)';c.shadowBlur=4;c.drawImage(glintSurface,x,y,w,h);
    });
  }
  const scanPhase=(t,i)=>(t-(11.92+i*.51))/.72;
  function photo(c,index,x,y,w,highlight=0,click=0,phase=0){
    const h=w*.75;
    c.save();round(c,x,y,w,h,Math.min(10,w*.035));c.clip();c.drawImage(assets['view-'+index],x,y,w,h);
    layer(c,highlight,()=>c.drawImage(assets['outline-'+index],x,y,w,h));
    glint(c,assets['outline-'+index],x,y,w,h,phase);
    if(click>0){
      // Native ellipse center in the PowerPoint picture's own coordinates.
      const cx=x+w*.4928,cy=y+h*.3840,rad=Math.max(4,w*.012);
      layer(c,click,()=>{
        c.beginPath();c.arc(cx,cy,rad,0,2*Math.PI);c.fillStyle='#da443a';c.fill();c.strokeStyle='white';c.lineWidth=Math.max(1.5,rad*.28);c.stroke();
      });
    }
    c.restore();
  }
  // Follow the actual polyline length so the head turns corners with its shaft.
  function wire(c,points,progress,color=colors.line){
    if(progress<=0)return;
    const lengths=points.slice(1).map((v,i)=>Math.hypot(v[0]-points[i][0],v[1]-points[i][1]));
    const distance=lengths.reduce((a,b)=>a+b,0)*clamp(progress);
    if(!distance)return;
    let left=distance,tip=points[0],heading=0;
    c.save();c.beginPath();c.moveTo(...tip);c.lineWidth=2.7;c.lineJoin='round';c.lineCap='round';c.strokeStyle=color;
    for(let i=0;i<lengths.length && left>0;i++){
      if(!lengths[i])continue;
      const u=Math.min(1,left/lengths[i]);tip=[mix(points[i][0],points[i+1][0],u),mix(points[i][1],points[i+1][1],u)];
      heading=Math.atan2(points[i+1][1]-points[i][1],points[i+1][0]-points[i][0]);
      c.lineTo(...tip);left-=lengths[i];
    }
    c.stroke();c.translate(...tip);c.rotate(heading);
    const head=Math.min(10,distance);
    c.beginPath();c.moveTo(0,0);c.lineTo(-head,-head*.53);c.lineTo(-head*.73,0);c.lineTo(-head,head*.53);c.closePath();c.fillStyle=color;c.fill();c.restore();
  }
  function tokens(c,x,y,n,p,color,w=22){
    for(let i=0;i<n;i++){
      const u=clamp(p*(n+1)-i);
      layer(c,u,()=>round(c,x+i*(w+6),y+(1-u)*8,w,w,5,color));
    }
  }
  function portrait(c,cx,cy,width,turn,phase=0){
    const h=width*.75,atlas=assets.turn;
    const frame=clamp(turn)*48, i=Math.floor(frame);
    const rect=k=>[(k%7)*384,Math.floor(k/7)*288,384,288];
    const dest=[cx-width/2,cy-h/2,width,h];
    const show=k=>c.drawImage(atlas,...rect(k),...dest);
    if(turn<=.005){c.drawImage(assets.portrait,...dest);glint(c,assets.portrait,...dest,phase);return;}
    show(i);
    if(i<48)layer(c,frame-i,()=>show(i+1));
    glint(c,atlas,...dest,phase,rect(Math.round(frame)));
  }
  function reference(c,id,x,y,w,h,phase){
    const im=assets['library-'+id], ratio=Math.min(w/im.width,h/im.height);
    const dest=[x+(w-im.width*ratio)/2,y+(h-im.height*ratio)/2,im.width*ratio,im.height*ratio];
    c.drawImage(im,...dest);glint(c,im,...dest,phase);
  }
  function observed(c,t){
    const encode=ramp(t,4.2,6.6),next=ramp(t,10.3,11.8);
    layer(c,1-next,()=>{
      const photos=[[65,75,554],[686,55,254],[773,269,254]];
      photos.forEach(([x,y,w],i)=>{
        const start=[0,1.7,2.5][i],on=i?ramp(t,start,start+.9):1;
        layer(c,on,()=>{
          const left=mix(x+(1-on)*42,58,encode),top=mix(y,22+i*168,encode),width=mix(w,205,encode);
          photo(c,i+1,left,top,width,ramp(t,1.05+i*.84,1.7+i*.84),i===0?ramp(t,.62,.90):0,(t-1.15-i*.84)/.8);
          if(i===0 && t>.63 && t<1.6){
            const p=(t-.63)/.97;layer(c,1-p,()=>{c.strokeStyle='#fff';c.lineWidth=3;c.beginPath();
              c.arc(left+width*.4928,top+.75*width*.384,width*(.013+.064*p),0,Math.PI*2);c.stroke();});
          }
        });
      });
      layer(c,(1-encode)*ramp(t,.25,.8),()=>label(c,'ScanNet++  /  observed views',65,518,17,500,colors.sub,'left'));
      for(let i=0;i<3;i++)wire(c,[[271,99+168*i],[321,99+168*i],[321,266],[386,266]],ramp(t,5.65+i*.29,6.95+i*.29));
      tile(c,390,209,212,114,colors.peach,['Multiview','encoder'],ramp(t,6.5,7.45));
      wire(c,[[603,266],[733,266]],ramp(t,7.5,8.5),colors.memory);
    });
  }
  function shared(c,t){
    const shift=ramp(t,10,12.15),layout=ramp(t,18.7,20.2),out=ramp(t,25.85,27.55);
    const x=mix(753,mix(175,115,layout),shift),y=mix(254,435,shift);
    layer(c,(1-out)*ramp(t,8.05,8.5),()=>{
      tokens(c,x,y,5,ramp(t,8.05,9.72),colors.memory,24);
      label(c,'Shared instance tokens',x+72,y+52,17,540,colors.sub);
    });
  }
  const refs=['armchair','round-table','vase','coffee-table'];
  // A bracket groups the candidate renders; DINOv3 still encodes each one.
  function libraryInlet(c,t,first,spacing,top,rail,inletX,tipY){
    const last=first+(refs.length-1)*spacing;
    const radius=5, start=12.04, stagger=.49;
    c.save();
    c.lineCap='round';c.lineJoin='round';c.lineWidth=1.65;c.strokeStyle='#796b83';
    refs.forEach((_,i)=>{
      const p=ramp(t,start+i*stagger,start+i*stagger+.37);
      if(!p)return;
      const x=first+i*spacing, side=i===0?1:i===refs.length-1?-1:0;
      c.beginPath();c.moveTo(x,top);
      if(side){
        const corner=rail-radius;
        const length=corner-top+Math.PI*radius/2;
        c.setLineDash([p*length,spacing*4]);
        c.lineTo(x,corner);c.arcTo(x,rail,x+side*radius,rail,radius);
      }else{
        c.lineTo(x,mix(top,rail,p));
      }
      c.stroke();c.setLineDash([]);
    });
    const span=ramp(t,start+.35,start+3*stagger+.36);
    if(span){
      c.beginPath();c.moveTo(first+radius,rail);
      c.lineTo(mix(first+radius,last-radius,span),rail);c.stroke();
    }
    const flow=ramp(t,13.88,14.24);
    if(flow){
      const y=mix(rail,tipY,flow),head=3.3*ramp(t,14.02,14.24);
      c.strokeStyle=colors.match;c.beginPath();c.moveTo(inletX,rail);c.lineTo(inletX,y);
      if(head){c.moveTo(inletX-head,y-head);c.lineTo(inletX,y);c.lineTo(inletX+head,y-head);}
      c.stroke();
    }
    c.restore();
  }
  function matching(c,t){
    const out=ramp(t,18.7,20.3);
    layer(c,(1-out)*ramp(t,10.75,11.25),()=>{
      label(c,'Asset library',61,67,22,580,colors.ink,'left');
      refs.forEach((id,i)=>{
        const p=ramp(t,10.95+i*.27,11.85+i*.27);
        layer(c,p,()=>{
          const x=61+101*i, y=95+(1-p)*17;
          const winner=i===3?ramp(t,16.35,17.4):0;
          round(c,x,y,92,91,9,winner?'#f9e8cb':'#eeedf0',winner?'#c5863f':null);
          reference(c,id,x+7,y+11,78,68,scanPhase(t,i));
        });
      });
      const inletX=258.5;
      libraryInlet(c,t,107,101,190,203,inletX,225);
      tile(c,inletX-66,229,132,47,'#e6e1eb',['DINOv3'],ramp(t,12.48,13.16));
      wire(c,[[inletX,280],[inletX,310],[315,310]],ramp(t,14.23,14.80),colors.match);
      tokens(c,326,300,4,ramp(t,14.46,15.13),'#9f90b1',19);
      wire(c,[[429,310],[496,310]],ramp(t,14.95,15.48),colors.match);
      wire(c,[[333,447],[475,447],[475,356],[500,356]],ramp(t,14.5,15.52),colors.memory);
      tile(c,503,262,197,126,colors.match,['Instance cross-','attention decoder'],ramp(t,14.65,15.63));
      wire(c,[[705,321],[768,321]],ramp(t,15.8,16.9),colors.match);
    });
  }
  function canonicalViews(c,t,x,y,width,height,gap){
    // One display window for all three 256-square inputs preserves their
    // relative size and the projected position of the training-frame origin.
    const sourceRect=[38,54,180,136];
    [20,140,260].forEach((angle,i)=>{
      const left=x+(width+gap)*i;
      layer(c,ramp(t,19.2+i*.30,20.12+i*.30),()=>{
        round(c,left,y,width,height,8,'#eeece8');
        const image=assets['canonical-'+String(angle).padStart(3,'0')];
        const scale=Math.min((width-8)/sourceRect[2],(height-21)/sourceRect[3]);
        const w=scale*sourceRect[2],h=scale*sourceRect[3],dx=left+(width-w)/2,dy=y+(height-17-h)/2;
        c.drawImage(image,...sourceRect,dx,dy,w,h);
        glint(c,image,dx,dy,w,h,(t-20.02-i*.38)/.68,sourceRect);
        label(c,angle+'°',left+width/2,y+height-10,12,540,colors.sub);
      });
    });
  }
  function layout(c,t){
    const arrive=ramp(t,19.12,20.3),out=1-ramp(t,26,27.55);
    layer(c,arrive*out,()=>{
      label(c,'Selected reference',64,75,21,570,colors.ink,'left');
      canonicalViews(c,t,62,101,92,91,7);
      layer(c,ramp(t,20.3,21),()=>label(c,'Canonical geometry + layout queries',62,212,16,500,colors.sub,'left'));
      wire(c,[[217,228],[217,277],[417,277]],ramp(t,20.55,21.73),colors.match);
      wire(c,[[269,447],[367,447],[367,337],[417,337]],ramp(t,20.9,22.02),colors.memory);
      tile(c,422,245,195,116,colors.layout,['Layout cross-','attention decoder'],ramp(t,21.45,22.4));
      for(let i=0;i<3;i++){
        const at=22.6+i*.83,y=245+56*i;
        wire(c,[[620,303],[640,303],[640,y],[659,y]],ramp(t,at,at+.76),colors.layout);
        layer(c,ramp(t,at+.2,at+.8),()=>{round(c,663,y-16,105,32,7,'#e0e7e8');label(c,['Translation','Uniform scale','Rotation'][i],715,y,15,570);});
      }
    });
  }
  function placement(c,t){
    const roomIn=ramp(t,26.65,28.8),land=ramp(t,27.12,30.9),finish=ramp(t,30.55,31.7);
    const rx=505,ry=5,rw=561,rh=539;
    layer(c,roomIn,()=>c.drawImage(assets['room-empty'],rx,ry,rw,rh));
    layer(c,roomIn,()=>{
      photo(c,1,55,126,339,1,1);
      label(c,'Observed table',55,409,19,540,colors.sub,'left');
      wire(c,[[410,255],[477,255]],ramp(t,28.25,29.4),colors.memory);
    });
    const win=ramp(t,16.28,17.55);
    if(win>0){
      const fromX=61+3*101+46,fromY=140;
      const grow=ramp(t,16.32,18.08), pose=ramp(t,22.75,25.7);
      const x=mix(mix(fromX,902,grow)+13*pose,rx+rw*.4914,land);
      const y=mix(mix(fromY,288,grow)-15*pose,ry+rh*.557,land);
      const w=mix(mix(86,368,grow)*(1-.10*ramp(t,23.55,24.65)),rw*.225,land);
      layer(c,win*(1-finish),()=>portrait(c,x,y,w,clamp(.12*ramp(t,17.15,19.1)+.57*ramp(t,23.9,26.55)+.31*land),(t-17.45)/.85));
      layer(c,grow*(1-roomIn),()=>{
        label(c,'Coffee table',905,411,23,600);
        label(c,'ASE 00689',905,442,15,540,colors.sub);
      });
    }
    layer(c,finish,()=>c.drawImage(assets['room-placed'],rx,ry,rw,rh));
    glint(c,assets['placed-mask'],rx,ry,rw,rh,(t-31.61)/.94);
  }
  function drawWide(c,t){
    observed(c,t);shared(c,t);matching(c,t);layout(c,t);placement(c,t);
  }
  // On phones, the object occupies the top half and the active data flow builds beneath it.
  function drawSmall(c,t){
    const idx=stage(t);
    if(idx<2){
      const u=ramp(t,3.8,6.5);
      const w=mix(290,165,u);
      photo(c,1,18,24,w,ramp(t,1,1.65),ramp(t,.6,.9),(t-1.15)/.8);
      [1,2].forEach((i)=>layer(c,ramp(t,1+i*.7,2+i*.7),()=>photo(c,i+1,mix(245,204,u),18+(i-1)*82,100,1,0,(t-1.15-i*.84)/.8)));
      if(idx===1){
        wire(c,[[114,160],[114,185]],ramp(t,5.8,6.85));
        tile(c,22,194,152,61,colors.peach,['Multiview','encoder'],ramp(t,6.5,7.4));
        wire(c,[[177,225],[207,225]],ramp(t,7.5,8.5),colors.memory);
        tokens(c,218,217,5,ramp(t,8.05,9.72),colors.memory,13);
        layer(c,ramp(t,8.2,9),()=>label(c,'Instance tokens',262,254,13));
      }
    }else if(idx===2){
      refs.forEach((id,i)=>{
        layer(c,ramp(t,10.8+i*.3,11.7+i*.3),()=>reference(c,id,15+85*i,7,75,59,scanPhase(t,i)));
      });
      libraryInlet(c,t,52.5,85,69,81,74,100);
      tile(c,26,104,96,40,'#e6e1eb',['DINOv3'],ramp(t,12.48,13.16));
      wire(c,[[124,125],[153,125]],ramp(t,14.23,14.80));
      tile(c,158,101,182,48,colors.match,['Instance decoder'],ramp(t,14.3,15.4));
      tokens(c,28,168,5,1,colors.memory,13);
      wire(c,[[126,175],[170,175],[170,152]],ramp(t,14.5,15.6),colors.memory);
      wire(c,[[248,151],[248,170]],ramp(t,15.8,16.9),colors.match);
      layer(c,ramp(t,15.9,17.35),()=>portrait(c,244,219,170,.16*ramp(t,16.2,18.8),(t-17.45)/.85));
    }else if(idx===3){
      canonicalViews(c,t,20,6,98,83,13);
      tokens(c,27,105,5,1,colors.memory,13);label(c,'Instance tokens',75,132,13);
      wire(c,[[76,141],[76,153]],ramp(t,20.18,21.15),colors.memory);
      wire(c,[[180,92],[180,123],[143,123],[143,153]],ramp(t,20.65,21.78),colors.match);
      tile(c,20,156,152,54,colors.layout,['Layout','decoder'],ramp(t,19.4,21));
      ['Translation','Uniform scale','Rotation'].forEach((s,i)=>{
        const x=56+i*103,at=22.6+i*.83;
        wire(c,[[62+i*36,211],[62+i*36,219],[x,224],[x,232]],ramp(t,at,at+.76),colors.layout);
        layer(c,ramp(t,at+.2,at+.8),()=>label(c,s,x,246,16));
      });
    }else{
      c.drawImage(assets['room-empty'],49,3,273,262);
      layer(c,1-ramp(t,30.4,31.7),()=>portrait(c,mix(118,183,ramp(t,27,30.8)),mix(86,150,ramp(t,27,30.8)),mix(178,65,ramp(t,27,30.8)),ramp(t,27,30.8)));
      layer(c,ramp(t,30.4,31.7),()=>c.drawImage(assets['room-placed'],49,3,273,262));
      glint(c,assets['placed-mask'],49,3,273,262,(t-31.61)/.94);
    }
  }
  function drawMap(ctx,w,h,t){
    const small=w/h<1.6, sw=small?360:1120,sh=small?274:550;
    const scale=Math.min(w/sw,h/sh);
    ctx.save();ctx.translate((w-scale*sw)/2,(h-scale*sh)/2);ctx.scale(scale,scale);
    if(small)drawSmall(ctx,t);else drawWide(ctx,t);ctx.restore();
  }
  function drawFilm(target,t){
    const c=target.getContext('2d'),w=target.width,h=target.height;
    c.save();c.scale(w/1600,h/900);
    c.fillStyle='#fcfbf8';c.fillRect(0,0,1600,900);
    label(c,stages[stage(t)].title,71,72,45,570,colors.ink,'left');
    c.translate(0,119);drawMap(c,1600,740,t);c.restore();
  }
  window.albumArchitecture={ready, drawFilm};
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let time=0,requested=!reduce.matches,inside=false,last=0,raf=0,active=-1,started=false;
  function paint(){
    if(!started)return;
    const {width:w,height:h}=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);
    if(w<=0||h<=0)return;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);drawMap(ctx,w,h,time);
    range.value=time;range.setAttribute('aria-valuetext',stages[stage(time)].title);
    const index=stage(time);
    if(index!==active){active=index;title.textContent=stages[index].title;copy.textContent=stages[index].text;
      stops.forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));}
    play.textContent=requested && inside?'Pause':time>=duration?'Replay':'Play';
  }
  function tick(now){
    raf=0;
    if(!inside || document.hidden || document.querySelector('.method-detail').open){last=0;return;}
    if(requested){time=Math.min(duration,time+(last?Math.min((now-last)/1000,.12):0));if(time>=duration)requested=false;}
    last=now;paint();
    if(requested)raf=requestAnimationFrame(tick);
  }
  function update(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;paint();if(started&&inside&&!document.hidden&&requested)raf=requestAnimationFrame(tick);}
  stops.forEach((button,i)=>button.addEventListener('click',()=>{
    requested=!reduce.matches;time=requested?stages[i].from:stages[i].at;
    update();
  }));
  range.addEventListener('input',()=>{requested=false;time=Number(range.value);update();});
  let drag=null;
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,time,engaged:false};
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(!drag.engaged){
      if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){drag=null;return;}
      if(Math.abs(dx)<6)return;
      canvas.setPointerCapture(event.pointerId);drag.engaged=true;requested=false;
    }
    time=clamp(drag.time+duration*dx/canvas.clientWidth,0,duration);update();
  });
  for(const kind of ['pointerup','pointercancel','lostpointercapture','pointerleave']){
    canvas.addEventListener(kind,event=>{if(drag?.id===event.pointerId&&(kind!=='pointerleave'||!drag.engaged))drag=null;});
  }
  play.addEventListener('click',()=>{if(time>=duration)time=0;requested=!requested;update();});
  new IntersectionObserver(([e])=>{inside=e.isIntersecting;update();},{threshold:.1}).observe(canvas);
  new ResizeObserver(paint).observe(canvas);document.addEventListener('visibilitychange',update);
  reduce.addEventListener('change',()=>{requested=!reduce.matches;update();});
  const detail=document.querySelector('.method-detail');
  figure.querySelector('.arch-enlarge').addEventListener('click',()=>{detail.showModal();detail.querySelector('.method-detail-scroll').scrollLeft=0;});
  detail.addEventListener('close',update);
  detail.addEventListener('click',e=>{if(e.target===detail)detail.close();});
  ready.then(()=>{started=true;figure.classList.add('ready');update();}).catch(()=>{figure.querySelector('.arch-status').textContent='The architecture animation could not load.';});
})();
