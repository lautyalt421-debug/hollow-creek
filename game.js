/* game.js - Hollow Creek (1024)
   - Anim sprites auto-scale & baseline alignment
   - Night FSM difficulty table
   - Integrated CRT menu (New Game / Continue)
   - Audio gated by first user gesture
*/

/* ---------- core elements ---------- */
const CANVAS = document.getElementById('gameCanvas');
const ctx = CANVAS.getContext('2d');
ctx.imageSmoothingEnabled = false;

const W = CANVAS.width, H = CANVAS.height;
const UI = {
  night: document.getElementById('nightStat'),
  time: document.getElementById('timeStat'),
  power: document.getElementById('powerStat'),
  loading: document.getElementById('loading'),
  menuOverlay: document.getElementById('menuOverlay'),
  startOverlay: document.getElementById('startOverlay')
};

/* ---------- state ---------- */
let started = false;         // set true after menu New Game
let audioUnlocked = false;   // user gesture to allow audio
let inMenu = true;           // start in menu
let selectedMenu = 0;        // 0 = New Game, 1 = Continue
let monitorOpen = false;
let monitorSingle = null;
let night = 1, hour = 0, power = 100;
let cassidyActive = false;
let cassidyGlitch = { next:0, active:false, end:0 };
let doorLeftClosed = false, doorRightClosed = false;

const assets = { imgs:{}, audios:{} };

/* ---------- camera mapping ---------- */
const camKeyById = {
  1: 'cam1_salon_base',
  2: 'cam2_baby_base',
  3: 'cam3_mini_base',
  4: 'cam4_kitchen_base',
  5: 'cam5_bath_base',
  6: 'cam6_storage_base',
  7: 'office_base_closed'
};
const OFFICE_KEY = 'office_base_closed';
const OFFICE_OPEN_KEY = 'office_open';

/* ---------- anim definitions & runtime objects ---------- */
const animDefs = {
  vale:{allowed:[1,3,5], start:1, color:'#d9b300', baseInterval:25000, activeFrom:3},
  patch:{allowed:[1,2,4], start:1, color:'#6fb0ff', baseInterval:28000, activeFrom:2},
  lulla:{allowed:[1,3,4,5], start:1, color:'#ff7fa1', baseInterval:32000, activeFrom:1},
  rust:{allowed:[6], start:6, color:'#9b6e44', baseInterval:42000, activeFrom:5}
};
const anims = {};
Object.keys(animDefs).forEach(k=>{
  anims[k] = {
    name:k, cam:animDefs[k].start, lastMove:Date.now(), baseInterval:animDefs[k].baseInterval,
    inOffice:false, active:false, lastSeen:Date.now()
  };
});

/* ---------- assets lists ---------- */
const camKeys = Object.values(camKeyById);
const extrasToLoad = ['door_left_sprite','door_right_sprite','scanlines','cassidy_static','menu_crt','cursor_double'];
const animSpriteKeys = [
  'vale_idle','vale_walk','vale_watch','vale_jumpscare',
  'patch_idle','patch_walk','patch_watch','patch_jumpscare',
  'lulla_idle','lulla_walk','lulla_watch','lulla_jumpscare',
  'rust_idle','rust_walk','rust_watch','rust_jumpscare'
];

/* ---------- audio paths ---------- */
const AUDIO_PATHS = {
  amb_night_loop: 'audio/amb_night_loop.mp3',
  crt_static_loop: 'audio/crt_static_loop.mp3',
  crt_open: 'audio/crt_open.mp3',
  crt_close: 'audio/crt_close.mp3',
  door_open: 'audio/door_open.mp3',
  door_close: 'audio/door_close.mp3',
  step_heavy: 'audio/step_heavy.mp3',
  jumpscare_vale: 'audio/jumpscare_vale.mp3',
  jumpscare_patch: 'audio/jumpscare_patch.mp3',
  jumpscare_lulla: 'audio/jumpscare_lulla.mp3',
  jumpscare_rust: 'audio/jumpscare_rust.mp3',
  cassidy_static_hit: 'audio/cassidy_static_hit.mp3',
  phone_night1: 'audio/phone_night1.mp3',
  cam_switch: 'audio/cam_switch.mp3'
};

