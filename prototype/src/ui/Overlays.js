const W = 540;
const H = 960;
const INPUT_GUARD_MS = 300;
const GRADE_COLORS = { common: 0x9aa0a6, rare: 0x57e389, epic: 0xb57bff, legend: 0xffd966, fallback: 0x6fa8ff };
const GRADE_NAMES = { common: '일반', rare: '희귀', epic: '영웅', legend: '전설', fallback: '대체' };
const cssColor = (n) => `#${n.toString(16).padStart(6, '0')}`;

function makeLayer(scene) {
  const objs = [];
  const openedAt = scene.time.now;
  const state = { destroyed: false };
  // 닫힌 뒤 예약 연출이 뒤늦게 그리는 것은 바로 지운다
  const add = (o, depth = 2001) => {
    if (state.destroyed) {
      o.destroy();
      return o;
    }
    objs.push(o.setScrollFactor(0).setDepth(depth));
    return o;
  };
  add(scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7).setInteractive(), 2000);
  const onTap = (target, fn) => {
    target.setInteractive({ useHandCursor: true });
    target.on('pointerdown', () => {
      if (scene.time.now - openedAt >= INPUT_GUARD_MS) fn();
    });
  };
  return {
    add,
    onTap,
    get destroyed() {
      return state.destroyed;
    },
    destroy: () => {
      state.destroyed = true;
      objs.forEach((o) => o.destroy());
    },
  };
}

function text(layer, scene, x, y, str, size, color = '#ffffff', bold = false) {
  return layer.add(scene.add.text(x, y, str, {
    fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color, align: 'center',
  }).setOrigin(0.5), 2002);
}

function button(layer, scene, y, label, color, onClick) {
  const bg = layer.add(scene.add.rectangle(W / 2, y, 300, 60, color).setStrokeStyle(2, 0xffffff, 0.8));
  text(layer, scene, W / 2, y, label, 22, '#0a0612', true);
  layer.onTap(bg, () => {
    layer.destroy();
    onClick();
  });
}

export function showCardPicker(scene, cards, ranks, title, onPick) {
  const layer = makeLayer(scene);
  text(layer, scene, W / 2, 250, title, 32, '#9dffb0', true);
  text(layer, scene, W / 2, 292, '하나를 고르세요', 18, '#c9b8ff');
  const cardW = 150;
  const cardH = 230;
  const gap = 18;
  const startX = W / 2 - ((cards.length - 1) * (cardW + gap)) / 2;
  cards.forEach((card, i) => {
    const x = startX + i * (cardW + gap);
    const y = 460;
    const color = card.isItem ? parseInt(card.color.replace('#', ''), 16) : GRADE_COLORS[card.grade];
    const bg = layer.add(scene.add.rectangle(x, y, cardW, cardH, card.isItem ? 0x241a10 : 0x1b1230).setStrokeStyle(4, color));
    text(layer, scene, x, y - 92, card.isItem ? `아이템 · ${GRADE_NAMES[card.grade]}` : GRADE_NAMES[card.grade], 14, cssColor(color), true);
    if (card.isItem) layer.add(scene.add.rectangle(x, y - 70, 20, 20, color).setAngle(45), 2002);
    layer.add(scene.add.text(x, y - 45, card.name, {
      fontSize: '19px', fontStyle: 'bold', color: '#ffffff', align: 'center', wordWrap: { width: cardW - 16 },
    }).setOrigin(0.5), 2002);
    const rank = ranks[card.id] || 0;
    if (!card.instant && !card.isItem) text(layer, scene, x, y + 5, `Lv ${rank} → ${rank + 1}`, 14, '#ffd966');
    if (card.isItem) text(layer, scene, x, y + 5, '조합 재료?', 13, '#ffd966');
    layer.add(scene.add.text(x, y + 55, card.desc, {
      fontSize: '14px', color: '#d8d0ee', align: 'center', wordWrap: { width: cardW - 20 },
    }).setOrigin(0.5), 2002);
    layer.onTap(bg, () => {
      layer.destroy();
      onPick(card);
    });
  });
  return layer;
}

