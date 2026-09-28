(function(){
  'use strict';
  const MM_PER_INCH = 25.4;
  const PAPER_SIZES = [
    { id:'a4p', label:'A4 (Portrait)', wMm:210, hMm:297 },
    { id:'a4l', label:'A4 (Landscape)', wMm:297, hMm:210 },
    { id:'a3p', label:'A3 (Portrait)', wMm:297, hMm:420 },
    { id:'letter', label:'Letter (8.5×11 in)', wMm:215.9, hMm:279.4 },
    { id:'legal', label:'Legal (8.5×14 in)', wMm:215.9, hMm:355.6 },
    { id:'4x6', label:'4×6 in', wMm:101.6, hMm:152.4 },
    { id:'5x7', label:'5×7 in', wMm:127, hMm:177.8 },
    { id:'8x10', label:'8×10 in', wMm:203.2, hMm:254 },
    { id:'11x14', label:'11×14 in', wMm:279.4, hMm:355.6 }
  ];
  const CUSTOM_PAPER_KEY = 'polaroid_custom_papers';
  const BUILTIN_TEMPLATES = [{
    id:'classic_3x3', label:'Classic Polaroid (3×3 on A4)', paperId:'a4p',
    outerW:65, outerH:95, innerW:55, innerH:75, offsetX:5, offsetY:5,
    frames:[
      {x:5,y:4},{x:72.5,y:4},{x:140,y:4},
      {x:5,y:101},{x:72.5,y:101},{x:140,y:101},
      {x:5,y:198},{x:72.5,y:198},{x:140,y:198}
    ]
  }];
  const STORAGE_KEY = 'polaroid_custom_templates';
  const LABEL_FONT_PT = 10;
  const PT_TO_MM = 0.3527777778;
  const LABEL_FONT_MM = LABEL_FONT_PT * PT_TO_MM;
  const DB_NAME = 'polaroid_generator';
  const DB_VERSION = 1;
  let db = null, persistenceEnabled = true;
  const elements = {
    fileInput: document.getElementById('fileInput'), previewBtn: document.getElementById('previewBtn'), clearBtn: document.getElementById('clearBtn'),
    countText: document.getElementById('countText'), status: document.getElementById('status'), batchesList: document.getElementById('batchesList'),
    modal: document.getElementById('previewModal'), modalBackdrop: document.querySelector('#previewModal .modal-backdrop'),
    modalCloseBtn: document.getElementById('previewCloseBtn'), modalFooterCloseBtn: document.getElementById('previewFooterCloseBtn'),
    modalDownloadBtn: document.getElementById('modalDownloadBtn'), modalPsdBtn: document.getElementById('modalPsdBtn'),
    modalDocxBtn: document.getElementById('modalDocxBtn'), modalPrintBtn: document.getElementById('modalPrintBtn'), previewContainer: document.getElementById('previewContainer'),
    ownerModal: document.getElementById('ownerModal'), ownerBackdrop: document.querySelector('#ownerModal .modal-backdrop'),
    ownerCloseBtn: document.getElementById('ownerCloseBtn'), ownerInput: document.getElementById('ownerInput'),
    ownerConfirmBtn: document.getElementById('modalConfirmBtn'), ownerCancelBtn: document.getElementById('modalCancelBtn'),
    modalCountText: document.getElementById('modalCountText'), themeToggle: document.getElementById('themeToggle'),
    qualitySelect: document.getElementById('qualitySelect'), templateSelect: document.getElementById('templateSelect'),
    previewZoom: document.getElementById('previewZoom'), previewZoomValue: document.getElementById('previewZoomValue'),
    layoutInfo: document.getElementById('layoutInfo')
  };
  const state = { groups: [], settings: { templateId: BUILTIN_TEMPLATES[0].id, qualityDpi: 600, theme: 'light', unit: 'in', captions: [] }, previewZoom: 1 };

  function uuid(){ return crypto.randomUUID?.() || 'xxxx-xxxx'.replace(/[xy]/g,c=>{let r=Math.random()*16|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);}); }
  function setStatus(msg){ if(elements.status) elements.status.textContent=msg; }
  function setCountText(){ let total=state.groups.reduce((s,g)=>s+g.items.length,0); elements.countText.textContent=total?`${total} image${total===1?'':'s'} ready`:'No images selected'; }
  function mmToPx(mm,scale){ return mm*scale; }
  function applyTheme(theme){ document.documentElement.setAttribute('data-theme',theme); elements.themeToggle.textContent=theme==='dark'?'Dark':'Light'; elements.themeToggle.setAttribute('aria-label',`Theme: ${theme}. Switch to ${theme==='dark'?'light':'dark'} theme`); localStorage.setItem('theme',theme); }

  function getCustomPapers(){ try{ return JSON.parse(localStorage.getItem(CUSTOM_PAPER_KEY))||[]; }catch(e){ return []; } }
  function saveCustomPapers(list){ localStorage.setItem(CUSTOM_PAPER_KEY, JSON.stringify(list)); }
  function findAllPapers(){ return [...PAPER_SIZES, ...getCustomPapers()]; }
  function findPaperById(id){ return findAllPapers().find(p=>p.id===id) || PAPER_SIZES[0]; }
  function paperNativeOrientation(paper){ return paper.wMm>paper.hMm ? 'landscape' : 'portrait'; }
  function orientedPaperDims(paper,orientation){ const long=Math.max(paper.wMm,paper.hMm), short=Math.min(paper.wMm,paper.hMm); return orientation==='landscape' ? {wMm:long,hMm:short} : {wMm:short,hMm:long}; }

  function migrateTemplate(t){
    if(t.frames && t.frames.length) return t.orientation ? t : {...t, orientation:paperNativeOrientation(findPaperById(t.paperId||'a4p'))};
    const cols=t.cols||3, rows=t.rows||3, gapX=t.gapX||2, gapY=t.gapY||2;
    const paper=findPaperById(t.paperId||'a4p');
    const orientation=t.orientation||paperNativeOrientation(paper);
    const dims=orientedPaperDims(paper,orientation);
    const gridW=cols*t.outerW+(cols-1)*gapX, gridH=rows*t.outerH+(rows-1)*gapY;
    const marginX=Math.max(0,(dims.wMm-gridW)/2), marginY=Math.max(0,(dims.hMm-gridH)/2);
    const frames=[];
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++) frames.push({x:marginX+c*(t.outerW+gapX), y:marginY+r*(t.outerH+gapY)});
    return { id:t.id, label:t.label, paperId:paper.id, orientation, outerW:t.outerW, outerH:t.outerH, innerW:t.innerW, innerH:t.innerH, offsetX:t.offsetX, offsetY:t.offsetY, frames };
  }
  function getCustomTemplates(){ try{ const raw=JSON.parse(localStorage.getItem(STORAGE_KEY))||[]; return raw.map(migrateTemplate); }catch(e){ return []; } }
  function saveCustomTemplates(list){ localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  function findAllTemplates(){ return [...BUILTIN_TEMPLATES, ...getCustomTemplates()]; }
  function findTemplate(){ let all=findAllTemplates(); return all.find(t=>t.id===state.settings.templateId) || all[0]; }
  function computeLayout(){ let t=findTemplate(), paper=findPaperById(t.paperId), dims=orientedPaperDims(paper,t.orientation||paperNativeOrientation(paper)); return { paperW:dims.wMm, paperH:dims.hMm, outerW:t.outerW, outerH:t.outerH, innerW:t.innerW, innerH:t.innerH, offsetX:t.offsetX, offsetY:t.offsetY, frames:t.frames, perPage:t.frames.length }; }
  function describeLayout(){ let t=findTemplate(), paper=findPaperById(t.paperId), dims=orientedPaperDims(paper,t.orientation||paperNativeOrientation(paper)); let dimsText=`${toDisplayUnit(dims.wMm).toFixed(2)}×${toDisplayUnit(dims.hMm).toFixed(2)} ${unitLabel()}`; return `${t.label} — ${paper.label} (${dimsText}) · ${t.frames.length} photo${t.frames.length===1?'':'s'}/page`; }
  function updateLayoutInfo(){ elements.layoutInfo.textContent=describeLayout(); renderCaptions(); }

  async function openDb(){ return new Promise((res,rej)=>{ let req=indexedDB.open(DB_NAME,DB_VERSION); req.onupgradeneeded=()=>{ let db=req.result; if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'}); if(!db.objectStoreNames.contains('images')) db.createObjectStore('images',{keyPath:'id'}); }; req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); }); }
  async function saveMeta(){ if(!persistenceEnabled||!db) return; let value={ groups:state.groups.map(g=>({ id:g.id, owner:g.owner, imageIds:[...g.imageIds], createdAt:g.createdAt })), settings:{...state.settings} }; return new Promise(res=>{ let tx=db.transaction(['meta'],'readwrite'); tx.objectStore('meta').put({key:'state',value}); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }); }
  async function readMeta(){ if(!persistenceEnabled||!db) return null; return new Promise(res=>{ let tx=db.transaction(['meta'],'readonly'); let req=tx.objectStore('meta').get('state'); req.onsuccess=()=>res(req.result?req.result.value:null); req.onerror=()=>res(null); }); }
  async function putImageRecord(rec){ if(!persistenceEnabled||!db) return; return new Promise((res,rej)=>{ let tx=db.transaction(['images'],'readwrite'); let req=tx.objectStore('images').put(rec); req.onsuccess=()=>res(); req.onerror=()=>rej(req.error); }); }
  async function getImageRecord(id){ if(!persistenceEnabled||!db) return null; return new Promise(res=>{ let tx=db.transaction(['images'],'readonly'); let req=tx.objectStore('images').get(id); req.onsuccess=()=>res(req.result||null); req.onerror=()=>res(null); }); }
  async function deleteImageRecord(id){ if(!persistenceEnabled||!db) return; return new Promise(res=>{ let tx=db.transaction(['images'],'readwrite'); tx.objectStore('images').delete(id); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }); }
  async function clearDbData(){ if(!persistenceEnabled||!db) return; return new Promise(res=>{ let tx=db.transaction(['meta','images'],'readwrite'); tx.objectStore('meta').clear(); tx.objectStore('images').clear(); tx.oncomplete=()=>res(); tx.onerror=()=>res(); }); }
  async function loadImageBitmap(file){ try{ return await createImageBitmap(file,{imageOrientation:'from-image'}); } catch(err){ return new Promise((res,rej)=>{ let img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=URL.createObjectURL(file); }); } }
  async function prepareImage(file){ let bitmap=await loadImageBitmap(file); return { image:bitmap, width:bitmap.width, height:bitmap.height }; }
  function drawCover(ctx,src,destW,destH,dx,dy){ let srcW=src.width, srcH=src.height; if(srcW>srcH){ ctx.save(); ctx.translate(dx+destW/2,dy+destH/2); ctx.rotate(Math.PI/2); let t=destW; destW=destH; destH=t; dx=-destW/2; dy=-destH/2; try{ drawCoverUpright(ctx,src,destW,destH,dx,dy); } finally{ ctx.restore(); } return; } drawCoverUpright(ctx,src,destW,destH,dx,dy); }
  function drawCoverUpright(ctx,src,destW,destH,dx,dy){ let srcW=src.width, srcH=src.height, destAspect=destW/destH, srcAspect=srcW/srcH, cropW,cropH,sx,sy; if(srcAspect>destAspect){ cropH=srcH; cropW=srcH*destAspect; sx=(srcW-cropW)/2; sy=0; } else { cropW=srcW; cropH=srcW/destAspect; sx=0; sy=(srcH-cropH)/2; } ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high'; ctx.drawImage(src,sx,sy,cropW,cropH,dx,dy,destW,destH); }
  function buildPlacements(){ let p=[]; state.groups.forEach(g=>{ g.items.forEach(item=>{ p.push({ owner:g.owner, groupId:g.id, image:item.image, name:item.name }); }); }); return p; }

  // --- Geometry Helpers ---
  function getFrameCorners(frame,layout){
    const rot=(frame.rotation||0)*Math.PI/180;
    const cx=frame.x+layout.outerW/2, cy=frame.y+layout.outerH/2, hw=layout.outerW/2, hh=layout.outerH/2;
    return [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}].map(pt=>({
      x:cx+pt.x*Math.cos(rot)-pt.y*Math.sin(rot),
      y:cy+pt.x*Math.sin(rot)+pt.y*Math.cos(rot)
    }));
  }
  function frameBoundingBoxMm(frame,layout){
    const corners=getFrameCorners(frame,layout), xs=corners.map(c=>c.x), ys=corners.map(c=>c.y);
    return { minX:Math.min(...xs), maxX:Math.max(...xs), minY:Math.min(...ys), maxY:Math.max(...ys) };
  }
  function unionBox(boxes){ return boxes.reduce((a,b)=>({minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minY:Math.min(a.minY,b.minY),maxY:Math.max(a.maxY,b.maxY)}), {minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity}); }

  // Separating Axis Theorem for convex polygon intersection
  function polygonsIntersect(poly1, poly2) {
    function getAxes(poly) {
      const axes = [];
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        axes.push({ x: -(p2.y - p1.y), y: p2.x - p1.x });
      }
      return axes;
    }
    function project(poly, axis) {
      let min = Infinity, max = -Infinity;
      for (const p of poly) {
        const proj = p.x * axis.x + p.y * axis.y;
        if (proj < min) min = proj;
        if (proj > max) max = proj;
      }
      return { min, max };
    }
    const axes = [...getAxes(poly1), ...getAxes(poly2)];
    for (const axis of axes) {
      const proj1 = project(poly1, axis);
      const proj2 = project(poly2, axis);
      if (proj1.max < proj2.min || proj2.max < proj1.min) return false;
    }
    return true;
  }

  function rectIntersectsPolygon(rect, poly) {
    const rectPoly = [
      {x: rect.minX, y: rect.minY}, {x: rect.maxX, y: rect.minY},
      {x: rect.maxX, y: rect.maxY}, {x: rect.minX, y: rect.maxY}
    ];
    return polygonsIntersect(rectPoly, poly);
  }

  // --- Grouping and Dividers ---
  function groupPlacementsByBatch(pagePlacements){
    const runs=[];
    pagePlacements.forEach((item,idx)=>{
      const last=runs[runs.length-1];
      if(last && last.groupId===item.groupId) last.indices.push(idx);
      else runs.push({ owner:item.owner, groupId:item.groupId, indices:[idx] });
    });
    return runs;
  }

  const LABEL_CLEARANCE_MM = 0.8;
  const LABEL_PAGE_MARGIN_MM = 1;
  const LABEL_SCALES = [1, 0.9, 0.8, 0.7, 0.6];
  const LABEL_SCAN_STEP_MM = 2.5;
  const unplacedLabels = new Set();

  function labelWarningText(){
    return unplacedLabels.size ? ` ⚠ No room for the name ${[...unplacedLabels].join(', ')} outside the polaroids. Widen the page margin or the gaps.` : '';
  }

  function measureLabelMm(ctx, text, fontMm, pxPerMm){
    ctx.save();
    ctx.font = `700 ${mmToPx(fontMm, pxPerMm)}px Manrope, 'Segoe UI', sans-serif`;
    const w = ctx.measureText(text).width / pxPerMm;
    ctx.restore();
    return { w: Math.max(w, fontMm), h: fontMm };
  }

  function labelBoxesOverlap(a, b){ return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY; }
  function polygonBox(poly){
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  function labelRectFree(rect, layout, obstacles){
    if (rect.minX < LABEL_PAGE_MARGIN_MM || rect.maxX > layout.paperW - LABEL_PAGE_MARGIN_MM ||
        rect.minY < LABEL_PAGE_MARGIN_MM || rect.maxY > layout.paperH - LABEL_PAGE_MARGIN_MM) return false;
    const padded = { minX: rect.minX - LABEL_CLEARANCE_MM, maxX: rect.maxX + LABEL_CLEARANCE_MM, minY: rect.minY - LABEL_CLEARANCE_MM, maxY: rect.maxY + LABEL_CLEARANCE_MM };
    for (const o of obstacles.polys) {
      if (labelBoxesOverlap(padded, o.box) && rectIntersectsPolygon(padded, o.poly)) return false;
    }
    for (const r of obstacles.rects) {
      if (labelBoxesOverlap(padded, r)) return false;
    }
    return true;
  }

  function labelAxisPositions(min, max, half, extras){
    const lo = min + half, hi = max - half, out = new Set();
    if (hi < lo) return [];
    for (let v = lo; v <= hi + 1e-6; v += LABEL_SCAN_STEP_MM) out.add(Math.round(v * 100) / 100);
    out.add(Math.round(lo * 100) / 100);
    out.add(Math.round(hi * 100) / 100);
    extras.forEach(v => { if (v >= lo - 1e-6 && v <= hi + 1e-6) out.add(Math.round(v * 100) / 100); });
    return [...out];
  }

  function findLabelSpot(ctx, groupBox, text, layout, obstacles, pxPerMm){
    const gcx = (groupBox.minX + groupBox.maxX) / 2, gcy = (groupBox.minY + groupBox.maxY) / 2;
    const allBoxes = [...obstacles.polys.map(o => o.box), ...obstacles.rects];

    for (const scale of LABEL_SCALES) {
      const fontMm = LABEL_FONT_MM * scale;
      const { w, h } = measureLabelMm(ctx, text, fontMm, pxPerMm);
      const orientations = [{ vertical: false, w, h }, { vertical: true, w: h, h: w }];
      let best = null;

      orientations.forEach(o => {
        const extraX = [gcx, groupBox.minX + o.w / 2, groupBox.maxX - o.w / 2], extraY = [gcy, groupBox.minY + o.h / 2, groupBox.maxY - o.h / 2];
        allBoxes.forEach(b => {
          extraX.push(b.minX - LABEL_CLEARANCE_MM - o.w / 2 - 0.01, b.maxX + LABEL_CLEARANCE_MM + o.w / 2 + 0.01);
          extraY.push(b.minY - LABEL_CLEARANCE_MM - o.h / 2 - 0.01, b.maxY + LABEL_CLEARANCE_MM + o.h / 2 + 0.01);
        });
        extraX.push(LABEL_PAGE_MARGIN_MM + o.w / 2, layout.paperW - LABEL_PAGE_MARGIN_MM - o.w / 2);
        extraY.push(LABEL_PAGE_MARGIN_MM + o.h / 2, layout.paperH - LABEL_PAGE_MARGIN_MM - o.h / 2);

        const xs = labelAxisPositions(LABEL_PAGE_MARGIN_MM, layout.paperW - LABEL_PAGE_MARGIN_MM, o.w / 2, extraX);
        const ys = labelAxisPositions(LABEL_PAGE_MARGIN_MM, layout.paperH - LABEL_PAGE_MARGIN_MM, o.h / 2, extraY);

        xs.forEach(x => ys.forEach(y => {
          const rect = { minX: x - o.w / 2, maxX: x + o.w / 2, minY: y - o.h / 2, maxY: y + o.h / 2 };
          const dx = Math.max(groupBox.minX - rect.maxX, 0, rect.minX - groupBox.maxX);
          const dy = Math.max(groupBox.minY - rect.maxY, 0, rect.minY - groupBox.maxY);
          const score = Math.hypot(dx, dy) + 0.02 * Math.hypot(x - gcx, y - gcy);
          if (best && score >= best.score) return;
          if (!labelRectFree(rect, layout, obstacles)) return;
          best = { score, x, y, w: o.w, h: o.h, fontMm, rotate: o.vertical ? (x < layout.paperW / 2 ? -90 : 90) : 0 };
        }));
      });

      if (best) return best;
    }
    return null;
  }

function buildDividerSegments(frameBoxes, frameRuns, layout) {
    const MAX_GAP_MM = 12;
    const MIN_OVERLAP_MM = 0.5;
    const CLUSTER_MM = 0.6;
    const JOIN_MM = 8;
    const hSegs = [];
    const vSegs = [];

    const addSeg = (list, pos, a, b) => {
      const found = list.find(s => Math.abs(s.pos - pos) <= CLUSTER_MM);
      if (found) { found.a = Math.min(found.a, a); found.b = Math.max(found.b, b); }
      else list.push({ pos, a, b });
    };

    for (let i = 0; i < frameBoxes.length; i++) {
      for (let j = i + 1; j < frameBoxes.length; j++) {
        if (frameRuns[i] === frameRuns[j]) continue;
        const p = frameBoxes[i];
        const q = frameBoxes[j];

        const ox1 = Math.max(p.minX, q.minX), ox2 = Math.min(p.maxX, q.maxX);
        const oy1 = Math.max(p.minY, q.minY), oy2 = Math.min(p.maxY, q.maxY);

        if (ox2 - ox1 > MIN_OVERLAP_MM) {
          const gapDown = q.minY - p.maxY;
          const gapUp = p.minY - q.maxY;
          if (gapDown >= -1 && gapDown <= MAX_GAP_MM) addSeg(hSegs, (p.maxY + q.minY) / 2, ox1, ox2);
          else if (gapUp >= -1 && gapUp <= MAX_GAP_MM) addSeg(hSegs, (q.maxY + p.minY) / 2, ox1, ox2);
        }
        if (oy2 - oy1 > MIN_OVERLAP_MM) {
          const gapRight = q.minX - p.maxX;
          const gapLeft = p.minX - q.maxX;
          if (gapRight >= -1 && gapRight <= MAX_GAP_MM) addSeg(vSegs, (p.maxX + q.minX) / 2, oy1, oy2);
          else if (gapLeft >= -1 && gapLeft <= MAX_GAP_MM) addSeg(vSegs, (q.maxX + p.minX) / 2, oy1, oy2);
        }
      }
    }

    const raw = {
      h: hSegs.map(s => ({ ...s })),
      v: vSegs.map(s => ({ ...s }))
    };

    const extendEnd = (seg, atStart, crossSegs, axisIsX) => {
      const from = atStart ? seg.a : seg.b;
      let best = null;
      crossSegs.forEach(c => {
        if (seg.pos < c.a - JOIN_MM || seg.pos > c.b + JOIN_MM) return;
        const d = atStart ? from - c.pos : c.pos - from;
        if (d >= -JOIN_MM && d <= JOIN_MM * 2 && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, pos: c.pos };
      });
      if (best) return best.pos;

      const limit = axisIsX ? layout.paperW : layout.paperH;
      let edge = atStart ? 0 : limit;
      frameBoxes.forEach(f => {
        const lo = axisIsX ? f.minY : f.minX;
        const hi = axisIsX ? f.maxY : f.maxX;
        if (!(seg.pos > lo && seg.pos < hi)) return;
        const fMin = axisIsX ? f.minX : f.minY;
        const fMax = axisIsX ? f.maxX : f.maxY;
        if (atStart && fMax <= from + 0.01) edge = Math.max(edge, fMax);
        if (!atStart && fMin >= from - 0.01) edge = Math.min(edge, fMin);
      });
      return edge;
    };

    const result = [];
    raw.h.forEach(s => {
      result.push({
        h: true, pos: s.pos,
        a: extendEnd(s, true, raw.v, true),
        b: extendEnd(s, false, raw.v, true)
      });
    });
    raw.v.forEach(s => {
      result.push({
        h: false, pos: s.pos,
        a: extendEnd(s, true, raw.h, false),
        b: extendEnd(s, false, raw.h, false)
      });
    });
    return result;
  }

  function drawCutLines(ctx, frameBoxes, frameRuns, pxPerMm, layout) {
    const segs = buildDividerSegments(frameBoxes, frameRuns, layout);
    if (!segs.length) return segs;

    const unit = layout.outerW / 560;
    const lineMm = unit * 9;
    const dashMm = unit * 35;
    const gapMm = unit * 26.6;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = '#000000';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = Math.max(2, mmToPx(lineMm, pxPerMm));
    ctx.setLineDash([mmToPx(dashMm, pxPerMm), mmToPx(gapMm, pxPerMm)]);

    segs.forEach(s => {
      if (s.b - s.a <= 0.01) return;
      ctx.beginPath();
      if (s.h) {
        ctx.moveTo(mmToPx(s.a, pxPerMm), mmToPx(s.pos, pxPerMm));
        ctx.lineTo(mmToPx(s.b, pxPerMm), mmToPx(s.pos, pxPerMm));
      } else {
        ctx.moveTo(mmToPx(s.pos, pxPerMm), mmToPx(s.a, pxPerMm));
        ctx.lineTo(mmToPx(s.pos, pxPerMm), mmToPx(s.b, pxPerMm));
      }
      ctx.stroke();
    });
    ctx.restore();
    return segs;
  }

  function drawDividerNames(ctx, segs, frameBoxes, frameRuns, runs, pxPerMm) {
    const MAX_GAP_MM = 12;
    const PAD_MM = 1.5;
    const MIN_FONT_MM = 1.2;

    segs.forEach(seg => {
      if (seg.b - seg.a <= 0.01) return;
      const sides = new Map();
      let before = -Infinity;
      let after = Infinity;

      frameBoxes.forEach((f, i) => {
        const lo = seg.h ? f.minX : f.minY;
        const hi = seg.h ? f.maxX : f.maxY;
        const nearLo = seg.h ? f.minY : f.minX;
        const nearHi = seg.h ? f.maxY : f.maxX;
        const start = Math.max(lo, seg.a);
        const end = Math.min(hi, seg.b);
        if (end - start <= 0.5) return;

        const isBefore = nearHi <= seg.pos + 1 && seg.pos - nearHi <= MAX_GAP_MM;
        const isAfter = nearLo >= seg.pos - 1 && nearLo - seg.pos <= MAX_GAP_MM;
        if (!isBefore && !isAfter) return;
        if (isBefore) before = Math.max(before, nearHi);
        if (isAfter) after = Math.min(after, nearLo);

        const run = frameRuns[i];
        const cur = sides.get(run);
        if (cur) { cur.start = Math.min(cur.start, start); cur.end = Math.max(cur.end, end); }
        else sides.set(run, { run, start, end });
      });

      const entries = [...sides.values()].sort((x, y) => x.run - y.run);
      if (!entries.length || !isFinite(before) || !isFinite(after)) return;

      const gapMm = after - before;
      if (gapMm <= 0) return;

      let fontMm = Math.min(LABEL_FONT_MM, gapMm * 0.7);
      if (fontMm < MIN_FONT_MM) fontMm = MIN_FONT_MM;

      const fontPx = mmToPx(fontMm, pxPerMm);
      ctx.font = `700 ${fontPx}px Manrope, 'Segoe UI', sans-serif`;
      const names = entries.map(e => (runs[e.run].owner || '').toUpperCase());
      const widths = names.map(n => ctx.measureText(n).width / pxPerMm);

      let centers = entries.map(e => (e.start + e.end) / 2);
      let clash = false;
      for (let i = 1; i < centers.length; i++) {
        if (centers[i] - centers[i - 1] < (widths[i] + widths[i - 1]) / 2 + PAD_MM * 2) clash = true;
      }
      if (clash) {
        const lo = Math.min(...entries.map(e => e.start));
        const hi = Math.max(...entries.map(e => e.end));
        centers = entries.map((e, i) => lo + (hi - lo) * (i + 0.5) / entries.length);
      }

      const midPos = (before + after) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      names.forEach((name, i) => {
        if (!name) return;
        const w = widths[i] + PAD_MM * 2;
        const h = Math.max(gapMm * 0.8, fontMm);
        ctx.save();
        ctx.translate(
          mmToPx(seg.h ? centers[i] : midPos, pxPerMm),
          mmToPx(seg.h ? midPos : centers[i], pxPerMm)
        );
        if (!seg.h) ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-mmToPx(w / 2, pxPerMm), -mmToPx(h / 2, pxPerMm), mmToPx(w, pxPerMm), mmToPx(h, pxPerMm));
        ctx.fillStyle = '#000000';
        ctx.fillText(name, 0, 0);
        ctx.restore();
      });
      ctx.restore();
    });
  }

  function drawGroupDividersAndLabels(ctx, layout, pagePlacements, pxPerMm) {
    const runs = groupPlacementsByBatch(pagePlacements);
    if (!runs.length) return;

    const allBoxes = layout.frames.map(f => frameBoundingBoxMm(f, layout));
    const allFramePolys = layout.frames.map(f => getFrameCorners(f, layout));
    const groupBounds = runs.map(run => unionBox(run.indices.map(i => allBoxes[i])));

    let segs = [];
    if (runs.length > 1) {
      const frameRuns = [];
      runs.forEach((run, ri) => run.indices.forEach(i => { frameRuns[i] = ri; }));
      const placedBoxes = [], placedRuns = [];
      allBoxes.forEach((box, i) => { if (frameRuns[i] !== undefined) { placedBoxes.push(box); placedRuns.push(frameRuns[i]); } });
      segs = drawCutLines(ctx, placedBoxes, placedRuns, pxPerMm, layout) || [];
    }

    const obstacles = {
      polys: allFramePolys.map(poly => ({ poly, box: polygonBox(poly) })),
      rects: segs.filter(s => s.b - s.a > 0.01).map(s => s.h
        ? { minX: s.a, maxX: s.b, minY: s.pos - 0.5, maxY: s.pos + 0.5 }
        : { minX: s.pos - 0.5, maxX: s.pos + 0.5, minY: s.a, maxY: s.b })
    };

    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    runs.forEach((run, ri) => {
      const text = (run.owner || '').toUpperCase();
      if (!text) return;
      const spot = findLabelSpot(ctx, groupBounds[ri], text, layout, obstacles, pxPerMm);
      if (!spot) { unplacedLabels.add(text); return; }
      obstacles.rects.push({ minX: spot.x - spot.w / 2, maxX: spot.x + spot.w / 2, minY: spot.y - spot.h / 2, maxY: spot.y + spot.h / 2 });

      ctx.save();
      ctx.font = `700 ${mmToPx(spot.fontMm, pxPerMm)}px Manrope, 'Segoe UI', sans-serif`;
      ctx.translate(mmToPx(spot.x, pxPerMm), mmToPx(spot.y, pxPerMm));
      if (spot.rotate) ctx.rotate(spot.rotate * Math.PI / 180);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    });
  }

  function drawFrames(ctx,layout,pxPerMm){
    let outer=mmToPx(0.4,pxPerMm), inner=mmToPx(0.3,pxPerMm);
    ctx.strokeStyle='#000';
    layout.frames.forEach(f=>{
      const rot=(f.rotation||0)*Math.PI/180;
      const outerWpx=mmToPx(layout.outerW,pxPerMm), outerHpx=mmToPx(layout.outerH,pxPerMm);
      const cx=mmToPx(f.x,pxPerMm)+outerWpx/2, cy=mmToPx(f.y,pxPerMm)+outerHpx/2;
      ctx.save();
      ctx.translate(cx,cy);
      ctx.rotate(rot);
      ctx.lineWidth=outer;
      ctx.strokeRect(-outerWpx/2,-outerHpx/2,outerWpx,outerHpx);
      ctx.lineWidth=inner;
      const innerX=-outerWpx/2+mmToPx(layout.offsetX,pxPerMm), innerY=-outerHpx/2+mmToPx(layout.offsetY,pxPerMm);
      ctx.strokeRect(innerX,innerY,mmToPx(layout.innerW,pxPerMm),mmToPx(layout.innerH,pxPerMm));
      ctx.restore();
    });
  }

  function drawImages(ctx,layout,pagePlacements,pxPerMm){
    pagePlacements.forEach((item,idx)=>{
      let frame=layout.frames[idx]; if(!frame) return;
      const rot=(frame.rotation||0)*Math.PI/180;
      const destW=mmToPx(layout.innerW,pxPerMm), destH=mmToPx(layout.innerH,pxPerMm);
      
      // Center of the outer frame
      const cx=mmToPx(frame.x,pxPerMm)+mmToPx(layout.outerW,pxPerMm)/2;
      const cy=mmToPx(frame.y,pxPerMm)+mmToPx(layout.outerH,pxPerMm)/2;
      
      // Offset of inner window center relative to outer frame center
      const innerOffsetX = mmToPx(layout.offsetX,pxPerMm) + destW/2 - mmToPx(layout.outerW,pxPerMm)/2;
      const innerOffsetY = mmToPx(layout.offsetY,pxPerMm) + destH/2 - mmToPx(layout.outerH,pxPerMm)/2;
      
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.translate(innerOffsetX, innerOffsetY);
      drawCover(ctx,item.image,destW,destH,-destW/2,-destH/2);
      ctx.restore();
    });
  }

  /* ---- Captions (text in the margin below a polaroid) ---- */
  const CAPTION_FONTS={
    manrope:{label:'Manrope (clean)',css:"'Manrope','Segoe UI',sans-serif",load:'Manrope'},
    caveat:{label:'Caveat (handwriting)',css:"'Caveat','Segoe Print',cursive",load:'Caveat'},
    marker:{label:'Permanent Marker',css:"'Permanent Marker','Comic Sans MS',cursive",load:'Permanent Marker'},
    playfair:{label:'Playfair Display (serif)',css:"'Playfair Display',Georgia,serif",load:'Playfair Display'},
    arial:{label:'Arial',css:"Arial,Helvetica,sans-serif",load:'Arial'},
    courier:{label:'Courier New (mono)',css:"'Courier New',monospace",load:'Courier New'}
  };
  const loadedCaptionFonts=new Set();
  function ensureCaptionFont(font){
    if(loadedCaptionFonts.has(font.load)||!document.fonts||!document.fonts.load) return;
    loadedCaptionFonts.add(font.load);
    document.fonts.load(`16px "${font.load}"`).then(()=>renderPreviews()).catch(()=>{});
  }
  function pagesMatch(spec,pageNo){
    const t=String(spec||'').trim().toLowerCase();
    if(!t||t==='all') return true;
    return t.split(',').some(part=>{
      const m=part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if(!m) return false;
      const a=Number(m[1]), b=m[2]?Number(m[2]):a;
      return pageNo>=Math.min(a,b) && pageNo<=Math.max(a,b);
    });
  }
  function drawCaptions(ctx,layout,pagePlacements,pxPerMm,pageIndex){
    (state.settings.captions||[]).forEach(cap=>{
      const text=String(cap.text||'').trim();
      if(!text||!pagesMatch(cap.pages,(pageIndex||0)+1)) return;
      const font=CAPTION_FONTS[cap.font]||CAPTION_FONTS.manrope; ensureCaptionFont(font);
      pagePlacements.forEach((item,idx)=>{
        if(cap.slot!=='all' && Number(cap.slot)!==idx) return;
        const frame=layout.frames[idx]; if(!frame) return;
        const oW=mmToPx(layout.outerW,pxPerMm), oH=mmToPx(layout.outerH,pxPerMm);
        const cx=mmToPx(frame.x,pxPerMm)+oW/2, cy=mmToPx(frame.y,pxPerMm)+oH/2;
        const align=cap.align==='left'||cap.align==='right'?cap.align:'center';
        const bottomTop=layout.offsetY+layout.innerH;
        const ax=(align==='left'?layout.offsetX:align==='right'?layout.offsetX+layout.innerW:layout.outerW/2)+(Number(cap.dx)||0);
        const ay=bottomTop+(layout.outerH-bottomTop)/2+(Number(cap.dy)||0);
        let fontPx=mmToPx((Number(cap.size)||10)*PT_TO_MM,pxPerMm);
        ctx.save();
        ctx.translate(cx,cy); ctx.rotate((frame.rotation||0)*Math.PI/180);
        ctx.font=`${fontPx}px ${font.css}`;
        const maxW=oW-mmToPx(2,pxPerMm), w=ctx.measureText(text).width;
        if(w>maxW){ fontPx*=maxW/w; ctx.font=`${fontPx}px ${font.css}`; }
        ctx.fillStyle=cap.color||'#000'; ctx.textAlign=align; ctx.textBaseline='middle';
        ctx.fillText(text,mmToPx(ax,pxPerMm)-oW/2,mmToPx(ay,pxPerMm)-oH/2);
        ctx.restore();
      });
    });
  }
  function buildCaptionsCanvas(layout,pagePlacements,pxPerMm,w,h,pageIndex){ let c=document.createElement('canvas'); c.width=w; c.height=h; drawCaptions(c.getContext('2d'),layout,pagePlacements,pxPerMm,pageIndex); return c; }

  function drawPageCanvas(ctx,layout,pagePlacements,pxPerMm,pageIndex){
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,mmToPx(layout.paperW,pxPerMm),mmToPx(layout.paperH,pxPerMm));
    drawFrames(ctx,layout,pxPerMm);
    drawImages(ctx,layout,pagePlacements,pxPerMm);
    drawCaptions(ctx,layout,pagePlacements,pxPerMm,pageIndex);
    drawGroupDividersAndLabels(ctx,layout,pagePlacements,pxPerMm);
  }

  function previewFitScale(layout,pages){
    let body=elements.previewContainer.parentElement;
    if(!body||!body.clientWidth||!body.clientHeight) return 3.5;
    let cs=getComputedStyle(body), padX=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight), padY=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
    let tb=body.querySelector('.preview-toolbar'), tbH=tb?tb.offsetHeight+parseFloat(getComputedStyle(tb).marginBottom):0;
    let availW=body.clientWidth-padX, availH=body.clientHeight-padY-tbH-(pages>1?28:2);
    return Math.max(0.5,Math.min(availW/layout.paperW,availH/layout.paperH));
  }
  function renderPreviews(){
    let placements=buildPlacements(), layout=computeLayout(), per=layout.perPage, pages=per>0?Math.ceil(placements.length/per):0;
    elements.previewBtn.disabled=placements.length===0||per===0;
    elements.modalDownloadBtn.disabled=placements.length===0||per===0;
    if(elements.modalPsdBtn) elements.modalPsdBtn.disabled=placements.length===0||per===0;
    if(elements.modalDocxBtn) elements.modalDocxBtn.disabled=placements.length===0||per===0;
    if(elements.modalPrintBtn) elements.modalPrintBtn.disabled=placements.length===0||per===0;
    elements.previewContainer.innerHTML='';
    unplacedLabels.clear();
    if(!placements.length||per===0){
      let p=document.createElement('p'); p.className='preview-empty';
      p.textContent=per===0?'This layout has no polaroid frames yet. Edit it first.':'No pages to show.';
      elements.previewContainer.appendChild(p); return;
    }
    let pxPerMmPreview=previewFitScale(layout,pages)*state.previewZoom, dpr=window.devicePixelRatio||1;
    for(let pageIndex=0;pageIndex<pages;pageIndex++){
      let block=document.createElement('div'); block.className='preview-block';
      let label=document.createElement('div'); label.className='preview-label'; label.textContent=`Page ${pageIndex+1}`;
      let canvas=document.createElement('canvas'); canvas.className='preview-canvas';
      let pagePlacements=placements.slice(pageIndex*per,(pageIndex+1)*per);
      let widthPx=Math.round(layout.paperW*pxPerMmPreview*dpr), heightPx=Math.round(layout.paperH*pxPerMmPreview*dpr);
      canvas.width=widthPx; canvas.height=heightPx;
      canvas.style.width=`${layout.paperW*pxPerMmPreview}px`; canvas.style.height=`${layout.paperH*pxPerMmPreview}px`;
      let ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
      drawPageCanvas(ctx,layout,pagePlacements,pxPerMmPreview,pageIndex);
      block.appendChild(label); block.appendChild(canvas); elements.previewContainer.appendChild(block);
    }
    if(unplacedLabels.size) setStatus(labelWarningText().trim());
  }

  function pageOrientationLabel(layout){ return layout.paperW>layout.paperH ? 'landscape' : 'portrait'; }
  function renderPageToCanvas(pageIndex,layout,placements,dpi){
    let per=layout.perPage, pxPerMm=dpi/25.4, canvas=document.createElement('canvas');
    canvas.width=Math.round(layout.paperW*pxPerMm); canvas.height=Math.round(layout.paperH*pxPerMm);
    let ctx=canvas.getContext('2d');
    let pagePlacements=placements.slice(pageIndex*per,(pageIndex+1)*per);
    drawPageCanvas(ctx,layout,pagePlacements,pxPerMm,pageIndex);
    return canvas;
  }
  async function renderPageBitmapForExport(pageIndex,layout,placements,dpi){
    let canvas=renderPageToCanvas(pageIndex,layout,placements,dpi);
    return new Promise((res,rej)=>{
      canvas.toBlob(blob=>{
        if(!blob) rej(new Error('Canvas export failed'));
        else { let reader=new FileReader(); reader.onloadend=()=>res({dataUrl:reader.result}); reader.onerror=rej; reader.readAsDataURL(blob); }
      },'image/png');
    });
  }
  async function generatePdf(){
    let placements=buildPlacements(); let layout=computeLayout();
    if(!placements.length||!layout.perPage){ setStatus('No images to export.'); return false; }
    await new Promise(res=>{
      if(window.jspdf?.jsPDF||window.jsPDF) res();
      else{ let script=document.createElement('script'); script.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; script.onload=res; document.head.appendChild(script); }
    });
    let jsPDF=window.jspdf?.jsPDF||window.jsPDF; if(!jsPDF) throw new Error('jsPDF not loaded');
    let per=layout.perPage, pages=Math.ceil(placements.length/per), orientation=pageOrientationLabel(layout),
        doc=new jsPDF({unit:'mm',format:[layout.paperW,layout.paperH],orientation}), dpi=state.settings.qualityDpi;
    for(let i=0;i<pages;i++){
      if(i>0) doc.addPage([layout.paperW,layout.paperH],orientation);
      let {dataUrl}=await renderPageBitmapForExport(i,layout,placements,dpi);
      doc.addImage(dataUrl,'PNG',0,0,layout.paperW,layout.paperH,undefined,'NONE');
    }
    doc.save(`polaroid-print-${new Date().toISOString().slice(0,10)}.pdf`);
    return true;
  }
  function mmToTwip(mm){ return Math.round((mm/25.4)*1440); }
  function mmToPx96(mm){ return (mm/25.4)*96; }
  async function generateDocxExact(){
    let placements=buildPlacements(); let layout=computeLayout();
    if(!placements.length||!layout.perPage){ setStatus('No images to export.'); return false; }
    let docxLib=window.docx; if(!docxLib) throw new Error('DOCX library not loaded.');
    let per=layout.perPage, pages=Math.ceil(placements.length/per), sections=[], dpi=state.settings.qualityDpi, orientation=pageOrientationLabel(layout);
    for(let i=0;i<pages;i++){
      setStatus(`Rendering DOCX page ${i+1}/${pages}...`);
      let canvas=renderPageToCanvas(i,layout,placements,dpi);
      let blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Canvas export failed')),'image/png'));
      let buffer=await blob.arrayBuffer();
      let widthPx=mmToPx96(layout.paperW), heightPx=mmToPx96(layout.paperH);
      sections.push({
        properties:{ page:{ margin:{top:0,right:0,bottom:0,left:0}, size:{orientation,width:mmToTwip(layout.paperW),height:mmToTwip(layout.paperH)} } },
        children:[ new docxLib.Paragraph({ children:[ new docxLib.ImageRun({ data:buffer, transformation:{width:widthPx,height:heightPx} }) ] }) ]
      });
    }
    let doc=new docxLib.Document({sections});
    let blob=await docxLib.Packer.toBlob(doc);
    let url=URL.createObjectURL(blob);
    let a=document.createElement('a'); a.href=url; a.download=`polaroid-print-${new Date().toISOString().slice(0,10)}.docx`; a.click(); URL.revokeObjectURL(url);
    return true;
  }
  function buildFramesCanvas(layout,pxPerMm,widthPx,heightPx){ let canvas=document.createElement('canvas'); canvas.width=widthPx; canvas.height=heightPx; let ctx=canvas.getContext('2d'); drawFrames(ctx,layout,pxPerMm); return canvas; }
  function buildBackgroundCanvas(w,h){ let c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').fillStyle='#ffffff'; c.getContext('2d').fillRect(0,0,w,h); return c; }
  function createImageLayer(item,frame,layout,pxPerMm,idx){
    const rot=frame.rotation||0;
    const outerWpx = mmToPx(layout.outerW, pxPerMm);
    const outerHpx = mmToPx(layout.outerH, pxPerMm);
    const innerWpx = mmToPx(layout.innerW, pxPerMm);
    const innerHpx = mmToPx(layout.innerH, pxPerMm);
    
    const outerCxMm = frame.x + layout.outerW/2;
    const outerCyMm = frame.y + layout.outerH/2;
    
    const innerCxMm = layout.offsetX + layout.innerW/2 - layout.outerW/2;
    const innerCyMm = layout.offsetY + layout.innerH/2 - layout.outerH/2;
    
    const rad = rot * Math.PI/180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const rotatedInnerCxMm = outerCxMm + innerCxMm * cos - innerCyMm * sin;
    const rotatedInnerCyMm = outerCyMm + innerCxMm * sin + innerCyMm * cos;
    
    const name=`${item.owner}_${String(idx+1).padStart(2,'0')}`;
    
    if(!rot){
      let canvas=document.createElement('canvas'); canvas.width=innerWpx; canvas.height=innerHpx;
      let ctx=canvas.getContext('2d'); drawCover(ctx,item.image,innerWpx,innerHpx,0,0);
      let left=Math.round((rotatedInnerCxMm - layout.innerW/2)*pxPerMm), top=Math.round((rotatedInnerCyMm - layout.innerH/2)*pxPerMm);
      return { name, left, top, right:left+innerWpx, bottom:top+innerHpx, canvas };
    }
    
    const bboxWpx=Math.ceil(innerWpx*Math.abs(cos)+innerHpx*Math.abs(sin));
    const bboxHpx=Math.ceil(innerWpx*Math.abs(sin)+innerHpx*Math.abs(cos));
    const cxPx = rotatedInnerCxMm * pxPerMm;
    const cyPx = rotatedInnerCyMm * pxPerMm;
    const canvas=document.createElement('canvas'); canvas.width=bboxWpx; canvas.height=bboxHpx;
    const ctx=canvas.getContext('2d');
    ctx.translate(bboxWpx/2, bboxHpx/2);
    ctx.rotate(rad);
    drawCover(ctx,item.image,innerWpx,innerHpx,-innerWpx/2,-innerHpx/2);
    
    const left=Math.round(cxPx-bboxWpx/2), top=Math.round(cyPx-bboxHpx/2);
    return { name, left, top, right:left+bboxWpx, bottom:top+bboxHpx, canvas };
  }
  async function generatePsdZip(){
    let placements=buildPlacements(); let layout=computeLayout();
    if(!placements.length||!layout.perPage){ setStatus('No images to export.'); return false; }
    let ag=window.agPsd||window.agpsd||window['ag-psd'];
    if(!ag||typeof ag.writePsd!=='function') throw new Error('ag-psd not loaded');
    if(!window.JSZip) throw new Error('JSZip not loaded');
    let writePsd=ag.writePsd, per=layout.perPage, pages=Math.ceil(placements.length/per),
        pxPerMm=state.settings.qualityDpi/25.4, zip=new window.JSZip();
    for(let i=0;i<pages;i++){
      setStatus(`Rendering PSD page ${i+1}/${pages}...`);
      let pagePlacements=placements.slice(i*per,(i+1)*per),
          widthPx=Math.round(layout.paperW*pxPerMm), heightPx=Math.round(layout.paperH*pxPerMm),
          bgCanvas=buildBackgroundCanvas(widthPx,heightPx),
          framesCanvas=buildFramesCanvas(layout,pxPerMm,widthPx,heightPx),
          layers=[
            {name:'Background',left:0,top:0,right:widthPx,bottom:heightPx,canvas:bgCanvas},
            {name:'Frames',left:0,top:0,right:widthPx,bottom:heightPx,canvas:framesCanvas}
          ];
      pagePlacements.forEach((item,idx)=>{ let frame=layout.frames[idx]; if(frame) layers.push(createImageLayer(item,frame,layout,pxPerMm,idx)); });
      if((state.settings.captions||[]).some(c=>String(c.text||'').trim())) layers.push({name:'Captions',left:0,top:0,right:widthPx,bottom:heightPx,canvas:buildCaptionsCanvas(layout,pagePlacements,pxPerMm,widthPx,heightPx,i)});
      let psd={ width:widthPx, height:heightPx, children:layers }, buffer=writePsd(psd,{generateThumbnail:false});
      zip.file(`page-${i+1}.psd`,buffer);
    }
    setStatus('Packaging PSD ZIP...');
    let zipBlob=await zip.generateAsync({type:'blob'}), url=URL.createObjectURL(zipBlob),
        a=document.createElement('a'); a.href=url; a.download=`polaroid-print-${new Date().toISOString().slice(0,10)}-psd.zip`; a.click(); URL.revokeObjectURL(url);
    return true;
  }

  async function addBatch(files,owner){
    if(!files||!files.length) return;
    let ownerName=(owner||`Batch ${state.groups.length+1}`).trim()||`Batch ${state.groups.length+1}`,
        ownerUpper=ownerName.toUpperCase(),
        group={ id:uuid(), owner:ownerUpper, createdAt:Date.now(), imageIds:[], items:[] };
    for(let i=0;i<files.length;i++){
      let file=files[i]; if(!file.type.startsWith('image/')) continue;
      setStatus(`Loading images ${i+1}/${files.length}...`);
      let imageId=uuid(); group.imageIds.push(imageId);
      try{ await putImageRecord({id:imageId,blob:file,type:file.type,name:file.name,lastModified:file.lastModified,owner:ownerUpper,createdAt:Date.now()}); }catch(e){}
      let prepared=await prepareImage(file);
      group.items.push({id:uuid(),imageId,name:file.name,image:prepared.image});
    }
    state.groups.push(group);
    await saveMeta();
    setStatus('Ready.'); setCountText(); renderBatches(); renderPreviews();
  }
  async function restoreFromDb(){
    try{ db=await openDb(); }catch(err){ persistenceEnabled=false; setStatus('IndexedDB unavailable; persistence off.'); return; }
    let meta=await readMeta();
    if(!meta){ setStatus('Ready.'); return; }
    state.settings.templateId=meta.settings?.templateId||state.settings.templateId;
    state.settings.qualityDpi=meta.settings?.qualityDpi||state.settings.qualityDpi;
    state.settings.theme=meta.settings?.theme||state.settings.theme;
    state.settings.unit=meta.settings?.unit||state.settings.unit;
    state.settings.captions=Array.isArray(meta.settings?.captions)?meta.settings.captions:[];
    state.groups=[];
    for(let gm of meta.groups||[]){
      let group={ id:gm.id, owner:gm.owner, createdAt:gm.createdAt, imageIds:[...gm.imageIds], items:[] };
      for(let imgId of group.imageIds){
        let rec=await getImageRecord(imgId); if(!rec) continue;
        try{ let prepared=await prepareImage(rec.blob); group.items.push({id:uuid(),imageId:imgId,name:rec.name||'image',image:prepared.image}); }catch(e){}
      }
      state.groups.push(group);
    }
    elements.qualitySelect.value=String(state.settings.qualityDpi);
    elements.templateSelect.value=state.settings.templateId;
    applyTheme(state.settings.theme);
    updateLayoutInfo(); setStatus('Restored saved batches.'); setCountText(); renderBatches(); renderPreviews();
  }
  async function removeGroup(groupId){
    let idx=state.groups.findIndex(g=>g.id===groupId); if(idx===-1) return;
    let group=state.groups[idx]; state.groups.splice(idx,1);
    if(persistenceEnabled&&db){ for(let imgId of group.imageIds) await deleteImageRecord(imgId); await saveMeta(); }
    setStatus('Batch removed.'); setCountText(); renderBatches(); renderPreviews();
  }
  async function clearAll(){ state.groups=[]; await clearDbData(); await saveMeta(); setStatus('Cleared.'); setCountText(); renderBatches(); renderPreviews(); }
  function renderBatches(){
    let cont=elements.batchesList; cont.innerHTML='';
    if(!state.groups.length){ cont.classList.add('empty'); cont.textContent='No batches yet.'; return; }
    cont.classList.remove('empty');
    state.groups.forEach(group=>{
      let row=document.createElement('div'); row.className='batch-row';
      let meta=document.createElement('div'); meta.className='batch-meta';
      let ownerSpan=document.createElement('span'); ownerSpan.textContent=group.owner;
      let countSpan=document.createElement('span'); countSpan.className='batch-count';
      countSpan.textContent=`${group.items.length} image${group.items.length===1?'':'s'}`;
      meta.appendChild(ownerSpan); meta.appendChild(countSpan);
      let rmBtn=document.createElement('button'); rmBtn.className='icon-btn'; rmBtn.type='button'; rmBtn.textContent='✕'; rmBtn.setAttribute('aria-label',`Remove batch ${group.owner}`);
      rmBtn.addEventListener('click',()=>removeGroup(group.id));
      row.appendChild(meta); row.appendChild(rmBtn); cont.appendChild(row);
    });
  }
  function openPreviewModal(){ elements.modal.classList.remove('hidden'); elements.modal.setAttribute('aria-hidden','false'); }
 function closePreviewModal(){ 
    // Release focus from the close button before hiding to prevent ARIA errors
    if (document.activeElement && elements.modal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    elements.modal.classList.add('hidden'); 
    elements.modal.setAttribute('aria-hidden','true'); 
  }
  function openOwnerModal(count){
    return new Promise(resolve=>{
      elements.ownerInput.value='';
      elements.modalCountText.textContent=`You selected ${count} image${count===1?'':'s'}.`;
      elements.ownerModal.classList.remove('hidden'); elements.ownerInput.focus();
      function cleanup(result){
        elements.ownerModal.classList.add('hidden');
        elements.ownerConfirmBtn.removeEventListener('click',onConfirm);
        elements.ownerCancelBtn.removeEventListener('click',onCancel);
        elements.ownerCloseBtn.removeEventListener('click',onCancel);
        elements.ownerBackdrop.removeEventListener('click',onCancel);
        document.removeEventListener('keydown',onKey);
        resolve(result);
      }
      function onConfirm(){ cleanup(elements.ownerInput.value.trim()); }
      function onCancel(){ cleanup(null); }
      function onKey(e){ if(e.key==='Escape') cleanup(null); if(e.key==='Enter') cleanup(elements.ownerInput.value.trim()); }
      elements.ownerConfirmBtn.addEventListener('click',onConfirm);
      elements.ownerCancelBtn.addEventListener('click',onCancel);
      elements.ownerCloseBtn.addEventListener('click',onCancel);
      elements.ownerBackdrop.addEventListener('click',onCancel);
      document.addEventListener('keydown',onKey,{once:true});
    });
  }
  function handlePreviewZoomChange(){ let val=Number(elements.previewZoom.value)||100; state.previewZoom=val/100; if(elements.previewZoomValue) elements.previewZoomValue.textContent=`${val}%`; renderPreviews(); }
  const printObjectUrls=[];
  function clearPrintSheets(){
    const host=document.getElementById('printRoot'); if(host) host.innerHTML='';
    const tag=document.getElementById('printPageStyle'); if(tag) tag.remove();
    printObjectUrls.splice(0).forEach(u=>URL.revokeObjectURL(u));
  }
  function applyPrintPageStyle(layout){
    let tag=document.getElementById('printPageStyle');
    if(!tag){ tag=document.createElement('style'); tag.id='printPageStyle'; document.head.appendChild(tag); }
    tag.textContent=`@page{size:${layout.paperW}mm ${layout.paperH}mm;margin:0}`;
  }
  async function handlePrint(){
    const placements=buildPlacements(), layout=computeLayout(), host=document.getElementById('printRoot');
    if(!placements.length||!layout.perPage||!host){ setStatus('No images to print.'); return; }
    try{
      clearPrintSheets(); unplacedLabels.clear();
      const per=layout.perPage, pages=Math.ceil(placements.length/per), dpi=state.settings.qualityDpi;
      host.style.setProperty('--print-w',`${layout.paperW}mm`);
      host.style.setProperty('--print-h',`${layout.paperH}mm`);
      for(let i=0;i<pages;i++){
        setStatus(`Preparing print page ${i+1}/${pages}...`);
        const canvas=renderPageToCanvas(i,layout,placements,dpi);
        const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error('Canvas export failed')),'image/png'));
        const url=URL.createObjectURL(blob); printObjectUrls.push(url);
        const sheet=document.createElement('div'); sheet.className='print-sheet';
        const img=new Image(); img.alt=`Page ${i+1}`; img.src=url;
        try{ await img.decode(); }catch(e){}
        sheet.appendChild(img); host.appendChild(sheet);
        canvas.width=0; canvas.height=0;
      }
      applyPrintPageStyle(layout);
      const orientation=layout.paperW>layout.paperH?'landscape':'portrait';
      setStatus(`Print dialog opened — paper set to ${toDisplayUnit(layout.paperW).toFixed(2)}×${toDisplayUnit(layout.paperH).toFixed(2)} ${unitLabel()} (${orientation}).${labelWarningText()}`);
      window.addEventListener('afterprint',clearPrintSheets,{once:true});
      window.print();
    }catch(err){ clearPrintSheets(); setStatus(`Print failed: ${err.message}`); }
  }
  async function handlePdfDownload(){ try{ setStatus('Generating PDF...'); unplacedLabels.clear(); let ok=await generatePdf(); if(!ok) return; setStatus('Downloaded PDF.'+labelWarningText()); }catch(err){ setStatus(`PDF failed: ${err.message}`); } }
  async function handleDocxDownload(){ try{ setStatus('Generating DOCX...'); unplacedLabels.clear(); let ok=await generateDocxExact(); if(!ok) return; setStatus('Downloaded DOCX.'+labelWarningText()); }catch(err){ setStatus(`DOCX failed: ${err.message}`); } }
  async function handlePsdDownload(){ try{ setStatus('Generating PSD...'); let ok=await generatePsdZip(); if(!ok) return; setStatus('Downloaded PSD ZIP.'); }catch(err){ setStatus(`PSD failed: ${err.message}`); } }

  function escapeHtml(str){ return str.replace(/[&<>]/g, m=>m==='&'?'&amp;':m==='<'?'&lt;':'&gt;'); }
  function refreshTemplateSelect(){ elements.templateSelect.innerHTML=''; findAllTemplates().forEach(t=>{ let opt=document.createElement('option'); opt.value=t.id; opt.textContent=t.label; elements.templateSelect.appendChild(opt); }); elements.templateSelect.value=state.settings.templateId; }
  function refreshCustomTemplateList(){
    const container=document.getElementById('customTemplateList');
    const custom=getCustomTemplates();
    if(!custom.length){ container.innerHTML='<div class="muted" style="text-align:center;">No custom layouts yet.<br>Arrange frames and click Save.</div>'; return; }
    container.innerHTML='';
    custom.forEach(t=>{
      const div=document.createElement('div'); div.className='template-item';
      div.innerHTML=`<span class="template-name">${escapeHtml(t.label)}</span><div class="template-actions"><button class="edit-template secondary" data-id="${t.id}">Edit</button><button class="delete-template secondary" data-id="${t.id}">Remove</button></div>`;
      container.appendChild(div);
    });
    container.querySelectorAll('.edit-template').forEach(btn=>btn.addEventListener('click',()=>loadTemplateIntoEditor(btn.getAttribute('data-id'))));
    container.querySelectorAll('.delete-template').forEach(btn=>btn.addEventListener('click',()=>{ if(confirm('Delete this layout?')) deleteCustomTemplate(btn.getAttribute('data-id')); }));
  }
  function deleteCustomTemplate(templateId){
    let list=getCustomTemplates().filter(t=>t.id!==templateId);
    saveCustomTemplates(list); refreshTemplateSelect(); refreshCustomTemplateList();
    if(state.settings.templateId===templateId){
      state.settings.templateId=BUILTIN_TEMPLATES[0].id;
      elements.templateSelect.value=BUILTIN_TEMPLATES[0].id;
      saveMeta(); updateLayoutInfo(); renderPreviews();
    }
  }

  let editorFrames = [];
  let editorSize = { outerW:65, outerH:95, innerW:55, innerH:75, offsetX:5, offsetY:5 };
  let editorPaperId = 'a4p';
  let editorOrientation = 'portrait';
  let editingTemplateId = null;
  let selectedFrameIndex = -1;
  let editorScale = 1;
  const MIN_OUTER_MM = 15;
  const MIN_INNER_MM = 5;
  let sizeLocked = false;
  let altPressTimer = null;
  const ALT_LONG_PRESS_MS = 550;

  function toggleSizeLock(){ sizeLocked=!sizeLocked; applySizeLockUI(); }
  function applySizeLockUI(){
    ['outerW','outerH','innerW','innerH'].forEach(id=>{ const el=document.getElementById(id); if(el) el.disabled=sizeLocked; });
    document.querySelectorAll('.frame-resize-handle,.photo-resize-handle').forEach(h=>h.classList.toggle('handle-locked',sizeLocked));
    const indicator=document.getElementById('sizeLockIndicator');
    if(indicator){
      indicator.classList.toggle('locked',sizeLocked);
      indicator.textContent=sizeLocked ? '🔒 Size locked — hold Alt to unlock' : 'Hold Alt for a second to lock this size';
    }
  }
  function setupAltLongPressLock(){
    document.addEventListener('keydown',e=>{
      if(e.key!=='Alt'||e.repeat||altPressTimer) return;
      altPressTimer=setTimeout(()=>{ toggleSizeLock(); altPressTimer=null; },ALT_LONG_PRESS_MS);
    });
    document.addEventListener('keyup',e=>{
      if(e.key!=='Alt') return;
      if(altPressTimer){ clearTimeout(altPressTimer); altPressTimer=null; }
    });
    window.addEventListener('blur',()=>{ if(altPressTimer){ clearTimeout(altPressTimer); altPressTimer=null; } });
  }

  function toDisplayUnit(mm){ return state.settings.unit==='in' ? mm/MM_PER_INCH : mm; }
  function toMmUnit(val){ return state.settings.unit==='in' ? val*MM_PER_INCH : val; }
  function unitLabel(){ return state.settings.unit==='in' ? 'in' : 'mm'; }

  function computeEditorScale(dims){ return Math.min(320/dims.wMm, 420/dims.hMm); }
  function clampInnerToOuter(){
    editorSize.innerW=Math.min(editorSize.innerW, Math.max(MIN_INNER_MM, editorSize.outerW-editorSize.offsetX));
    editorSize.innerH=Math.min(editorSize.innerH, Math.max(MIN_INNER_MM, editorSize.outerH-editorSize.offsetY));
    editorSize.offsetX=Math.min(Math.max(0,editorSize.offsetX), Math.max(0,editorSize.outerW-editorSize.innerW));
    editorSize.offsetY=Math.min(Math.max(0,editorSize.offsetY), Math.max(0,editorSize.outerH-editorSize.innerH));
  }

  let editorTab = 'size';
  let sizeEditorScale = 1;
  const SIZE_VIEW_W = 320, SIZE_VIEW_H = 380;

  function switchEditorTab(tab){
    editorTab=tab;
    const isSize=tab==='size';
    document.getElementById('tabSizeBtn').classList.toggle('active',isSize); document.getElementById('tabSizeBtn').setAttribute('aria-selected',String(isSize)); document.getElementById('tabArrangeBtn').setAttribute('aria-selected',String(!isSize));
    document.getElementById('tabArrangeBtn').classList.toggle('active',!isSize);
    document.getElementById('sizeTabPanel').classList.toggle('tab-hidden',!isSize);
    document.getElementById('arrangeTabPanel').classList.toggle('tab-hidden',isSize);
    document.getElementById('sizeRightPanel').classList.toggle('tab-hidden',!isSize);
    document.getElementById('arrangeRightPanel').classList.toggle('tab-hidden',isSize);
    if(isSize) renderSizeSheet(); else renderArrangeSheet();
  }

  function computeSizeEditorScale(){ return Math.min((SIZE_VIEW_W-40)/editorSize.outerW, (SIZE_VIEW_H-40)/editorSize.outerH); }

  function renderSizeSheet(){
    sizeEditorScale=computeSizeEditorScale();
    const wrap=document.getElementById('sizeSheet');
    wrap.style.width=`${SIZE_VIEW_W}px`;
    wrap.style.height=`${SIZE_VIEW_H}px`;
    wrap.innerHTML='';
    const outerWpx=editorSize.outerW*sizeEditorScale, outerHpx=editorSize.outerH*sizeEditorScale;
    const div=document.createElement('div');
    div.className='arrange-frame selected';
    div.style.left=`${(SIZE_VIEW_W-outerWpx)/2}px`;
    div.style.top=`${(SIZE_VIEW_H-outerHpx)/2}px`;
    div.style.width=`${outerWpx}px`;
    div.style.height=`${outerHpx}px`;
    div.innerHTML=`<div class="frame-resize-handle" title="Drag to resize the polaroid"></div>`;
    div.querySelector('.frame-resize-handle').addEventListener('mousedown',e=>{ e.stopPropagation(); e.preventDefault(); if(sizeLocked) return; startResizeOuterSize(); });
    const overlay=document.createElement('div');
    overlay.className='photo-overlay';
    overlay.style.left=`${editorSize.offsetX*sizeEditorScale}px`;
    overlay.style.top=`${editorSize.offsetY*sizeEditorScale}px`;
    overlay.style.width=`${editorSize.innerW*sizeEditorScale}px`;
    overlay.style.height=`${editorSize.innerH*sizeEditorScale}px`;
    overlay.innerHTML=`<div class="photo-resize-handle" title="Drag to resize the photo area"></div>`;
    overlay.addEventListener('mousedown',e=>{ if(e.target.closest('.photo-resize-handle')) return; e.stopPropagation(); e.preventDefault(); startDragPhotoSize(); });
    overlay.querySelector('.photo-resize-handle').addEventListener('mousedown',e=>{ e.stopPropagation(); e.preventDefault(); if(sizeLocked) return; startResizeInnerSize(); });
    div.appendChild(overlay);
    wrap.appendChild(div);
    applySizeLockUI();
    refreshSizeInputs();
  }

  function boxesOverlap(a,b,tolerance){ return a.minX<b.maxX-tolerance && a.maxX>b.minX+tolerance && a.minY<b.maxY-tolerance && a.maxY>b.minY+tolerance; }
  function computeOverlappingFrameIndices(){
    const layoutLike={ outerW:editorSize.outerW, outerH:editorSize.outerH };
    const boxes=editorFrames.map(f=>frameBoundingBoxMm(f,layoutLike));
    const overlapping=new Set();
    for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++){ if(boxesOverlap(boxes[i],boxes[j],0.5)){ overlapping.add(i); overlapping.add(j); } }
    return overlapping;
  }
  function renderArrangeSheet(){
    const paper=findPaperById(editorPaperId);
    const dims=orientedPaperDims(paper,editorOrientation);
    editorScale=computeEditorScale(dims);
    const sheet=document.getElementById('arrangeSheet');
    sheet.style.width=`${dims.wMm*editorScale}px`;
    sheet.style.height=`${dims.hMm*editorScale}px`;
    sheet.innerHTML='';
    const pBtn=document.getElementById('orientationPortraitBtn'), lBtn=document.getElementById('orientationLandscapeBtn');
    if(pBtn) pBtn.classList.toggle('active',editorOrientation==='portrait');
    if(lBtn) lBtn.classList.toggle('active',editorOrientation==='landscape');
    if(selectedFrameIndex<0 && editorFrames.length) selectedFrameIndex=0;
    if(selectedFrameIndex>=editorFrames.length) selectedFrameIndex=editorFrames.length-1;
    const overlapping=computeOverlappingFrameIndices();
    editorFrames.forEach((f,i)=>{
      const div=document.createElement('div');
      div.className='arrange-frame'+(i===selectedFrameIndex?' selected':'')+(overlapping.has(i)?' overlap-warning':'');
      if(overlapping.has(i)) div.title='This polaroid overlaps another one — they will overlap in the printed output too.';
      div.style.left=`${f.x*editorScale}px`;
      div.style.top=`${f.y*editorScale}px`;
      div.style.width=`${editorSize.outerW*editorScale}px`;
      div.style.height=`${editorSize.outerH*editorScale}px`;
      div.style.transform=`rotate(${f.rotation||0}deg)`;
      div.innerHTML=`<span class="frame-index">${i+1}</span><button type="button" class="frame-del-btn">×</button><div class="frame-rotate-handle" title="Drag to rotate the polaroid"></div><div class="frame-resize-handle" title="Size is set in step 1 — dragging here won't change it"></div>`;
      div.addEventListener('mousedown',e=>{
        if(e.target.closest('.frame-del-btn')||e.target.closest('.frame-resize-handle')||e.target.closest('.frame-rotate-handle')||e.target.closest('.photo-overlay')) return;
        selectedFrameIndex=i;
        startDragFrame(e,i);
      });
      div.querySelector('.frame-del-btn').addEventListener('click',e=>{ e.stopPropagation(); removeFrame(i); });
      div.querySelector('.frame-resize-handle').addEventListener('mousedown',e=>{ e.stopPropagation(); e.preventDefault(); selectedFrameIndex=i; startNoopDrag(); });
      div.querySelector('.frame-rotate-handle').addEventListener('mousedown',e=>{ e.stopPropagation(); e.preventDefault(); selectedFrameIndex=i; startRotateFrame(e,i); });
      if(i===selectedFrameIndex){
        const overlay=document.createElement('div');
        overlay.className='photo-overlay';
        overlay.style.left=`${editorSize.offsetX*editorScale}px`;
        overlay.style.top=`${editorSize.offsetY*editorScale}px`;
        overlay.style.width=`${editorSize.innerW*editorScale}px`;
        overlay.style.height=`${editorSize.innerH*editorScale}px`;
        overlay.innerHTML=`<div class="photo-resize-handle" title="Size is set in step 1 — dragging here won't change it"></div>`;
        overlay.addEventListener('mousedown',e=>{ if(e.target.closest('.photo-resize-handle')) return; e.stopPropagation(); e.preventDefault(); startNoopDrag(); });
        overlay.querySelector('.photo-resize-handle').addEventListener('mousedown',e=>{ e.stopPropagation(); e.preventDefault(); startNoopDrag(); });
        div.appendChild(overlay);
      }
      sheet.appendChild(div);
    });
    const countEl=document.getElementById('frameCountText');
    const baseText=`${editorFrames.length} photo${editorFrames.length===1?'':'s'} on this layout`;
    countEl.textContent = overlapping.size>0 ? `${baseText} — ⚠ ${overlapping.size} overlapping, they will overlap when printed` : baseText;
    countEl.classList.toggle('warning',overlapping.size>0);
    refreshSizeInputs();
  }

  function startNoopDrag(){
    function onMove(){}
    function onUp(){ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); }
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }
  /* ---- Center snap (lock) with guide lines ---- */
  let centerSnap=true;
  const SNAP_PX=6;
  function snapToCenter(pos,size,target,scale){ return Math.abs(pos+size/2-target)<=SNAP_PX/scale ? target-size/2 : pos; }
  function isCentered(pos,size,target){ return Math.abs(pos+size/2-target)<0.01; }
  function clearSnapGuides(){ document.querySelectorAll('.snap-guide').forEach(g=>g.remove()); }
  function showSnapGuides(host,v,h){
    if(!host) return;
    host.querySelectorAll('.snap-guide').forEach(g=>g.remove());
    if(v){ const g=document.createElement('div'); g.className='snap-guide snap-guide-v'; host.appendChild(g); }
    if(h){ const g=document.createElement('div'); g.className='snap-guide snap-guide-h'; host.appendChild(g); }
  }
  function startDragFrame(e,i){
    e.preventDefault();
    const paper=findPaperById(editorPaperId);
    const dims=orientedPaperDims(paper,editorOrientation);
    const startX=e.clientX, startY=e.clientY, orig={...editorFrames[i]};
    function onMove(ev){
      const dxMm=(ev.clientX-startX)/editorScale, dyMm=(ev.clientY-startY)/editorScale;
      let nx=Math.min(Math.max(0,orig.x+dxMm), Math.max(0,dims.wMm-editorSize.outerW));
      let ny=Math.min(Math.max(0,orig.y+dyMm), Math.max(0,dims.hMm-editorSize.outerH));
      let vHit=false, hHit=false;
      if(centerSnap && !(ev.ctrlKey||ev.metaKey)){
        nx=snapToCenter(nx,editorSize.outerW,dims.wMm/2,editorScale);
        ny=snapToCenter(ny,editorSize.outerH,dims.hMm/2,editorScale);
        vHit=isCentered(nx,editorSize.outerW,dims.wMm/2); hHit=isCentered(ny,editorSize.outerH,dims.hMm/2);
      }
      editorFrames[i]={...orig,x:nx,y:ny};
      renderArrangeSheet();
      showSnapGuides(document.getElementById('arrangeSheet'),vHit,hHit);
    }
    function onUp(){ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); clearSnapGuides(); }
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }
  function startResizeOuterSize(){
    if(sizeLocked) return;
    const paper=findPaperById(editorPaperId);
    const dims=orientedPaperDims(paper,editorOrientation);
    let startX=null, startY=null, startW=editorSize.outerW, startH=editorSize.outerH;
    function onMove(ev){
      if(startX===null){ startX=ev.clientX; startY=ev.clientY; }
      const dW=(ev.clientX-startX)/sizeEditorScale, dH=(ev.clientY-startY)/sizeEditorScale;
      editorSize.outerW=Math.min(Math.max(MIN_OUTER_MM, startW+dW), dims.wMm);
      editorSize.outerH=Math.min(Math.max(MIN_OUTER_MM, startH+dH), dims.hMm);
      clampInnerToOuter();
      clampAllFrames();
      renderSizeSheet();
    }
    function onUp(){ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); }
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }
  function startDragPhotoSize(){
    let startX=null, startY=null, orig={x:editorSize.offsetX,y:editorSize.offsetY};
    function onMove(ev){
      if(startX===null){ startX=ev.clientX; startY=ev.clientY; }
      const dxMm=(ev.clientX-startX)/sizeEditorScale, dyMm=(ev.clientY-startY)/sizeEditorScale;
      editorSize.offsetX=Math.min(Math.max(0,orig.x+dxMm), Math.max(0,editorSize.outerW-editorSize.innerW));
      editorSize.offsetY=Math.min(Math.max(0,orig.y+dyMm), Math.max(0,editorSize.outerH-editorSize.innerH));
      let vHit=false, hHit=false;
      if(centerSnap && !(ev.ctrlKey||ev.metaKey)){
        editorSize.offsetX=snapToCenter(editorSize.offsetX,editorSize.innerW,editorSize.outerW/2,sizeEditorScale);
        editorSize.offsetY=snapToCenter(editorSize.offsetY,editorSize.innerH,editorSize.outerH/2,sizeEditorScale);
        vHit=isCentered(editorSize.offsetX,editorSize.innerW,editorSize.outerW/2); hHit=isCentered(editorSize.offsetY,editorSize.innerH,editorSize.outerH/2);
      }
      renderSizeSheet();
      showSnapGuides(document.querySelector('#sizeSheet .arrange-frame'),vHit,hHit);
    }
    function onUp(){ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); clearSnapGuides(); }
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }
  function startResizeInnerSize(){
    if(sizeLocked) return;
    let startX=null, startY=null, startW=editorSize.innerW, startH=editorSize.innerH;
    function onMove(ev){
      if(startX===null){ startX=ev.clientX; startY=ev.clientY; }
      const dW=(ev.clientX-startX)/sizeEditorScale, dH=(ev.clientY-startY)/sizeEditorScale;
      editorSize.innerW=Math.min(Math.max(MIN_INNER_MM, startW+dW), editorSize.outerW-editorSize.offsetX);
      editorSize.innerH=Math.min(Math.max(MIN_INNER_MM, startH+dH), editorSize.outerH-editorSize.offsetY);
      renderSizeSheet();
    }
    function onUp(){ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); }
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }
  function startRotateFrame(e,i){
    const sheetEl=document.getElementById('arrangeSheet');
    const rect=sheetEl.getBoundingClientRect();
    const f=editorFrames[i];
    const cx=rect.left+(f.x+editorSize.outerW/2)*editorScale;
    const cy=rect.top+(f.y+editorSize.outerH/2)*editorScale;
    const startRotation=f.rotation||0;
    const startAngle=Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI;
    function onMove(ev){
      const angle=Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI;
      let newRotation=startRotation+(angle-startAngle);
      if(ev.shiftKey) newRotation=Math.round(newRotation/15)*15;
      editorFrames[i].rotation=newRotation;
      renderArrangeSheet();
    }
    function onUp(){ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); }
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
  }
  function removeFrame(i){ editorFrames.splice(i,1); if(selectedFrameIndex===i) selectedFrameIndex=-1; else if(selectedFrameIndex>i) selectedFrameIndex--; renderArrangeSheet(); }
  function addFrame(){
    const paper=findPaperById(editorPaperId); const dims=orientedPaperDims(paper,editorOrientation);
    const n=editorFrames.length, step=8, base=2;
    let x=base+(n%6)*step, y=base+Math.floor(n/6)*step;
    x=Math.min(x,Math.max(0,dims.wMm-editorSize.outerW));
    y=Math.min(y,Math.max(0,dims.hMm-editorSize.outerH));
    editorFrames.push({x,y,rotation:0}); selectedFrameIndex=editorFrames.length-1; renderArrangeSheet();
  }
  function duplicateSelectedFrame(){
    if(selectedFrameIndex<0) return;
    const paper=findPaperById(editorPaperId); const dims=orientedPaperDims(paper,editorOrientation);
    const src=editorFrames[selectedFrameIndex];
    let x=Math.min(src.x+6,Math.max(0,dims.wMm-editorSize.outerW));
    let y=Math.min(src.y+6,Math.max(0,dims.hMm-editorSize.outerH));
    editorFrames.push({x,y,rotation:src.rotation||0}); selectedFrameIndex=editorFrames.length-1; renderArrangeSheet();
  }
  function deleteSelectedFrame(){ if(selectedFrameIndex>=0) removeFrame(selectedFrameIndex); }
  function clearFrames(){ editorFrames=[]; selectedFrameIndex=-1; renderArrangeSheet(); }
  function clampAllFrames(){
    const paper=findPaperById(editorPaperId); const dims=orientedPaperDims(paper,editorOrientation);
    const maxX=Math.max(0,dims.wMm-editorSize.outerW), maxY=Math.max(0,dims.hMm-editorSize.outerH);
    editorFrames=editorFrames.map(f=>({...f, x:Math.min(Math.max(0,f.x),maxX), y:Math.min(Math.max(0,f.y),maxY)}));
  }

  function autoArrangeFrames() {
    const paper = findPaperById(editorPaperId);
    const dims = orientedPaperDims(paper, editorOrientation);
    const marginX = 5, marginY = 4;
    const gapX = 2.5, gapY = 2.0;
    
    let currentX = marginX;
    let currentY = marginY;
    let rowHeight = 0;
    
    editorFrames.forEach(f => {
      const rot = Math.abs(f.rotation || 0) % 180;
      const isRotated = rot > 45 && rot < 135;
      const effW = isRotated ? editorSize.outerH : editorSize.outerW;
      const effH = isRotated ? editorSize.outerW : editorSize.outerH;
      
      if (currentX + effW > dims.wMm - marginX) {
        currentX = marginX;
        currentY += rowHeight + gapY;
        rowHeight = 0;
      }
      
      f.x = currentX + effW/2 - editorSize.outerW/2;
      f.y = currentY + effH/2 - editorSize.outerH/2;
      
      currentX += effW + gapX;
      rowHeight = Math.max(rowHeight, effH);
    });
    
    renderArrangeSheet();
  }

  function refreshSizeInputs(){
    const d=mm=>toDisplayUnit(mm).toFixed(2);
    document.getElementById('outerW').value=d(editorSize.outerW);
    document.getElementById('outerH').value=d(editorSize.outerH);
    document.getElementById('innerW').value=d(editorSize.innerW);
    document.getElementById('innerH').value=d(editorSize.innerH);
    document.getElementById('offsetX').value=d(editorSize.offsetX);
    document.getElementById('offsetY').value=d(editorSize.offsetY);
    const rotEl=document.getElementById('frameRotation');
    if(rotEl){ const r=(selectedFrameIndex>=0&&editorFrames[selectedFrameIndex])?(editorFrames[selectedFrameIndex].rotation||0):0; rotEl.value=Math.round(r*10)/10; }
    document.querySelectorAll('.unit-abbr').forEach(el=>el.textContent=unitLabel());
  }
  function onSizeInputChange(){
    if(sizeLocked) return;
    editorSize.outerW=toMmUnit(parseFloat(document.getElementById('outerW').value)||0);
    editorSize.outerH=toMmUnit(parseFloat(document.getElementById('outerH').value)||0);
    editorSize.innerW=toMmUnit(parseFloat(document.getElementById('innerW').value)||0);
    editorSize.innerH=toMmUnit(parseFloat(document.getElementById('innerH').value)||0);
    editorSize.offsetX=toMmUnit(parseFloat(document.getElementById('offsetX').value)||0);
    editorSize.offsetY=toMmUnit(parseFloat(document.getElementById('offsetY').value)||0);
    clampInnerToOuter();
    clampAllFrames();
    renderSizeSheet();
  }
  function onRotationInputChange(){
    if(selectedFrameIndex<0||!editorFrames[selectedFrameIndex]) return;
    editorFrames[selectedFrameIndex].rotation=parseFloat(document.getElementById('frameRotation').value)||0;
    renderArrangeSheet();
  }
  function setOrientation(o){
    if(editorOrientation===o) return;
    editorOrientation=o;
    clampAllFrames();
    renderArrangeSheet();
  }
  function setUnit(u){
    if(state.settings.unit===u) return;
    const oldUnit=state.settings.unit;
    ['customPaperW','customPaperH'].forEach(id=>{
      const el=document.getElementById(id);
      if(!el||el.value==='') return;
      const raw=parseFloat(el.value);
      if(isNaN(raw)) return;
      const mm=oldUnit==='in' ? raw*MM_PER_INCH : raw;
      el.value=(u==='in' ? mm/MM_PER_INCH : mm).toFixed(2);
    });
    state.settings.unit=u;
    document.getElementById('unitInBtn').classList.toggle('active',u==='in');
    document.getElementById('unitMmBtn').classList.toggle('active',u==='mm');
    refreshSizeInputs();
    refreshPaperSelectEditor();
    updateLayoutInfo();
    saveMeta();
  }

  function paperDisplayLabel(p){ return `${p.label} — ${toDisplayUnit(p.wMm).toFixed(2)}×${toDisplayUnit(p.hMm).toFixed(2)} ${unitLabel()}`; }
  function refreshCustomPaperUnitUI(){
    const hint=document.getElementById('customPaperUnitHint');
    if(hint) hint.textContent=`Enter custom width & height in ${state.settings.unit==='in'?'inches':'millimeters'}.`;
    const wEl=document.getElementById('customPaperW'), hEl=document.getElementById('customPaperH');
    if(wEl) wEl.placeholder=`Width (${unitLabel()})`;
    if(hEl) hEl.placeholder=`Height (${unitLabel()})`;
  }
  function refreshPaperSelectEditor(){
    const sel=document.getElementById('paperSelectEditor'); sel.innerHTML='';
    findAllPapers().forEach(p=>{ const opt=document.createElement('option'); opt.value=p.id; opt.textContent=paperDisplayLabel(p); sel.appendChild(opt); });
    sel.value=editorPaperId;
    document.getElementById('removePaperBtn').style.display=getCustomPapers().some(p=>p.id===editorPaperId)?'inline-flex':'none';
    refreshCustomPaperUnitUI();
  }
  function onPaperSelectChange(){ editorPaperId=document.getElementById('paperSelectEditor').value; clampAllFrames(); renderArrangeSheet(); refreshPaperSelectEditor(); }
  function saveCustomPaper(){
    const name=document.getElementById('customPaperName').value.trim();
    const w=toMmUnit(parseFloat(document.getElementById('customPaperW').value)||0);
    const h=toMmUnit(parseFloat(document.getElementById('customPaperH').value)||0);
    if(!name||w<=0||h<=0){ alert('Enter a paper name and a valid width and height.'); return; }
    const id='paper_'+Date.now();
    const list=getCustomPapers();
    list.push({id,label:`${name} (custom)`,wMm:w,hMm:h});
    saveCustomPapers(list);
    editorPaperId=id;
    document.getElementById('customPaperName').value='';
    document.getElementById('customPaperW').value='';
    document.getElementById('customPaperH').value='';
    clampAllFrames(); renderArrangeSheet(); refreshPaperSelectEditor();
  }
  function removeCustomPaper(){
    const list=getCustomPapers().filter(p=>p.id!==editorPaperId);
    saveCustomPapers(list); editorPaperId='a4p';
    clampAllFrames(); renderArrangeSheet(); refreshPaperSelectEditor();
  }

  /* ---- Layout editor: undo / redo ---- */
  let editHistory=[], editHistoryIdx=-1;
  const EDIT_HISTORY_MAX=100;
  function editSnapshotData(){ return JSON.stringify({ size:editorSize, frames:editorFrames, paper:editorPaperId, orient:editorOrientation }); }
  function updateUndoRedoUI(){
    const u=document.getElementById('undoBtn'), rd=document.getElementById('redoBtn');
    if(u) u.disabled=editHistoryIdx<=0;
    if(rd) rd.disabled=editHistoryIdx>=editHistory.length-1;
  }
  function pushEditHistory(){
    const data=editSnapshotData();
    if(editHistory[editHistoryIdx] && editHistory[editHistoryIdx].data===data) return;
    editHistory.length=editHistoryIdx+1;
    editHistory.push({ data, sel:selectedFrameIndex });
    if(editHistory.length>EDIT_HISTORY_MAX) editHistory.shift();
    editHistoryIdx=editHistory.length-1;
    updateUndoRedoUI();
  }
  function resetEditHistory(){ editHistory=[]; editHistoryIdx=-1; pushEditHistory(); }
  function restoreEditHistory(i){
    const entry=editHistory[i]; if(!entry) return;
    const d=JSON.parse(entry.data);
    editorSize=d.size; editorFrames=d.frames; editorPaperId=d.paper; editorOrientation=d.orient;
    selectedFrameIndex=Math.min(entry.sel,editorFrames.length-1);
    editHistoryIdx=i;
    refreshPaperSelectEditor(); refreshSizeInputs(); renderSizeSheet(); renderArrangeSheet();
    updateUndoRedoUI();
  }
  function undoEdit(){ pushEditHistory(); if(editHistoryIdx>0) restoreEditHistory(editHistoryIdx-1); }
  function redoEdit(){ if(editHistoryIdx<editHistory.length-1) restoreEditHistory(editHistoryIdx+1); }

  function loadTemplateIntoEditor(templateId){
    const all=findAllTemplates();
    const t=all.find(x=>x.id===templateId)||all[0];
    editingTemplateId=BUILTIN_TEMPLATES.some(b=>b.id===t.id) ? null : t.id;
    editorPaperId=t.paperId;
    editorOrientation=t.orientation || paperNativeOrientation(findPaperById(t.paperId));
    editorSize={ outerW:t.outerW, outerH:t.outerH, innerW:t.innerW, innerH:t.innerH, offsetX:t.offsetX, offsetY:t.offsetY };
    editorFrames=t.frames.map(f=>({...f}));
    selectedFrameIndex=editorFrames.length ? 0 : -1;
    document.getElementById('templateNameInput').value=editingTemplateId ? t.label : '';
    refreshPaperSelectEditor();
    renderSizeSheet();
    renderArrangeSheet();
    resetEditHistory();
  }
  function newTemplateDraft(){ editingTemplateId=null; document.getElementById('templateNameInput').value=''; clearFrames(); switchEditorTab('size'); resetEditHistory(); }
  function saveCurrentAsTemplate(){
    let name=document.getElementById('templateNameInput').value.trim();
    if(!name) name=(prompt('Enter layout name:','My Layout')||'').trim();
    if(!name) return;
    if(!editorFrames.length){ alert('Add at least one polaroid frame before saving.'); return; }
    let custom=getCustomTemplates();
    const payload={ label:name, paperId:editorPaperId, orientation:editorOrientation, outerW:editorSize.outerW, outerH:editorSize.outerH, innerW:editorSize.innerW, innerH:editorSize.innerH, offsetX:editorSize.offsetX, offsetY:editorSize.offsetY, frames:editorFrames.map(f=>({...f})) };
    if(editingTemplateId && custom.some(t=>t.id===editingTemplateId)){
      custom=custom.map(t=>t.id===editingTemplateId?{...payload,id:editingTemplateId}:t);
    } else {
      const id='custom_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
      payload.id=id; custom.push(payload); editingTemplateId=id;
    }
    saveCustomTemplates(custom);
    refreshTemplateSelect(); refreshCustomTemplateList();
    state.settings.templateId=editingTemplateId;
    elements.templateSelect.value=editingTemplateId;
    saveMeta(); updateLayoutInfo(); renderPreviews();
    alert(`Layout "${name}" saved.`);
  }

  const templateModal = document.getElementById('templateManagerModal');
  function openTemplateModal(){
    loadTemplateIntoEditor(state.settings.templateId);
    document.getElementById('unitInBtn').classList.toggle('active',state.settings.unit==='in');
    document.getElementById('unitMmBtn').classList.toggle('active',state.settings.unit==='mm');
    refreshCustomTemplateList();
    switchEditorTab('size');
    templateModal.classList.remove('hidden');
  }
  function closeTemplateModal(){ templateModal.classList.add('hidden'); }

  /* ---- Captions panel UI ---- */
  function renderCaptions(){
    const list=document.getElementById('captionsList'); if(!list) return;
    const caps=state.settings.captions||[], n=computeLayout().perPage;
    list.innerHTML='';
    if(!caps.length){ list.innerHTML='<p class="muted caption-empty">No captions yet. Add one to print text below a polaroid.</p>'; return; }
    const opt=(v,l,sel)=>`<option value="${v}"${sel?' selected':''}>${l}</option>`;
    caps.forEach((cap,ci)=>{
      const card=document.createElement('div'); card.className='caption-card'; card.dataset.id=cap.id;
      const fonts=Object.entries(CAPTION_FONTS).map(([k,f])=>opt(k,f.label,cap.font===k)).join('');
      let slots=opt('all','All polaroids',cap.slot==='all');
      for(let i=0;i<n;i++) slots+=opt(String(i),`Polaroid ${i+1}`,String(cap.slot)===String(i));
      if(cap.slot!=='all'&&Number(cap.slot)>=n) slots+=opt(String(cap.slot),`Polaroid ${Number(cap.slot)+1} (not in this layout)`,true);
      const al=['left','center','right'].map(a=>opt(a,a[0].toUpperCase()+a.slice(1),(cap.align||'center')===a)).join('');
      card.innerHTML=`<div class="caption-head"><strong>Caption ${ci+1}</strong><button type="button" class="secondary caption-remove" data-remove="1" aria-label="Remove caption ${ci+1}">✕</button></div>
        <div class="caption-grid">
          <label class="control caption-wide"><span>Text</span><input type="text" data-f="text" maxlength="80" placeholder="Text below the polaroid"></label>
          <label class="control"><span>Font</span><select data-f="font">${fonts}</select></label>
          <label class="control"><span>Size (pt)</span><input type="number" data-f="size" min="4" max="60" step="0.5" value="${Number(cap.size)||10}"></label>
          <label class="control"><span>Color</span><input type="color" data-f="color" value="${cap.color||'#000000'}"></label>
          <label class="control"><span>Polaroid</span><select data-f="slot">${slots}</select></label>
          <label class="control"><span>Pages (all, or e.g. 1,3-4)</span><input type="text" data-f="pages" placeholder="all"></label>
          <label class="control"><span>Align</span><select data-f="align">${al}</select></label>
          <label class="control"><span>Move left / right (mm)</span><input type="number" data-f="dx" step="0.5" value="${Number(cap.dx)||0}"></label>
          <label class="control"><span>Move up / down (mm)</span><input type="number" data-f="dy" step="0.5" value="${Number(cap.dy)||0}"></label>
        </div>`;
      card.querySelector('[data-f="text"]').value=cap.text||'';
      card.querySelector('[data-f="pages"]').value=cap.pages||'';
      list.appendChild(card);
    });
  }
  let captionSaveTimer=null;
  function wireCaptions(){
    const list=document.getElementById('captionsList');
    const onEdit=e=>{
      const f=e.target.dataset&&e.target.dataset.f, card=e.target.closest('.caption-card'); if(!f||!card) return;
      const cap=state.settings.captions.find(c=>c.id===card.dataset.id); if(!cap) return;
      const v=e.target.value;
      cap[f]=(f==='size')?(parseFloat(v)||10):(f==='dx'||f==='dy')?(parseFloat(v)||0):v;
      clearTimeout(captionSaveTimer); captionSaveTimer=setTimeout(saveMeta,300);
    };
    list.addEventListener('input',onEdit); list.addEventListener('change',onEdit);
    list.addEventListener('click',e=>{
      if(!e.target.closest('[data-remove]')) return;
      const id=e.target.closest('.caption-card').dataset.id;
      state.settings.captions=state.settings.captions.filter(c=>c.id!==id); renderCaptions(); saveMeta();
    });
    document.getElementById('addCaptionBtn').addEventListener('click',()=>{
      state.settings.captions.push({ id:uuid(), text:'', font:'caveat', size:10, color:'#000000', align:'center', dx:0, dy:0, slot:'all', pages:'' });
      renderCaptions(); saveMeta();
      const inputs=list.querySelectorAll('[data-f="text"]'); if(inputs.length) inputs[inputs.length-1].focus();
    });
  }

  function wireEvents(){
    elements.themeToggle.addEventListener('click',()=>{ state.settings.theme=state.settings.theme==='dark'?'light':'dark'; applyTheme(state.settings.theme); saveMeta(); });
    elements.fileInput.addEventListener('change',async e=>{
      let files=Array.from(e.target.files||[]); if(!files.length) return;
      let owner=await openOwnerModal(files.length);
      if(owner!==null) await addBatch(files,owner); else setStatus('Batch canceled.');
      elements.fileInput.value='';
    });
    elements.previewBtn.addEventListener('click',()=>{ openPreviewModal(); renderPreviews(); });
    let previewResizeTimer=null; window.addEventListener('resize',()=>{ if(elements.modal.classList.contains('hidden')) return; clearTimeout(previewResizeTimer); previewResizeTimer=setTimeout(renderPreviews,120); });
    elements.modalCloseBtn.addEventListener('click',closePreviewModal);
    elements.modalFooterCloseBtn.addEventListener('click',closePreviewModal);
    elements.modalBackdrop.addEventListener('click',closePreviewModal);
    document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!elements.modal.classList.contains('hidden')) closePreviewModal(); });
    elements.modalDownloadBtn.addEventListener('click',handlePdfDownload);
    if(elements.modalPsdBtn) elements.modalPsdBtn.addEventListener('click',handlePsdDownload);
    if(elements.modalDocxBtn) elements.modalDocxBtn.addEventListener('click',handleDocxDownload);
    if(elements.modalPrintBtn) elements.modalPrintBtn.addEventListener('click',handlePrint);
    elements.clearBtn.addEventListener('click',clearAll);
    elements.qualitySelect.addEventListener('change',async e=>{ state.settings.qualityDpi=Number(e.target.value)||600; await saveMeta(); renderPreviews(); });
    elements.templateSelect.addEventListener('change',async e=>{ state.settings.templateId=e.target.value; await saveMeta(); updateLayoutInfo(); renderPreviews(); });
    if(elements.previewZoom) elements.previewZoom.addEventListener('input',handlePreviewZoomChange);

    document.getElementById('manageTemplatesBtn').addEventListener('click',openTemplateModal);
    document.getElementById('closeTemplateBtn').addEventListener('click',closeTemplateModal);
    document.getElementById('closeTemplateManagerBtn').addEventListener('click',closeTemplateModal);
    document.getElementById('tabSizeBtn').addEventListener('click',()=>switchEditorTab('size'));
    document.getElementById('tabArrangeBtn').addEventListener('click',()=>switchEditorTab('arrange'));
    document.getElementById('addFrameBtn').addEventListener('click',addFrame);
    document.getElementById('duplicateFrameBtn').addEventListener('click',duplicateSelectedFrame);
    document.getElementById('deleteFrameBtn').addEventListener('click',deleteSelectedFrame);
    document.getElementById('autoArrangeBtn').addEventListener('click',autoArrangeFrames);
    document.getElementById('clearFramesBtn').addEventListener('click',()=>{ if(confirm('Remove all polaroid frames from this layout?')) clearFrames(); });
    document.getElementById('unitInBtn').addEventListener('click',()=>setUnit('in'));
    document.getElementById('unitMmBtn').addEventListener('click',()=>setUnit('mm'));
    document.getElementById('orientationPortraitBtn').addEventListener('click',()=>setOrientation('portrait'));
    document.getElementById('orientationLandscapeBtn').addEventListener('click',()=>setOrientation('landscape'));
    document.getElementById('paperSelectEditor').addEventListener('change',onPaperSelectChange);
    document.getElementById('savePaperBtn').addEventListener('click',saveCustomPaper);
    document.getElementById('removePaperBtn').addEventListener('click',removeCustomPaper);
    ['outerW','outerH','innerW','innerH','offsetX','offsetY'].forEach(id=>document.getElementById(id).addEventListener('input',onSizeInputChange));
    document.getElementById('frameRotation').addEventListener('input',onRotationInputChange);
    document.getElementById('newTemplateBtn').addEventListener('click',newTemplateDraft);
    document.getElementById('saveTemplateBtn').addEventListener('click',saveCurrentAsTemplate);

    wireCaptions();
    document.getElementById('centerSnapToggle').addEventListener('change',e=>{ centerSnap=e.target.checked; });
    document.getElementById('undoBtn').addEventListener('click',undoEdit);
    document.getElementById('redoBtn').addEventListener('click',redoEdit);
    window.addEventListener('mouseup',()=>{ if(!templateModal.classList.contains('hidden')) pushEditHistory(); });
    templateModal.addEventListener('click',e=>{ if(e.target.closest('.edit-template,#newTemplateBtn')) return; pushEditHistory(); });
    templateModal.addEventListener('change',pushEditHistory);
    document.addEventListener('keydown',e=>{
      if(templateModal.classList.contains('hidden')||!(e.ctrlKey||e.metaKey)||e.altKey) return;
      const t=e.target, k=e.key.toLowerCase();
      if(t&&(t.tagName==='TEXTAREA'||(t.tagName==='INPUT'&&t.type==='text'))) return;
      if(k==='z'&&!e.shiftKey){ e.preventDefault(); undoEdit(); }
      else if((k==='z'&&e.shiftKey)||k==='y'){ e.preventDefault(); redoEdit(); }
    });
    updateUndoRedoUI();
  }

  function populateSelects(){ refreshTemplateSelect(); elements.qualitySelect.value=String(state.settings.qualityDpi); updateLayoutInfo(); }

  async function init(){
    state.settings.theme=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    applyTheme(state.settings.theme);
    populateSelects();
    wireEvents();
    setupAltLongPressLock();
    setCountText();
    setStatus('Initializing...');
    await restoreFromDb();
    renderCaptions();
    if(elements.previewZoom) handlePreviewZoomChange();
    setStatus('Ready.');
  }
  init();
})();