/* ---------- utility loaders (tries jpg then png) ---------- */
function tryPathsForImage(paths){
  return new Promise(resolve=>{
    (function t(i){
      if(i>=paths.length){ resolve(null); return; }
      const img = new Image();
      img.onload = ()=> resolve(img);
      img.onerror = ()=> t(i+1);
      img.src = paths[i];
    })(0);
  });
}

async function loadImageKey(key){
  const paths = [];
  if(camKeys.includes(key)){
    paths.push(`assets/cams/${key}.jpg`, `assets/cams/${key}.png`);
  } else if(extrasToLoad.includes(key) || key.startsWith('menu') || key.startsWith('cursor')){
    paths.push(`assets/${key}.png`, `assets/${key}.jpg`);
  } else if(animSpriteKeys.includes(key)){
    paths.push(`assets/animatronics/${key}.png`, `assets/animatronics/${key}.jpg`);
  } else {
    paths.push(`assets/${key}.png`, `assets/${key}.jpg`);
  }
  const img = await tryPathsForImage(paths);
  if(!img) console.warn('Missing image for key:', key, 'tried:', paths);
  return img;
}

function loadAudioKey(key, path){
  return new Promise(resolve=>{
    const a = new Audio();
    a.preload='auto';
    a.src = path;
    a.oncanplaythrough = ()=> resolve(a);
    a.onerror = ()=> { console.warn('Missing audio:', key, path); resolve(null); };
  });
}

/* ---------- preload (graceful) ---------- */
async function preloadAll(){
  UI.loading.style.display = 'block';
  // cams
  for(const id in camKeyById){
    const key = camKeyById[id];
    const img = await loadImageKey(key);
    if(img) assets.imgs[key] = img;
  }
  // office open
  const imgOfficeOpen = await loadImageKey(OFFICE_OPEN_KEY);
  if(imgOfficeOpen) assets.imgs[OFFICE_OPEN_KEY] = imgOfficeOpen;
  // extras
  for(const k of extrasToLoad){
    const img = await loadImageKey(k);
    if(img) assets.imgs[k] = img;
  }
  // anim sprites
  for(const k of animSpriteKeys){
    const img = await loadImageKey(k);
    if(img) assets.imgs[k] = img;
  }
  // audios
  for(const [k,p] of Object.entries(AUDIO_PATHS)){
    const a = await loadAudioKey(k,p);
    if(a) assets.audios[k] = a;
  }
  UI.loading.style.display = 'none';
  console.log('Assets loaded keys:', Object.keys(assets.imgs));
}

/* ---------- menu logic ---------- */
function showMenu(){ inMenu = true; UI.menuOverlay.classList.remove('overlay-hidden'); UI.startOverlay.classList.add('overlay-hidden'); renderMenuCursor(); }
function hideMenu(){ inMenu = false; UI.menuOverlay.classList.add('overlay-hidden'); UI.startOverlay.classList.add('overlay-hidden'); }
function renderMenuCursor(){
  // populate cursor elements (use image if exists)
  const cursorImg = assets.imgs['cursor_double'];
  const cNew = document.getElementById('cursorNew');
  const cCont = document.getElementById('cursorContinue');
  cNew.innerHTML = ''; cCont.innerHTML = '';
  if(cursorImg){
    const el = document.createElement('img'); el.src = cursorImg.src; el.style.width='28px'; el.style.height='22px';
    cNew.appendChild(el.cloneNode());
    cCont.appendChild(el.cloneNode());
  } else {
    cNew.innerText = (selectedMenu===0?'>>':'  ');
    cCont.innerText = (selectedMenu===1?'>>':'  ');
  }
}

