// main.js — SKYPOST entry point: boot, fixed-step main loop, HUD and screens.
// Wiring only: physics lives in flight-model.js, flow/scoring in game-state.js, the 3D
// scene in world-renderer.js. This file connects them to the canvas, keyboard/mouse and
// the clock. No assets, no network: everything is drawn or synthesized in code.

import { VIEW, PALETTE, PLANE, RUNWAY, LAND } from './config.js';
import { clamp, wrapAngle, fmtInt, toDegrees360 } from './math3.js';
import { Input, readFlightControls } from './input.js';
import { createGame, resetSortie, togglePause, tick, REFUEL_RINGS } from './game-state.js';
import { createPlane } from './flight-model.js';
import { objectiveInfo, buildShowcase } from './missions.js';
import { drawWorld } from './world-renderer.js';

function boot() {
  const canvas = document.getElementById('game');
  const statusEl = document.getElementById('status');
  if (!canvas || !statusEl) return;
  const ctx = canvas.getContext('2d');
  const input = new Input();
  input.attach(canvas);
  const g = createGame();

  // ?showcase=flight|approach|landing — deterministic frozen frame for screenshots.
  const scName = new URLSearchParams(location.search).get('showcase');
  let frozen = false;
  if (scName) {
    const sc = buildShowcase(scName);
    if (sc) {
      g.plane = createPlane({ ...sc.plane });
      g.rings = sc.rings;
      for (const r of g.rings) r.refuel = REFUEL_RINGS.has(r.id);
      g.phys.rings = g.rings;
      g.state = 'flight';
      frozen = true;
    }
  }

  // --- tiny synthesized audio (WebAudio oscillators only; M mutes) ---------------
  const beeper = createBeeper(() => g.muted);

  // --- edge-triggered menu actions ------------------------------------------------
  function handleActions() {
    if (input.action('mute')) g.muted = !g.muted;
    switch (g.state) {
      case 'title':
        if (input.action('start')) { beeper.ensure(); resetSortie(g); }
        break;
      case 'flight':
      case 'rollout':
        if (input.action('pause')) togglePause(g);
        else if (input.action('retry')) resetSortie(g);
        else if (input.action('title')) g.state = 'title';
        break;
      case 'pause':
        if (input.action('pause')) togglePause(g);
        else if (input.action('retry')) resetSortie(g);
        else if (input.action('title')) g.state = 'title';
        break;
      case 'crash':
        if (input.action('retry')) resetSortie(g);
        else if (input.action('title')) g.state = 'title';
        break;
      case 'result':
        if (input.action('retry')) resetSortie(g);
        else if (input.action('title')) g.state = 'title';
        break;
    }
  }

  function onEvent(ev) {
    switch (ev.type) {
      case 'ring': {
        const refuel = REFUEL_RINGS.has(ev.id);
        beeper.beep(refuel ? 1180 : 880, 0.09, 'sine', 0.05);
        if (refuel) beeper.beep(1560, 0.14, 'sine', 0.045, 0.09);
        break;
      }
      case 'clip': beeper.beep(200, 0.12, 'square', 0.05); break;
      case 'scrape': case 'bounce': beeper.beep(160, 0.15, 'square', 0.05); break;
      case 'stall': beeper.beep(520, 0.1, 'triangle', 0.05); break;
      case 'fuelout': beeper.beep(440, 0.25, 'sawtooth', 0.05); break;
      case 'touchdown': beeper.beep(240, 0.25, 'triangle', 0.06); break;
      case 'win':
        beeper.beep(660, 0.12, 'sine', 0.05);
        beeper.beep(880, 0.12, 'sine', 0.05, 0.12);
        beeper.beep(1320, 0.22, 'sine', 0.05, 0.24);
        break;
      case 'dead': beeper.beep(110, 0.6, 'sawtooth', 0.07); break;
      case 'warn': beeper.beep(700, 0.08, 'square', 0.04); break;
    }
  }

  // Losing keyboard focus mid-flight must never leave the plane flying blind.
  const autoPause = () => {
    if (g.state === 'flight' || g.state === 'rollout') togglePause(g);
  };
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });

  // --- main loop: fixed-step physics via game-state tick, render every frame ------
  let last = -1;
  let statusT = 0;
  function frame(now) {
    if (last < 0) last = now;
    const dt = clamp((now - last) / 1000, 0, 0.1); // tab-switch safe; tick() substeps at 1/120 s
    last = now;
    handleActions();
    if (!frozen) {
      const flying = g.state === 'flight' || g.state === 'rollout';
      const ctrl = flying ? readFlightControls(input, g.plane, dt) : null;
      for (const ev of tick(g, ctrl, dt)) onEvent(ev);
    }
    render(now / 1000);
    statusT += dt;
    if (statusT >= 0.25) { statusT = 0; updateStatus(); }
    input.endFrame();
    requestAnimationFrame(frame);
  }

  // --- drawing helpers --------------------------------------------------------------
  function text(s, x, y, color, size = 16, align = 'left', bold = false) {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.shadowBlur = 0;
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = PALETTE.hudPanel;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = PALETTE.hudEdge;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  function bar(x, y, w, h, frac, color, label) {
    text(label, x, y + h - 2, 'rgba(230,225,255,0.85)', 11);
    const bx = x + 74;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, y, w - 74, h);
    ctx.fillStyle = color;
    ctx.fillRect(bx, y, (w - 74) * clamp(frac, 0, 1), h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, y + 0.5, w - 75, h - 1);
  }

  function drawHUD(t) {
    const p = g.plane;
    const passed = g.rings.filter((r) => r.passed).length;
    const obj = objectiveInfo(p, g.rings, RUNWAY);
    const heading = toDegrees360(p.yaw);

    // top-left: flight data
    panel(14, 12, 302, 128);
    text(`速度 ${p.speed.toFixed(0)} m/s (${Math.round(p.speed * 3.6)} km/h)`, 26, 36, PALETTE.hudCyan, 17, 'left', true);
    text(`高度 ${Math.max(0, p.y).toFixed(0)} m    沈下 ${(-p.vy).toFixed(1)} m/s`, 26, 58, '#e8ddff', 15);
    text(`方位 ${String(Math.round(heading)).padStart(3, '0')}°`, 26, 78, PALETTE.hudCyan, 15, 'left', true);
    bar(26, 90, 276, 12, p.throttle, PALETTE.hudAmber, 'スロットル');
    const fuelColor = p.engineOut ? ((t % 0.7) < 0.35 ? PALETTE.hudRed : '#7a2a24') : p.fuel < 25 ? PALETTE.hudAmber : PALETTE.hudGreen;
    bar(26, 108, 276, 12, p.fuel / PLANE.fuelMax, fuelColor, p.engineOut ? '燃料切れ' : '燃料');
    bar(26, 126, 276, 12, p.damage / 100, p.damage > 60 ? PALETTE.hudRed : 'rgba(255,150,120,0.8)', '損傷');

    // top-right: score and objective
    panel(VIEW.W - 316, 12, 302, 92);
    text(`スコア ${fmtInt(g.score)}`, VIEW.W - 304, 38, PALETTE.hudAmber, 19, 'left', true);
    text(`風標リング ${passed}/${g.rings.length}`, VIEW.W - 304, 62, passed === g.rings.length ? PALETTE.hudGreen : '#e8ddff', 15);
    const label = obj.kind === 'ring'
      ? `風標 ${obj.id + 1}/${obj.total}${g.rings[obj.id] && g.rings[obj.id].refuel ? ' (燃料補給)' : ''}`
      : '断崖の滑走路';
    text(`${label} まで ${Math.round(obj.dist)} m`, VIEW.W - 304, 84, PALETTE.hudCyan, 15);

    // top-center: bearing arrow to the objective
    const rel = wrapAngle(obj.bearing - p.yaw);
    const cx = VIEW.W / 2, cy = 58;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(clamp(rel, -1.4, 1.4));
    ctx.fillStyle = obj.kind === 'ring' ? PALETTE.ringNext : PALETTE.hudAmber;
    ctx.beginPath();
    ctx.moveTo(0, -11); ctx.lineTo(9, 8); ctx.lineTo(0, 3); ctx.lineTo(-9, 8);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // center warnings
    if (p.stall && t % 0.8 < 0.5) text('失速警告 — 速度を回復せよ', cx, 150, PALETTE.hudRed, 26, 'center', true);
    if (p.engineOut) text('燃料切れ — 滑空で帰還せよ', cx, 186, PALETTE.hudAmber, 20, 'center', true);
    if (p.damage >= 70 && t % 1 < 0.6) text(`機体損傷 ${Math.round(p.damage)}%`, cx, 218, PALETTE.hudRed, 18, 'center', true);

    // landing window readout on final approach
    if (obj.kind === 'runway' && obj.dist < 1500) {
      text(`着陸目安: 速度 ${LAND.vMin}〜${LAND.vMax} m/s ・ 沈下率 ${LAND.sinkMax} m/s 以下 ・ 沈下 ${(-p.vy).toFixed(1)} m/s`,
        cx, VIEW.H - 84, PALETTE.hudAmber, 15, 'center');
    }

    // transient message
    if (g.msg && g.msgAge < 4) {
      ctx.globalAlpha = clamp(1.4 - g.msgAge / 3, 0, 1);
      text(g.msg, cx, VIEW.H - 52, '#ffe9c9', 18, 'center', true);
      ctx.globalAlpha = 1;
    }

    // controls hint
    text('W/S スロットル ・ A/D 旋回 ・ マウス 姿勢 ・ Shift ブースト ・ Space ブレーキ ・ P 一時停止 ・ R リトライ',
      16, VIEW.H - 14, 'rgba(220,215,240,0.6)', 12);
  }

  function overlay(alpha) {
    ctx.fillStyle = `rgba(10,8,22,${alpha})`;
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);
  }

  function drawTitle(t) {
    overlay(0.66);
    const cx = VIEW.W / 2;
    text('SKYPOST', cx, 168, PALETTE.hudAmber, 84, 'center', true);
    text('〜風紋の配達便〜', cx, 222, '#ffe9c9', 30, 'center');
    const lines = [
      '夕暮れの島しょ海岸を郵便機で飛び、',
      '7つの風標リングをくぐり抜けて断崖の滑走路へ着陸せよ。',
      '3番目と5番目のリングは燃料補給リング。燃料が切れても滑空できる。',
    ];
    lines.forEach((s, i) => text(s, cx, 296 + i * 30, '#e8ddff', 19, 'center'));
    const ctrls = [
      'W / S : スロットル ・ A / D : 旋回 (マウス位置でも姿勢制御)',
      'Shift : ブースト ・ Space : ブレーキ ・ P : 一時停止 ・ M : ミュート',
    ];
    ctrls.forEach((s, i) => text(s, cx, 414 + i * 28, PALETTE.hudCyan, 17, 'center'));
    text('Enter キー または クリック で出発', cx, 512, PALETTE.hudGreen, 24, 'center', true);
    text(`着陸の目安: 速度 ${LAND.vMin}〜${LAND.vMax} m/s ・ 沈下率 ${LAND.sinkMax} m/s 以下 ・ 方位を合わせて接地`,
      cx, 636, 'rgba(255,220,180,0.85)', 15, 'center');
  }

  function drawPause() {
    overlay(0.6);
    const cx = VIEW.W / 2;
    text('一時停止中', cx, VIEW.H / 2 - 40, PALETTE.hudAmber, 44, 'center', true);
    text('P : 再開 ・ R : リトライ ・ T : タイトルへ', cx, VIEW.H / 2 + 16, '#e8ddff', 20, 'center');
  }

  function drawCrash(t) {
    ctx.fillStyle = `rgba(140,16,10,${0.18 + 0.1 * Math.sin(t * 9)})`;
    ctx.fillRect(0, 0, VIEW.W, VIEW.H);
    text(g.msg || '墜落した', VIEW.W / 2, VIEW.H / 2 - 10, PALETTE.hudRed, 34, 'center', true);
  }

  function drawResult() {
    overlay(0.72);
    const cx = VIEW.W / 2;
    const r = g.result;
    if (r && r.win) {
      text('配達完了!', cx, 190, PALETTE.hudGreen, 56, 'center', true);
      const s = r.score;
      const rows = [
        ['着陸ボーナス', s.parts.landing],
        ['リング得点', s.parts.ring],
        ['タイムボーナス', s.parts.timeBonus],
        ['残燃料ボーナス', s.parts.fuelBonus],
        ['損傷ペナルティ', -s.parts.damagePenalty],
      ];
      rows.forEach(([k, v], i) => {
        text(k, cx - 190, 268 + i * 32, '#e8ddff', 20, 'right');
        text(String(v), cx + 190, 268 + i * 32, v < 0 ? PALETTE.hudRed : PALETTE.hudAmber, 20, 'left', true);
      });
      text(`スコア ${s.total}`, cx, 268 + rows.length * 32 + 14, PALETTE.hudAmber, 30, 'center', true);
      text(`ランク ${r.rank}`, cx, 268 + rows.length * 32 + 66, PALETTE.ringNext, 44, 'center', true);
    } else {
      text('配達失敗…', cx, 230, PALETTE.hudRed, 52, 'center', true);
      text(r ? String(r.reason) : '', cx, 300, '#ffe9c9', 22, 'center');
      const passed = g.rings.filter((q) => q.passed).length;
      text(`風標リング ${passed}/${g.rings.length} 個通過 ・ スコア ${g.score}`, cx, 344, '#e8ddff', 18, 'center');
    }
    text('R : もう一度挑戦 ・ T : タイトルへ', cx, VIEW.H - 120, PALETTE.hudCyan, 20, 'center', true);
  }

  function render(t) {
    drawWorld(ctx, g.plane, g.world, g.rings, RUNWAY, t);
    if (g.state !== 'title') drawHUD(t);
    if (g.state === 'title') drawTitle(t);
    else if (g.state === 'pause') drawPause();
    else if (g.state === 'crash') drawCrash(t);
    else if (g.state === 'result') drawResult();
  }

  // --- screen-reader status line ----------------------------------------------------
  function updateStatus() {
    const p = g.plane;
    const heading = toDegrees360(p.yaw);
    let s;
    if (g.state === 'title') s = 'SKYPOST タイトル画面。Enterキーまたはクリックで出発。';
    else if (g.state === 'pause') s = '一時停止中。Pキーで再開。';
    else if (g.state === 'result') {
      s = g.result && g.result.win
        ? `配達完了。スコア ${g.result.score.total}、ランク ${g.result.rank}。Rキーでリトライ。`
        : `配達失敗。理由: ${g.result ? g.result.reason : ''}。Rキーでリトライ。`;
    } else {
      const passed = g.rings.filter((r) => r.passed).length;
      s = `方位 ${String(Math.round(heading)).padStart(3, '0')}°、速度 ${Math.round(p.speed * 3.6)} キロメートル毎時、高度 ${Math.max(0, Math.round(p.y))} メートル、` +
        `燃料 ${Math.round(p.fuel)} パーセント、風標リング ${passed} 個のうち ${g.rings.length} 個中 ${passed} 個通過。${g.msg}`;
    }
    statusEl.textContent = s;
  }

  window.__SKYPOST = { g, input };
  window.__SKYPOST_OK = true;
  requestAnimationFrame(frame);
}

// Tiny oscillator beeper: no audio files, created lazily on the first user gesture.
function createBeeper(getMuted) {
  let ac = null;
  function ensure() {
    if (getMuted()) return null;
    if (!ac) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) ac = new AC();
      } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') { ac.resume().catch(() => {}); }
    return ac;
  }
  function beep(freq, dur = 0.08, type = 'sine', vol = 0.04, when = 0) {
    const a = ensure();
    if (!a) return;
    try {
      const o = a.createOscillator();
      const gn = a.createGain();
      o.type = type;
      o.frequency.value = freq;
      const t0 = a.currentTime + when;
      gn.gain.setValueAtTime(vol, t0);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(gn); gn.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* audio is optional */ }
  }
  return { ensure, beep };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