export function showWaveClear(scene, info, { onContinue, onRetire }) {
  const layer = makeLayer(scene);
  text(layer, scene, W / 2, 250, `웨이브 ${info.wave} 클리어!`, 32, '#ffd966', true);
  text(layer, scene, W / 2, 330, `이번 판 마나시드  ${info.totalExp}`, 19);
  text(layer, scene, W / 2, 368, `지금 마무리하면 → 결정화 마나시드 ${info.seeds}개`, 19, '#9dffb0', true);
  text(layer, scene, W / 2, 406,
    `코어 ${Math.ceil(info.coreHp)}/${info.coreMaxHp}  (이어가면 +${Math.round(info.coreRecover * 100)}%)`, 17, '#9ff0bb');
  text(layer, scene, W / 2, 460, '※ 사망하거나 코어가 파괴되면\n이번 판 마나시드는 전부 사라집니다', 15, '#ff9a9a');
  button(layer, scene, 580, '이어가기', 0x57e389, onContinue);
  button(layer, scene, 660, '마무리 (환수)', 0xffd966, onRetire);
  return layer;
}

export function showResult(scene, info, { onRestart, onLobby }) {
  const titles = { retire: '마무리 성공', dead: '쓰러졌습니다', coreLost: '코어 파괴' };
  const layer = makeLayer(scene);
  text(layer, scene, W / 2, 250, titles[info.outcome], 34, info.outcome === 'retire' ? '#9dffb0' : '#ff7b7b', true);
  text(layer, scene, W / 2, 330, `도달 웨이브  ${info.wave}`, 20);
  text(layer, scene, W / 2, 370,
    info.outcome === 'retire' ? `결정화 마나시드  +${info.seeds}` : `마나시드 ${info.totalExp} 소멸`,
    20, info.outcome === 'retire' ? '#9dffb0' : '#ff9a9a', true);
  text(layer, scene, W / 2, 430, `보유 결정화 마나시드  ${info.save.seeds}`, 18, '#c9b8ff');
  text(layer, scene, W / 2, 462, `최고 웨이브  ${info.save.bestWave}`, 18, '#c9b8ff');
  button(layer, scene, 580, '바로 다시', 0x57e389, onRestart);
  button(layer, scene, 660, '로비로 (성장·기록)', 0x6fa8ff, onLobby);
  return layer;
}

const HUB_TABS = [
  { id: 'maintain', name: '정비' },
  { id: 'gacha', name: '가챠' },
  { id: 'enhance', name: '강화' },
  { id: 'skills', name: '스킬' },
  { id: 'awaken', name: '각성' },
];