/* handle menu touches */
document.getElementById('menuOverlay').addEventListener('click', (ev)=>{
  if(!audioUnlocked){ audioUnlocked = true; } // unlock audio on first interaction
  // locate row click
  const tgt = ev.target.closest('.menuRow');
  if(!tgt) return;
  const opt = tgt.dataset.option;
  if(opt === 'new'){ startNewGame(); }
  else if(opt === 'continue'){ startContinue(); }
});
function startNewGame(){
  hideMenu();
  started = true; night = 1; hour = 0; power = 100;
  beginGamePlay();
}
function startContinue(){
  // no persistent save yet — behave like New Game for now
  startNewGame();
}

/* ---------- game start / audio gating ---------- */
async function beginGamePlay(){
  await preloadAll();
  // try play ambience
  try{
    if(assets.audios.amb_night_loop){ assets.audios.amb_night_loop.loop=true; assets.audios.amb_night_loop.volume=0.12; assets.audios.amb_night_loop.play().catch(()=>{}); }
    if(assets.audios.crt_static_loop){ assets.audios.crt_static_loop.loop=true; assets.audios.crt_static_loop.volume=0.06; assets.audios.crt_static_loop.play().catch(()=>{}); }
  }catch(e){ console.warn('audio play failed', e); }
  // init anim flags
  Object.keys(anims).forEach(k=> anims[k].active = (night >= animDefs[k].activeFrom));
  cassidyActive = (night >= 4);
  // start hour ticker
  setInterval(()=>{
    if(!started) return;
    hour++;
    if(hour > 7){ night = Math.min(7, night+1); hour = 0; }
    power = Math.max(0, power - Math.floor(Math.random()*6));
    UI.night.innerText = 'Night: ' + night;
    UI.time.innerText = (hour===0?'12:00 AM':(hour + ':00 AM'));
    Object.keys(anims).forEach(k=> anims[k].active = (night >= animDefs[k].activeFrom));
    cassidyActive = (night >= 4);
  }, 90000);
  cassidyGlitch.next = Date.now() + 8000 + Math.random()*8000;
  requestAnimationFrame(loop);
}

/* ---------- baseline & scaling helpers ---------- */
const BASELINE_Y = Math.floor(H * 0.78); // where feet should land
function drawSpriteWithBaseline(img, desiredHeightPortion = 0.6){
  // desiredHeightPortion relative to canvas height for sprite display (default 60%)
  const targetH = Math.floor(H * desiredHeightPortion);
  const scale = targetH / img.naturalHeight;
  const drawW = Math.floor(img.naturalWidth * scale);
  const drawH = Math.floor(img.naturalHeight * scale);
  const drawX = Math.floor((W - drawW) / 2); // centered horizontally (can be offset by caller)
  const drawY = Math.floor(BASELINE_Y - drawH); // align feet to baseline
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  return { x: drawX, y: drawY, w: drawW, h: drawH };
}

/* ---------- drawing routines ---------- */
function drawPlaceholderRect(x,y,w,h,label){
  ctx.fillStyle = '#070707'; ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = '#2b2b2b'; ctx.strokeRect(x+2,y+2,w-4,h-4);
  ctx.fillStyle = '#9a9a9a'; ctx.font = '18px monospace'; ctx.fillText(label, x+12, y+26);
}

