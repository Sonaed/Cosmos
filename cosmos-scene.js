/* Decorative sky: no fake notes, timers, network calls or continuous animation. */
(() => {
  const main = document.getElementById('main');
  const sky = document.createElement('canvas');
  sky.className = 'cosmos-sky'; sky.setAttribute('aria-hidden', 'true');
  main.prepend(sky);
  const ctx = sky.getContext('2d');
  const button = document.createElement('button');
  button.className = 'control'; button.textContent = '✧ Ambiance';
  button.title = 'Afficher ou masquer les étoiles et les nébuleuses';
  document.querySelector('.graph-explore').append(button);
  let enabled = true;
  try { enabled = localStorage.getItem('cosmos-ambience') !== 'off'; } catch {}
  const refresh = () => {
    main.classList.toggle('quiet-sky', !enabled);
    button.classList.toggle('on', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  };
  button.onclick = () => {
    enabled = !enabled; refresh();
    try { localStorage.setItem('cosmos-ambience', enabled ? 'on' : 'off'); } catch {}
  };
  refresh();
  let seed = 419;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const stars = Array.from({length:240}, () => ({x:random(),y:random(),r:.3+random()*.9,a:.12+random()*.55}));
  window.renderCosmosSky = (yaw = 0, pitch = 0) => {
    if (!ctx) return;
    const w = main.clientWidth, h = main.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (sky.width !== Math.round(w*dpr) || sky.height !== Math.round(h*dpr)) {
      sky.width = Math.round(w*dpr); sky.height = Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,w,h);
    for (const star of stars) {
      const x = ((star.x*w + yaw*star.r*13)%w+w)%w;
      const y = ((star.y*h + pitch*star.r*13)%h+h)%h;
      ctx.fillStyle = `rgba(185,208,255,${star.a})`;
      ctx.beginPath();ctx.arc(x,y,star.r,0,Math.PI*2);ctx.fill();
      if (star.r > 1.13) {
        ctx.strokeStyle = `rgba(166,200,255,${star.a*.3})`;
        ctx.beginPath();ctx.moveTo(x-4,y);ctx.lineTo(x+4,y);ctx.moveTo(x,y-4);ctx.lineTo(x,y+4);ctx.stroke();
      }
    }
    ctx.save();ctx.translate(w*.5,h*.52);ctx.rotate(-.32);
    ctx.strokeStyle='#809de017';ctx.lineWidth=1;
    for (const size of [.32,.48,.64]) {ctx.beginPath();ctx.ellipse(0,0,w*size,h*size*.64,0,0,Math.PI*2);ctx.stroke();}
    ctx.restore();
  };
  new ResizeObserver(() => window.renderCosmosSky()).observe(main);
  window.renderCosmosSky();
})();