// 판 안 거점: 이번 판 마나시드로 정비·가챠·강화·스킬 정비. ctx는 GameScene이 계산해서 넘긴다.
export function showHub(scene, tab, ctx, h) {
  const layer = makeLayer(scene);
  const tabs = HUB_TABS.filter((t) => t.id !== 'awaken' || ctx.awakenUnlocked);
  text(layer, scene, W / 2, 96, '거점', 30, '#ffd966', true);
  text(layer, scene, W / 2, 134, `마나시드 ${ctx.available}  ·  강화석 ${ctx.stones}`, 17, '#9dffb0', true);
  text(layer, scene, W / 2, 158, `※ 쓴 만큼 마무리 환수액이 줄어듭니다 (지금 마무리하면 결정화 ${ctx.payout})`, 12, '#ff9a9a');
  if (ctx.goal) text(layer, scene, W / 2, 184, ctx.goal, 13, '#ffd966', true);
  const tabW = W / tabs.length;
  tabs.forEach((t, i) => {
    const on = t.id === tab;
    const x = tabW * (i + 0.5);
    const bg = layer.add(scene.add.rectangle(x, 222, tabW - 12, 42, on ? 0xffd966 : 0x3a3150).setStrokeStyle(2, 0xffffff, 0.6));
    text(layer, scene, x, 222, t.name, 17, on ? '#0a0612' : '#ffffff', true);
    if (!on) layer.onTap(bg, () => { layer.destroy(); h.onTab(t.id); });
  });
  if (ctx.notice) text(layer, scene, W / 2, 262, ctx.notice, 15, '#66d9ff', true);
  const row = (y, title, desc, price, ok, onClick, sub) => {
    layer.add(scene.add.rectangle(W / 2, y, W - 40, 82, 0x1b1230).setStrokeStyle(2, ok ? 0xffd966 : 0x3a3150));
    layer.add(scene.add.text(40, y - 28, title, { fontSize: '18px', fontStyle: 'bold', color: '#ffffff' }), 2002);
    layer.add(scene.add.text(40, y - 2, desc, { fontSize: '13px', color: '#c9b8ff', wordWrap: { width: 300 } }), 2002);
    if (sub) layer.add(scene.add.text(40, y + 20, sub, { fontSize: '12px', color: '#8f86a8' }), 2002);
    if (price === null) {
      text(layer, scene, W - 95, y, '최대', 16, '#57e389', true);
      return;
    }
    const bg = layer.add(scene.add.rectangle(W - 95, y, 120, 46, ok ? 0x57e389 : 0x3a3150));
    text(layer, scene, W - 95, y, price, 15, ok ? '#0a0612' : '#8a8199', true);
    if (ok) layer.onTap(bg, () => { layer.destroy(); onClick(); });
  };
  const top = 330;
  if (tab === 'maintain') {
    ctx.maintain.forEach((m, i) => row(top + i * 92, m.name, m.desc, `◆ ${m.price}`, m.ok, () => h.onMaintain(m.item), m.sub));
  } else if (tab === 'gacha') {
    const g = ctx.gacha;
    const kind = g.relic ? '유물' : '아이템';
    text(layer, scene, W / 2, 320, g.poolSize ? `지금 나올 수 있는 ${kind} ${g.poolSize}종` : `더 뽑을 ${kind}이 없다`, 16, '#c9b8ff');
    const desc = g.relic ? '누구나 쓰는 유물 중 하나 — 강화석으로 +5까지' : '지금 갈 수 있는 조합의 재료 중 하나';
    if (g.poolSize) row(400, `${kind} 뽑기`, desc, `◆ ${g.price}`, g.ok, h.onGacha, `이번 준비 ${g.used}/${g.limit}`);
    text(layer, scene, W / 2, 500, '가진 아이템', 16, '#ffd966', true);
    layer.add(scene.add.text(W / 2, 530, g.owned.length ? g.owned.join('  ·  ') : '없음', {
      fontSize: '15px', color: '#ffffff', align: 'center', wordWrap: { width: W - 60 },
    }).setOrigin(0.5, 0), 2002);
  } else if (tab === 'enhance') {
    if (!ctx.enhance.length) text(layer, scene, W / 2, 360, '강화할 아이템이 없다', 17, '#8f86a8');
    const per = 5;
    const pages = Math.ceil(ctx.enhance.length / per);
    const page = Math.min(ctx.enhancePage, Math.max(0, pages - 1));
    if (pages > 1) {
      text(layer, scene, W / 2, 800, `${page + 1} / ${pages}`, 16, '#c9b8ff', true);
      [[-1, W / 2 - 110, '◀ 이전'], [1, W / 2 + 110, '다음 ▶']].forEach(([d, x, label]) => {
        const to = page + d;
        if (to < 0 || to >= pages) return;
        const bg = layer.add(scene.add.rectangle(x, 800, 120, 40, 0x3a3150).setStrokeStyle(2, 0xffffff, 0.6));
        text(layer, scene, x, 800, label, 15, '#ffffff', true);
        layer.onTap(bg, () => { layer.destroy(); h.onPage(to); });
      });
    }
    ctx.enhance.slice(page * per, page * per + per).forEach((e, i) => row(top + i * 92, `${e.name} +${e.level}`, e.desc, e.price === null ? null : `◆${e.price} · 석${e.stones}`, e.ok, () => h.onEnhance(e.id), e.sub));
  } else if (tab === 'awaken') {
    const a = ctx.awaken;
    text(layer, scene, W / 2, 360, `각성 Lv ${a.level}`, 24, '#ffd966', true);
    text(layer, scene, W / 2, 400, `각성치 ${a.points}/${a.per} (다음 +1까지 ${a.per - a.points} 강화석)`, 16, '#c9b8ff');
    text(layer, scene, W / 2, 432, `공격력 +${Math.round(a.level * a.atkMul * 100)}%`, 15, '#9dffb0', true);
    row(500, '강화석 투자', '가진 강화석을 모두 각성치로 전환한다', '투자', ctx.stones > 0, h.onInvestAwaken, `가진 강화석 ${ctx.stones}`);
  } else {
    if (!ctx.skills.length) text(layer, scene, W / 2, 360, '올릴 카드가 없다', 17, '#8f86a8');
    ctx.skills.slice(0, 6).forEach((k, i) => {
      const y = top + i * 84;
      layer.add(scene.add.rectangle(W / 2, y, W - 40, 74, 0x1b1230).setStrokeStyle(1, 0x5a3f8a));
      layer.add(scene.add.text(40, y - 24, `${k.name}  Lv ${k.rank}/${k.max}`, { fontSize: '17px', fontStyle: 'bold', color: '#ffffff' }), 2002);
      layer.add(scene.add.text(40, y + 1, k.desc, { fontSize: '12px', color: '#c9b8ff', wordWrap: { width: W - 250 } }), 2002);
      const up = layer.add(scene.add.rectangle(W - 150, y, 100, 42, k.upOk ? 0x57e389 : 0x3a3150));
      text(layer, scene, W - 150, y, k.upPrice === null ? '최대' : `+1 ◆${k.upPrice}`, 14, k.upOk ? '#0a0612' : '#8a8199', true);
      if (k.upOk) layer.onTap(up, () => { layer.destroy(); h.onTune(k.id, 1); });
      if (k.rank > 0) {
        const down = layer.add(scene.add.rectangle(W - 55, y, 70, 42, 0xff8787));
        text(layer, scene, W - 55, y, '스킬 레벨 -1', 10, '#0a0612', true);
        layer.onTap(down, () => { layer.destroy(); h.onTuneDownRequest(k); });
      }
    });
  }
  button(layer, scene, 880, '닫기', 0x6fa8ff, h.onClose);
  return layer;
}