function drawOfficeView(){
  const officeImg = assets.imgs[OFFICE_KEY];
  if(officeImg) ctx.drawImage(officeImg, 0, 0, W, H);
  else {
    ctx.fillStyle = '#0b0b0b'; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = '#1c1c1c'; ctx.fillRect(W*0.22, H*0.55, W*0.56, H*0.14);
    ctx.fillStyle = '#bbb'; ctx.font = '20px monospace'; ctx.fillText('Office (missing office_base_closed)', 24, 34);
  }

  // doors sprites priority
  const leftImg = assets.imgs['door_left_sprite'];
  const rightImg = assets.imgs['door_right_sprite'];
  if(leftImg) ctx.drawImage(leftImg, 0, 0, W, H);
  else { ctx.fillStyle = doorLeftClosed ? '#4b3f2f' : '#0c0c0c'; ctx.fillRect(W*0.05, H*0.28, W*0.16, H*0.44); }
  if(rightImg) ctx.drawImage(rightImg, 0, 0, W, H);
  else { ctx.fillStyle = doorRightClosed ? '#4b3f2f' : '#0c0c0c'; ctx.fillRect(W*0.79, H*0.28, W*0.16, H*0.44); }

  // draw anims in office (use jumpscare sprite if exists scaled; otherwise silhouette)
  Object.values(anims).forEach(a=>{
    if(a.inOffice){
      const sprite = assets.imgs[a.name + '_jumpscare'];
      if(sprite){
        // place slightly left/right depending on name for variety
        const offX = (a.name==='vale' ? -40 : (a.name==='patch'? 10 : 0));
        const targetH = Math.floor(H*0.7);
        const scale = targetH / sprite.naturalHeight;
        const dw = Math.floor(sprite.naturalWidth * scale);
        const dh = Math.floor(sprite.naturalHeight * scale);
        const dx = Math.floor(W*0.46 + offX - dw/2);
        const dy = Math.floor(BASELINE_Y - dh);
        ctx.drawImage(sprite, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = a.color || '#fff';
        ctx.fillRect(W*0.44, H*0.45, W*0.12, H*0.28);
        ctx.fillStyle = '#000'; ctx.font = '18px monospace'; ctx.fillText(a.name.toUpperCase(), W*0.445, H*0.43);
      }
    }
  });
}

/* monitor grid / single (thumbnails use anim idle sprite if present) */
const thumbW = Math.floor(W*0.28), thumbH = Math.floor(H*0.22);
const camPositions = [
  {x: W*0.05, y: H*0.06, id:1},
  {x: W*0.37, y: H*0.06, id:2},
  {x: W*0.69, y: H*0.06, id:3},
  {x: W*0.05, y: H*0.33, id:4},
  {x: W*0.37, y: H*0.33, id:5},
  {x: W*0.69, y: H*0.33, id:6},
  {x: W*0.37, y: H*0.60, id:7}
];

function drawMonitorGrid(){
  ctx.fillStyle = '#000'; ctx.fillRect(0,0,W,H);
  camPositions.forEach(p=>{
    const rx = Math.floor(p.x), ry = Math.floor(p.y);
    const key = (p.id === 7 ? OFFICE_KEY : camKeyById[p.id]);
    const img = assets.imgs[key];
    if(img) ctx.drawImage(img, rx, ry, thumbW, thumbH);
    else drawPlaceholderRect(rx, ry, thumbW, thumbH, 'CAM ' + p.id);

    // draw anim indicator or small idle sprite
    Object.values(anims).forEach(a=>{
      if(a.active && !a.inOffice && a.cam === p.id){
        const sprite = assets.imgs[a.name + '_idle'];
        if(sprite){
          // draw small scaled sprite bottom-right of thumb
          const scale = (thumbH * 0.6) / sprite.naturalHeight;
          const dw = Math.floor(sprite.naturalWidth * scale), dh = Math.floor(sprite.naturalHeight * scale);
          const sx = rx + thumbW - dw - 6, sy = ry + thumbH - dh - 6;
          ctx.drawImage(sprite, sx, sy, dw, dh);
        } else {
          ctx.beginPath();
          ctx.fillStyle = a.color || '#f00';
          ctx.arc(rx + thumbW - 22, ry + 22, 10, 0, Math.PI*2); ctx.fill();
        }
      }
    });
    ctx.fillStyle = '#ccc'; ctx.font = '14px monospace'; ctx.fillText('CAM ' + p.id, rx + 8, ry + 18);
  });
}

function drawSingleCam(id){
  const key = (id === 7 ? OFFICE_KEY : camKeyById[id]);
  const img = assets.imgs[key];
  if(img) ctx.drawImage(img, 0, 0, W, H);
  else drawPlaceholderRect(0,0,W,H,'CAM ' + id + ' (missing)');

  // draw anims present as full sprite if available
  Object.values(anims).forEach(a=>{
    if(a.active && !a.inOffice && a.cam === id){
      const sprite = assets.imgs[a.name + '_idle'];
      if(sprite){
        // draw with baseline alignment at right area
        const targetH = Math.floor(H * 0.6);
        const scale = targetH / sprite.naturalHeight;
        const dw = Math.floor(sprite.naturalWidth * scale), dh = Math.floor(sprite.naturalHeight * scale);
        const px = Math.floor(W*0.65 - dw/2), py = Math.floor(BASELINE_Y - dh);
        ctx.drawImage(sprite, px, py, dw, dh);
      } else {
        ctx.fillStyle = a.color || '#fff';
        ctx.fillRect(W*0.62, H*0.38, W*0.08, H*0.22);
        ctx.fillStyle='#000'; ctx.font='16px monospace'; ctx.fillText(a.name, W*0.62+4, H*0.36);
      }
    }
  });
}

/* scanlines (very subtle) */
function drawScanlines(){
  const sl = assets.imgs['scanlines'];
  if(sl){
    ctx.globalAlpha = 0.06;
    ctx.drawImage(sl, 0, 0, W, H);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.save();
  ctx.globalAlpha = 0.03;
  ctx.fillStyle = '#000';
  for(let y=2;y<H;y+=2) ctx.fillRect(0,y,W,1);
  ctx.restore();
}

/* cassidy overlay */
function updateCassidy(now){
  if(!cassidyActive) return;
  if(now > cassidyGlitch.next && !cassidyGlitch.active){
    cassidyGlitch.active = true;
    cassidyGlitch.end = now + (1000 + Math.random()*1400);
    cassidyGlitch.next = now + (8000 + Math.random()*15000);
  }
  if(cassidyGlitch.active && now > cassidyGlitch.end) cassidyGlitch.active = false;
}
function drawCassidyOverlay(){
  if(!cassidyActive) return;
  const img = assets.imgs['cassidy_static'];
  if(cassidyGlitch.active && img){
    ctx.globalAlpha = 0.45;
    ctx.drawImage(img, 0, 0, W, H);
    ctx.globalAlpha = 1;
    if(assets.audios.cassidy_static_hit) try{ assets.audios.cassidy_static_hit.currentTime=0, assets.audios.cassidy_static_hit.play(); }catch(e){}
  } else if(cassidyGlitch.active){
    ctx.fillStyle = 'rgba(255,255,255,0.015)'; for(let i=0;i<140;i++) ctx.fillRect(Math.random()*W, Math.random()*H, 1, 1);
  }
}

/* ---------- difficulty table per night ---------- */
const NIGHT_SPEED = {
  1: 1.6, // slow (bigger interval multiplier)
  2: 1.25,
  3: 1.0,
  4: 0.95,
  5: 0.85,
  6: 0.6,
  7: 0.5
};

/* ---------- AI movement + entry rules ---------- */
function updateAI(now){
  Object.values(anims).forEach(a=>{
    a.active = (night >= animDefs[a.name].activeFrom);
    if(!a.active) return;
    if(a.inOffice) return;
    const interval = Math.max(700, a.baseInterval * (NIGHT_SPEED[night] || 1.0));
    if(now - a.lastMove > interval){
      const arr = animDefs[a.name].allowed;
      a.cam = arr[Math.floor(Math.random()*arr.length)];
      a.lastMove = now;
      a.lastSeen = now;
      if(assets.audios.step_heavy) try{ assets.audios.step_heavy.currentTime=0, assets.audios.step_heavy.play(); }catch(e){}
    }
    if(monitorOpen){
      if(monitorSingle === null) a.lastSeen = now;
      else if(a.cam === monitorSingle) a.lastSeen = now;
    }
    // Rust: if unseen long, go to office
    if(a.name === 'rust'){
      if(now - a.lastSeen > 30000 && !a.inOffice){ a.inOffice = true; triggerEntry(a.name); }
    }
    // entry rules per your earlier design (examples)
    if(a.name === 'vale' && a.cam === 3 && !doorRightClosed){ a.inOffice = true; triggerEntry('vale'); }
    if(a.name === 'patch' && a.cam === 6 && !doorLeftClosed){ a.inOffice = true; triggerEntry('patch'); }
    if(a.name === 'lulla' && a.cam === 3 && !doorRightClosed){
      if(now - a.lastMove < interval * 0.45){ a.inOffice = true; triggerEntry('lulla'); }
    }
  });
}

function triggerEntry(name){
  console.log('ENTRY:', name);
  const sKey = 'jumpscare_' + name;
  if(assets.audios[sKey]) try{ assets.audios[sKey].currentTime=0, assets.audios[sKey].play(); }catch(e){}
  setTimeout(()=>{ if(anims[name]) { anims[name].inOffice = false; anims[name].lastMove = Date.now(); } }, 2200);
}

/* ---------- main loop ---------- */
function loop(ts){
  ctx.clearRect(0,0,W,H);

  if(inMenu){
    // dimmed background showing office (if available) while menu is open
    const bImg = assets.imgs[OFFICE_KEY];
    if(bImg){ ctx.globalAlpha = 0.22; ctx.drawImage(bImg, 0, 0, W, H); ctx.globalAlpha = 1; }
    // keep menu visible via DOM
  } else {
    if(!monitorOpen) drawOfficeView();
    else { if(monitorSingle !== null) drawSingleCam(monitorSingle); else drawMonitorGrid(); }
  }

  updateAI(Date.now());
  updateCassidy(Date.now());
  drawCassidyOverlay();
  drawScanlines();

  // hud
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(8,8,260,64);
  ctx.fillStyle = '#ddd'; ctx.font = '18px monospace'; ctx.fillText('Night: ' + night, 16, 30);
  ctx.fillText((hour===0?'12:00 AM':(hour + ':00 AM')), 16, 54);

  requestAnimationFrame(loop);
}

/* ---------- input handling (menu + gameplay) ---------- */
function getCanvasCoords(clientX, clientY){
  const rect = CANVAS.getBoundingClientRect();
  const scaleX = CANVAS.width / rect.width;
  const scaleY = CANVAS.height / rect.height;
  return { x: Math.floor((clientX - rect.left) * scaleX), y: Math.floor((clientY - rect.top) * scaleY) };
}

function handleTap(x,y){
  if(inMenu){
    // tap opens menu DOM if not shown; menu DOM handles option clicks
    if(!audioUnlocked){ audioUnlocked = true; } // allow audio on first touch
    UI.menuOverlay.classList.remove('overlay-hidden');
    UI.startOverlay.classList.add('overlay-hidden');
    renderMenuCursor();
    return;
  }
  if(!started){ // if not started (menu suppressed), start new game
    startNewFromGesture();
    return;
  }
  if(y > H * 0.80){
    monitorOpen = !monitorOpen;
    if(monitorOpen){ if(assets.audios.crt_open) try{ assets.audios.crt_open.currentTime=0, assets.audios.crt_open.play(); }catch(e){} }
    else { if(assets.audios.crt_close) try{ assets.audios.crt_close.currentTime=0, assets.audios.crt_close.play(); }catch(e){} monitorSingle=null; }
    return;
  }
  if(monitorOpen){
    for(const p of camPositions){
      const rx = Math.floor(p.x), ry = Math.floor(p.y);
      if(x >= rx && x <= rx + thumbW && y >= ry && y <= ry + thumbH){
        monitorSingle = p.id;
        if(assets.audios.cam_switch) try{ assets.audios.cam_switch.currentTime=0, assets.audios.cam_switch.play(); }catch(e){}
        return;
      }
    }
    monitorSingle = null;
    return;
  }
  // doors toggle
  if(x < W*0.5){
    doorLeftClosed = !doorLeftClosed;
    if(doorLeftClosed){ if(assets.audios.door_close) try{ assets.audios.door_close.currentTime=0, assets.audios.door_close.play(); }catch(e){} }
    else { if(assets.audios.door_open) try{ assets.audios.door_open.currentTime=0, assets.audios.door_open.play(); }catch(e){} }
  } else {
    doorRightClosed = !doorRightClosed;
    if(doorRightClosed){ if(assets.audios.door_close) try{ assets.audios.door_close.currentTime=0, assets.audios.door_close.play(); }catch(e){} }
    else { if(assets.audios.d