// 스킬 레벨 하향 확인: 실수로 레벨을 내려 마나시드만 날리지 않도록 한 번 더 확인
export function showTuneDownConfirm(scene, k, onConfirm, onCancel) {
  const layer = makeLayer(scene);
  text(layer, scene, W / 2, 380, k.name, 22, '#ffffff', true);
  text(layer, scene, W / 2, 426, '정말 한 수준 내릴까?', 18, '#ffffff');
  text(layer, scene, W / 2, 460, `마나시드 ${k.refund} 환급`, 18, '#9dffb0', true);
  const box = (x, label, color, textColor, onClick) => {
    const bg = layer.add(scene.add.rectangle(x, 560, 140, 56, color).setStrokeStyle(2, 0xffffff, 0.8));
    text(layer, scene, x, 560, label, 18, textColor, true);
    layer.onTap(bg, () => { layer.destroy(); onClick(); });
  };
  box(W / 2 - 80, '취소', 0x3a3150, '#ffffff', onCancel);
  box(W / 2 + 80, '확정', 0xff8787, '#0a0612', onConfirm);
  return layer;
}

export function showTransform(scene, info, onClose) {
  const layer = makeLayer(scene);
  const color = parseInt(info.color.replace('#', ''), 16);
  const ring = layer.add(scene.add.circle(W / 2, 330, 70).setStrokeStyle(6, color, 1), 2002);
  scene.tweens.add({ targets: ring, scale: 1.25, alpha: 0.5, duration: 700, yoyo: true, repeat: -1 });
  layer.add(scene.add.circle(W / 2, 330, 40, color, 0.9), 2002);
  text(layer, scene, W / 2, 190, info.first ? '숨겨진 전직 발견!' : '전직!', 22, '#ffd966', true);
  text(layer, scene, W / 2, 440, info.tier, 16, '#c9b8ff');
  text(layer, scene, W / 2, 478, info.name, 32, cssColor(color), true);
  layer.add(scene.add.text(W / 2, 540, info.desc, {
    fontSize: '16px', color: '#ffffff', align: 'center', wordWrap: { width: W - 80 },
  }).setOrigin(0.5), 2002);
  if (info.reward) {
    const r = text(layer, scene, W / 2, 598, `보상 스킬  ${info.reward}`, 20, '#ffd43b', true).setScale(0);
    scene.tweens.add({ targets: r, scale: 1, duration: 420, delay: 250, ease: 'Back.easeOut' });
  }
  if (info.refund) text(layer, scene, W / 2, 618, `못 쓴 수련 환급 — 마나시드 +${info.refund}`, 13, '#9dffb0');
  text(layer, scene, W / 2, 634, `${info.routeLabel || '조합'}: ${info.items.join(' + ')}`, 15, '#9dffb0');
  if (info.first) text(layer, scene, W / 2, 662, '기록과 도감 보상에 새 전직이 올랐다', 14, '#b57bff');
  button(layer, scene, 720, '계속', color, onClose);
  return layer;
}

const RAINBOW = [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0xb197fc];

// 강화 연출: 긴장(흔들림·빛 모으기) → 결과(성공·대성공·실패·하락)
export function showEnhance(scene, info, onDone) {
  const layer = makeLayer(scene);
  const cx = W / 2;
  const cy = 420;
  const color = parseInt(info.color.replace('#', ''), 16);
  text(layer, scene, cx, 200, `${info.name}  +${info.from} → +${Math.min(info.max, info.from + 1)}`, 24, '#ffffff', true);
  text(layer, scene, cx, 236, `성공 확률 ${Math.round(info.rate * 100)}%`, 17, info.rate < 0.6 ? '#ff8787' : '#ffd966', true);
  const glow = layer.add(scene.add.circle(cx, cy, 70, color, 0.25), 2001);
  const gem = layer.add(scene.add.rectangle(cx, cy, 56, 56, color).setAngle(45).setStrokeStyle(4, 0xffffff, 0.9), 2002);
  scene.tweens.add({ targets: glow, scale: 1.8, alpha: 0.55, duration: 1100, ease: 'Sine.easeIn' });
  scene.tweens.add({ targets: gem, x: cx + 4, duration: 50, yoyo: true, repeat: 20, ease: 'Sine.easeInOut' });
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14;
    const spark = layer.add(scene.add.circle(cx + Math.cos(a) * 190, cy + Math.sin(a) * 190, 4, 0xffffff), 2002);
    scene.tweens.add({ targets: spark, x: cx, y: cy, alpha: 0.2, duration: 950, delay: i * 20, ease: 'Quad.easeIn' });
  }
  const burst = (colors, count, dist) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = dist * (0.6 + Math.random() * 0.6);
      const p = layer.add(scene.add.circle(cx, cy, 3 + Math.random() * 4, colors[i % colors.length]), 2003);
      scene.tweens.add({ targets: p, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, alpha: 0, duration: 700 + Math.random() * 400, ease: 'Cubic.easeOut' });
    }
  };
  const ring = (c, delay, size = 3) => {
    const r = layer.add(scene.add.circle(cx, cy, 40).setStrokeStyle(6, c, 1), 2003);
    scene.tweens.add({ targets: r, scale: size, alpha: 0, duration: 650, delay, ease: 'Cubic.easeOut' });
  };
  const headline = (str, c, size) => {
    const t = text(layer, scene, cx, 560, str, size, c, true).setScale(0);
    scene.tweens.add({ targets: t, scale: 1, duration: 380, ease: 'Back.easeOut' });
  };
  scene.time.delayedCall(1100, () => {
    if (layer.destroyed) return;
    const r = info.result;
    if (r === 'great') {
      RAINBOW.forEach((c, i) => ring(c, i * 90, 3.6));
      burst(RAINBOW, 44, 260);
      scene.cameras.main.flash(260, 255, 255, 255);
      scene.cameras.main.shake(380, 0.018);
      headline(`대성공!!  +${info.to}`, '#ffd43b', 40);
      gem.setFillStyle(0xffffff);
    } else if (r === 'success') {
      ring(0xffd43b, 0);
      ring(0xffffff, 120);
      burst([0xffd43b, 0xffffff, color], 28, 200);
      scene.cameras.main.flash(180, 255, 230, 150);
      scene.cameras.main.shake(180, 0.01);
      headline(`+${info.to} 강화 성공!`, '#ffd43b', 34);
    } else {
      gem.setFillStyle(0x495057);
      glow.setFillStyle(0x343a40, 0.4);
      const g = layer.add(scene.add.graphics(), 2003);
      g.lineStyle(3, 0x0a0612, 1).lineBetween(cx - 14, cy - 22, cx + 4, cy).lineBetween(cx + 4, cy, cx - 6, cy + 20).lineBetween(cx + 4, cy, cx + 20, cy + 6);
      for (let i = 0; i < 6; i++) {
        const puff = layer.add(scene.add.circle(cx + (Math.random() - 0.5) * 60, cy, 12 + Math.random() * 10, 0x868e96, 0.6), 2003);
        scene.tweens.add({ targets: puff, y: cy - 90 - Math.random() * 40, alpha: 0, scale: 1.8, duration: 1000 });
      }
      scene.cameras.main.shake(140, 0.006);
      if (r === 'drop') headline(`실패… 단계 하락  +${info.from} → +${info.to}`, '#ff6b6b', 26);
      else if (r === 'guarded') headline('실패… 장인의 손이 단계를 지켰다', '#8ce99a', 24);
      else headline('실패…', '#adb5bd', 32);
    }
    const failed = r === 'fail' || r === 'drop' || r === 'guarded';
    scene.time.delayedCall(750, () => !layer.destroyed && button(layer, scene, 700, '확인', failed ? 0x868e96 : 0xffd43b, () => onDone()));
  });
  return layer;
}
