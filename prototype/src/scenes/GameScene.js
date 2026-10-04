import { Joystick } from '../input/Joystick.js';
import { WaveRun, waveComposition } from '../systems/WaveSystem.js';
import { waveSpecials } from '../systems/WaveGen.js';
import { drawCards, applyCards, maxRank } from '../systems/CardSystem.js';
import { RunProgress, settleRun, saveRunResult, recordEncounter, recordKill, recordDiscovery, loadSave } from '../systems/Progression.js';
import { runModifiers, cardPool, collectionBonus } from '../systems/Shop.js';
import { itemPool, pickItem, matchRecipe, itemStats, enhancePrice, gachaPrice, tunePrice, tuneRefund, rollEnhance, ascendTier, enhanceStones, nextAscend, trainingRefund } from '../systems/Items.js';
import { safeStorage } from '../storage.js';
import { stealRank, returnStolen } from '../systems/Combat.js';
import { lineFor } from '../systems/Story.js';
import { Monsters } from '../game/Monsters.js';
import { Projectiles } from '../game/Projectiles.js';
import { Player } from '../game/Player.js';
import { Crystals } from '../game/Crystals.js';
import { Turrets } from '../game/Turrets.js';
import { Minions } from '../game/Minions.js';
import { ManaSkillRunner } from '../game/ManaSkills.js';
import { TrainingRunner } from '../game/Training.js';
import { Hud } from '../ui/Hud.js';
import { makeTextures, heroScale, floorScale, coreScale } from '../art/Art.js';
import { Banner } from '../ui/Banner.js';
import { ActionButtons } from '../ui/ActionButtons.js';
import { showCardPicker, showWaveClear, showResult, showHub, showTransform, showEnhance, showTuneDownConfirm } from '../ui/Overlays.js';
import { priceFor, canUse, recordUse } from '../systems/Workshop.js';

const SEED_STYLES = {
  green: { color: 0x9dffb0, radius: 5 },
  blue: { color: 0x4dabf7, radius: 7 },
  gold: { color: 0xffd43b, radius: 10 },
};

const hex = (color) => parseInt(color.replace('#', ''), 16);

export class GameScene extends Phaser.Scene {
  constructor(db) {
    super('game');
    this.db = db;
  }

  create(data) {
    const { balance, waves, classes, shop, cards } = this.db;
    const world = balance.world;
    this.storage = safeStorage();
    const save = loadSave(this.storage);
    // 모두 초보자로 시작. 직업·전직은 판 안에서 아이템 조합으로 바뀌고 판이 끝나면 사라진다.
    this.classId = 'novice';
    this.cls = classes[this.classId];
    this.mods = runModifiers(save, shop);
    const collection = collectionBonus(save.discovered, balance);
    this.mods.atk += collection.atk;
    this.mods.hp += collection.hp;
    this.mods.coreHp += collection.coreHp;
    this.collection = collection;
    // 탐험 성장이 판 안 아이템·강화 확률을 바꾼다
    const ib = balance.items;
    this.itemBal = {
      ...balance,
      items: {
        ...ib,
        cardChance: Math.min(0.95, ib.cardChance + this.mods.itemChance),
        partnerMul: ib.partnerMul + this.mods.partnerBonus,
        greatChance: ib.greatChance + this.mods.greatBonus,
        enhanceRates: ib.enhanceRates.map((r) => Math.min(0.99, r + this.mods.enhanceBonus)),
      },
    };
    this.dropGuards = this.mods.dropGuard;
    this.firstItemPending = this.mods.firstItem > 0;
    this.spec = null;
    this.specRecipe = null;
    this.tier = 0;
    this.specStats = {};
    this.owned = {};
    this.pendingTransform = null;
    this.awakenPoints = 0;
    this.cardList = cardPool(cards, save, shop);
    this.giftPending = this.mods.freeCard > 0;
    this.workshopUsed = { prep: {}, run: {} };
    this.runBonus = { skillCdMul: 0 };
    this.barrierWave = 0;
    this.classColor = hex(this.cls.color);
    this.paused = false;
    this.overlay = null;
    this.ended = false;

    this.cameras.main.setBounds(0, 0, world.width, world.height);
    this.drawFloor(world);

    this.baseCoreHp = balance.core.hp;
    const coreHp = Math.round(balance.core.hp * (1 + this.mods.coreHp));
    this.core = { x: world.width / 2, y: world.height / 2, hp: coreHp, maxHp: coreHp, radius: balance.core.radius };
    const coreGlow = this.add.image(this.core.x, this.core.y, 'glow').setScale(2.2).setTint(0x57e389).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
    this.tweens.add({ targets: coreGlow, alpha: 0.6, scale: 2.6, duration: 1200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.add.image(this.core.x, this.core.y - 8, 'core_seed').setScale(0.7 * coreScale()).setDepth(4);

    this.ranks = {};
    this.stats = this.computeStats();
    this.player = { x: this.core.x, y: this.core.y + 90, hp: this.maxHp(), radius: this.cls.radius, attackTimer: 0, swings: 0, hurtFlash: 0, invuln: 0 };
    this.heroScale = heroScale(this.player.radius);
    this.playerSprite = this.add.image(this.player.x, this.player.y, `hero_${this.classId}`).setScale(this.heroScale).setDepth(10);
    this.cameras.main.startFollow(this.playerSprite, true, 0.15, 0.15);

    this.seeds = [];
    this.stolen = [];

    this.run = new WaveRun(waves, balance);
    this.progress = new RunProgress(balance);
    this.stones = 0;
    this.stonesWave = 0;
    this.enhancePage = 0;
    if (collection.startSeeds) this.progress.grant(collection.startSeeds);
    this.monsters = new Monsters(this);
    this.projectiles = new Projectiles(this);
    this.crystals = new Crystals(this);
    this.turrets = new Turrets(this);
    this.minions = new Minions(this);
    this.mana = new ManaSkillRunner(this);
    this.training = new TrainingRunner(this);
    this.starterPending = true;
    this.joystick = new Joystick(this);
    this.hero = new Player(this);
    this.hud = new Hud(this);
    this.banner = new Banner(this);
    this.buttons = new ActionButtons(this);
    this.announceWave();
    if (collection.startItem) {
      const item = pickItem(itemPool(this.db.items, this.db.recipes, this.classId, null, this.owned), this.owned, this.db.recipes, this.itemBal);
      if (item) this.gainItem(item.id);
    }
  }

  // 준비 단계에 이번 웨이브의 정예·보스를 예고
  announceWave() {
    const { waves, balance, monsters, story } = this.db;
    const { elites, boss } = waveSpecials(waveComposition(this.run.wave, waves, balance), monsters);
    const label = (id) => `${story.units[id].title} ${story.units[id].name}`;
    if (boss) this.banner.setWarning(`⚠ 보스 — ${label(boss)}`);
    else if (elites.length) this.banner.setWarning(`⚠ 정예 접근 — ${elites.map(label).join(' · ')}`);
    else this.banner.setWarning('');
  }

  drawFloor(world) {
    makeTextures(this);
    this.add.tileSprite(0, 0, world.width, world.height, 'floor').setOrigin(0).setTileScale(floorScale()).setDepth(-10);
    const g = this.add.graphics().setDepth(-9);
    g.lineStyle(3, 0x5a3f8a, 1).strokeRect(0, 0, world.width, world.height);
  }

  computeStats() {
    const base = {
      atkMul: 1 + this.mods.atk, aspdMul: 1, moveMul: 1 + this.mods.move, magnetMul: 1, maxHpMul: 1 + this.mods.hp,
      arcDeg: this.cls.arcDeg, shock: 0, nearCoreDR: 0, quake: 0,
      critChance: this.cls.critChance, critMul: this.cls.critMul, pierce: this.cls.pierce || 0, extraShots: 0,
      explodeRadius: 0, aoeMul: 1, chainBlast: 0, globalSlow: 0, swordWave: 0, skillCdMul: 1, dashCdMul: 1,
      rangeMul: 1, intervalMul: 1, eliteDmg: 0, burn: 0, berserkAtk: 0, berserkAspd: 0, coreShield: 0,
      dashDamage: 0, killHaste: 0, lifesteal: 0, thorns: 0, lastStand: 0,
      meteor: 0, frost: 0, laser: 0, orbit: 0,
      trainSword: 0, trainBow: 0, trainStaff: 0, trainMagic: 0, trainTech: 0, trainNecro: 0, trainFist: 0,
      comboWindow: 0, ironBody: 0, whiteHeat: 0,
    };
    for (const [k, v] of Object.entries(this.specStats)) base[k] += v;
    for (const [k, v] of Object.entries(this.runBonus || {})) base[k] += v;
    for (const [k, v] of Object.entries(itemStats(this.owned || {}, this.db.items, this.db.balance))) base[k] += v;
    const ascended = Math.max(0, (this.tier || 0) - 2);
    base.atkMul += 0.1 * ascended;
    base.aspdMul += 0.05 * ascended;
    base.atkMul += this.db.balance.awaken.atkMul * this.awakenLevel();
    return applyCards(base, this.ranks, this.db.cards);
  }

  maxHp() {
    return this.cls.hp * this.stats.maxHpMul;
  }

  // 5차 각성: 강화석을 쓴 각성치가 100 모일 때마다 영구(이번 판 한정) 스탯 +1단계, 상한 없음
  awakenLevel() {
    return Math.floor((this.awakenPoints || 0) / this.db.balance.awaken.perLevel);
  }

  update(_time, deltaMs) {
    const dt = Math.min(deltaMs / 1000, 0.05);
    this.hud.update();
    this.buttons.update();
    this.banner.update(dt);
    if (this.paused) return;
    this.hero.move(dt);
    if (this.coreShieldT > 0) this.coreShieldT -= dt;
    const wasPrep = this.run.state === 'prep';
    for (const req of this.run.update(dt)) this.monsters.spawnFromRequest(req);
    if (wasPrep && this.run.state === 'combat') {
      this.banner.setWarning('');
      this.crystals.spawnForWave(this.run.wave);
    }
    this.monsters.update(dt);
    this.projectiles.update(dt);
    this.crystals.update(dt);
    this.hero.combat(dt);
    this.mana.update(dt);
    this.training.update(dt);
    this.turrets.update(dt);
    this.minions.update(dt);
    this.updateSeeds(dt);
    this.checkFlow();
  }

  // ---------- 플레이어 ----------

  isInvulnerable() {
    return this.paused || this.player.invuln > 0;
  }

  hurtPlayer(amount) {
    if (this.isInvulnerable()) return;
    const p = this.player;
    p.hp = Math.max(0, p.hp - this.hero.incomingDamage(amount));
    p.hurtFlash = 0.1;
    this.hero.onHurt();
  }

  shieldCore(seconds) {
    this.coreShieldT = seconds;
    this.ring(this.core.x, this.core.y, 44, 0x57e389);
  }

  damageCore(amount) {
    if (amount <= 0 || this.coreShieldT > 0) return;
    const barrier = this.barrierWave === this.run.wave ? this.db.workshop.find((i) => i.id === 'barrier').effect.amount : 0;
    this.core.hp = Math.max(0, this.core.hp - amount * (1 - barrier));
    this.cameras.main.shake(120, 0.006);
  }

  // 가시 코어: 코어를 때린(공성) 적에게 반사
  onCoreHitBy(m) {
    if (!this.stats.thorns || m.dead) return;
    this.monsters.damage(m, this.stats.thorns, Math.atan2(m.y - this.core.y, m.x - this.core.x), 0);
  }

  // ---------- 정예·보스 훅 ----------

  onUnitSpawn(m) {
    const unit = this.db.story.units[m.id];
    if (!unit) return;
    m.encounter = recordEncounter(this.storage, m.id);
    this.banner.say(unit, lineFor(unit, 'spawn', m.encounter), m.def.boss ? '#ffd166' : '#ff8fab');
    if (m.def.boss) this.banner.setBossFrame(true);
  }

  onUnitKilled(m) {
    const { stones } = this.db.balance;
    if (m.def.boss) this.gainStones(stones.boss, m.x, m.y);
    else if (m.def.elite) this.gainStones(stones.elite, m.x, m.y);
    if (this.stats.lifesteal) this.healPlayer(this.stats.lifesteal);
    this.hero.onKill(m);
    this.minions.onKill(m);
    this.training.onKill(m);
    const unit = this.db.story.units[m.id];
    if (!unit) return;
    recordKill(this.storage, m.id);
    this.banner.say(unit, lineFor(unit, 'death', m.encounter || 1), '#c9b8ff');
    if (m.def.boss) {
      if (this.stolen.length) {
        this.setRanks(returnStolen(this.ranks, this.stolen));
        this.stolen = [];
        this.floatText(this.player.x, this.player.y - 40, '기억이 돌아왔다', '#b57bff');
      }
      if (!this.monsters.alive().some((o) => o.def.boss)) this.banner.setBossFrame(false);
    }
  }

  stealCard() {
    if (this.isInvulnerable()) return;
    const { ranks, stolenId } = stealRank(this.ranks);
    if (!stolenId) return;
    this.setRanks(ranks);
    this.stolen.push(stolenId);
    const card = this.db.cards.find((c) => c.id === stolenId);
    this.floatText(this.player.x, this.player.y - 40, `기억을 빼앗겼다 — ${card.name}`, '#b57bff');
    this.cameras.main.shake(200, 0.008);
  }

  setRanks(ranks) {
    this.ranks = ranks;
    this.stats = this.computeStats();
    this.player.hp = Math.min(this.player.hp, this.maxHp());
  }

  healPlayer(amount) {
    this.player.hp = Math.min(this.maxHp(), this.player.hp + amount);
  }

  // ---------- 마나시드 ----------

  dropSeed(x, y, exp, kind = 'green') {
    const style = SEED_STYLES[kind];
    this.seeds.push({ x, y, exp, age: 0, done: false, sprite: this.add.circle(x, y, style.radius, style.color).setDepth(4) });
  }

  updateSeeds(dt) {
    const { drops } = this.db.balance;
    const p = this.player;
    const magnet = drops.magnetRadius * this.stats.magnetMul;
    for (const s of this.seeds) {
      s.age += dt;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d < p.radius + 6) {
        this.progress.addExp(s.exp);
        s.done = true;
      } else if (d < magnet) {
        const step = Math.min(drops.pullSpeed * dt, d);
        s.x += ((p.x - s.x) / d) * step;
        s.y += ((p.y - s.y) / d) * step;
      } else if (s.age > drops.lifetime) {
        s.done = true;
      }
      if (s.done) s.sprite.destroy();
      else s.sprite.setPosition(s.x, s.y);
    }
    this.seeds = this.seeds.filter((s) => !s.done);
  }

  // ---------- 흐름 (레벨업 / 클리어 / 종료) ----------

  checkFlow() {
    if (this.player.hp <= 0) return this.endRun('dead');
    if (this.core.hp <= 0) return this.endRun('coreLost');
    if (this.pendingTransform) return this.transform(this.pendingTransform);
    const trained = this.trainingComplete();
    if (trained) return this.transform(this.db.recipes.find((r) => r.id === trained.training), `${trained.name} Lv${this.db.balance.training.transformAt}`);
    if (this.starterPending) return this.openStarterPicker();
    if (this.giftPending) return this.openCardPicker(true);
    if (this.progress.pendingLevelups > 0) return this.openCardPicker();
    if (this.run.state === 'cleared') {
      this.crystals.clear();
      // 바닥에 남은 마나시드도 팝업의 환수 금액에 포함되어야 한다
      if (this.seeds.length > 0) {
        this.collectAllSeeds();
        return this.checkFlow();
      }
      return this.openWaveClear();
    }
  }

  collectAllSeeds() {
    for (const s of this.seeds) {
      this.progress.addExp(s.exp);
      s.sprite.destroy();
    }
    this.seeds = [];
  }

  pause() {
    this.paused = true;
    this.joystick.release();
  }

  resume() {
    this.paused = false;
    this.overlay = null;
  }

  openCardPicker(gift = false, customTitle = null, after = null) {
    let title = '첫 선물!';
    if (customTitle) title = customTitle;
    else if (gift) this.giftPending = false;
    else {
      this.progress.takeLevelup();
      title = '레벨 업!';
    }
    // 한 번에 여러 레벨이 오르면 대기 중인 카드마다 해당 레벨 기준으로 등급 해금
    const drawLevel = this.progress.level - this.progress.pendingLevelups;
    const cards = drawCards(this.cardList, this.classId, this.ranks, drawLevel, this.db.balance, Math.random, 3, this.tier);
    this.mixItemCard(cards);
    this.lastHand = cards;
    this.pause();
    this.overlay = showCardPicker(this, cards, this.ranks, title, (card) => {
      this.applyCard(card);
      this.resume();
      if (after) after();
      else this.checkFlow();
    });
  }

  // 레벨업 3택 중 한 장을 아이템 카드로 바꿀 수 있다 (지금 갈 수 있는 조합의 재료만)
  mixItemCard(cards) {
    const { items, recipes } = this.db;
    const pool = itemPool(items, recipes, this.classId, this.spec?.id, this.owned);
    const forced = this.firstItemPending;
    this.firstItemPending = false;
    if (!pool.length || (!forced && Math.random() >= this.itemBal.items.cardChance)) return;
    const item = pickItem(pool, this.owned, recipes, this.itemBal);
    cards[cards.length - 1] = this.itemCard(item);
  }

  itemCard(item) {
    return { id: `item:${item.id}`, itemId: item.id, isItem: true, name: item.name, grade: item.rarity, desc: item.desc, color: item.color };
  }

  gainItem(itemId) {
    const item = this.db.items.find((i) => i.id === itemId);
    this.owned = { ...this.owned, [itemId]: 0 };
    this.refreshStats();
    this.floatText(this.player.x, this.player.y - 40, `아이템 획득 — ${item.name}`, item.color);
    const recipe = matchRecipe(this.owned, this.db.recipes, this.classId, this.spec?.id);
    if (recipe) this.pendingTransform = recipe;
  }

  // 전직 보상 스킬: 1차 희귀, 2차 영웅(3·4차에 +1), 5차 전설 — 전직하면 손에 쥐는 게 있어야 한다
  grantReward(tier) {
    const rewards = this.cls.rewards;
    if (!rewards) return null;
    const cardId = tier === 1 ? rewards['1'] : tier === 5 ? rewards['5'] : rewards['2'];
    const card = this.db.cards.find((c) => c.id === cardId);
    const rank = this.ranks[cardId] || 0;
    if (rank >= maxRank(card, this.db.balance, this.tier)) return `${card.name} (이미 최대)`;
    this.setRanks({ ...this.ranks, [cardId]: rank + 1 });
    return `${card.name} Lv${rank + 1}`;
  }

  enhanceOrder(id) {
    if (this.specRecipe?.items.includes(id)) return 0;
    return this.db.items.find((i) => i.id === id).relic ? 1 : 2;
  }

  // 강화석: 웨이브 클리어·정예·보스에서 모이는 강화 재료 (이번 판 한정)
  gainStones(n, x = this.player.x, y = this.player.y) {
    this.stones += n;
    this.floatText(x, y - 50, `강화석 +${n}`, '#74c0fc');
  }

  // 지금 무엇을 하면 다음 전직인지 한 줄로
  nextGoal() {
    if (this.tier === 1) return '다음: 2차 전직 — 레벨업·가챠에서 조합 재료 2개 모으기';
    const next = this.specRecipe && nextAscend(this.owned, this.specRecipe, this.tier, this.db.balance);
    if (!next) return null;
    const name = this.spec.ascend.find((a) => a.tier === next.tier).name;
    const parts = next.items.map((x) => `${this.db.items.find((i) => i.id === x.id).name} +${x.level}/${next.need}`);
    return `다음: ${name}(${next.tier}차) — ${parts.join(' · ')}`;
  }

  // 3~5차: 전직 고유 기술 배율
  formName() {
    if (!this.spec) return this.cls.name;
    const asc = this.tier > 2 ? this.spec.ascend.find((x) => x.tier === this.tier) : null;
    return asc ? `${asc.name} (${this.tier}차)` : `${this.cls.name} (${this.spec.name})`;
  }

  sigMul() {
    return 1 + 0.25 * Math.max(0, this.tier - 2);
  }

  refreshStats() {
    const oldMax = this.maxHp();
    this.stats = this.computeStats();
    this.player.hp = Math.min(this.maxHp(), this.player.hp + Math.max(0, this.maxHp() - oldMax));
  }

  // 기초 수련 경로: 초보자의 수련 카드가 기준 단계에 닿으면 그 직업으로 전직
  trainingComplete() {
    if (this.classId !== 'novice') return null;
    const need = this.db.balance.training.transformAt;
    return this.db.cards.find((c) => c.training && (this.ranks[c.id] || 0) >= need) || null;
  }

  // 판 안 전직: 직업(1차) 또는 전직(2차)으로 그 자리에서 바뀐다. via = 조합 대신 표시할 경로
  transform(recipe, via = null) {
    this.pendingTransform = null;
    const { classes, specs, shop } = this.db;
    const hpRatio = this.player.hp / this.maxHp();
    let info;
    let refund = 0;
    if (recipe.ascend) return this.ascend(recipe.ascend);
    if (recipe.result.type === 'class') {
      // 전직하면 기초 수련은 더 이상 쓰이지 않으니 리셋하고 마나시드로 환급
      refund = trainingRefund(this.ranks, this.db.cards, this.db.balance);
      if (refund > 0) {
        const kept = { ...this.ranks };
        for (const c of this.db.cards) if (c.training) delete kept[c.id];
        this.setRanks(kept);
        this.progress.grant(refund);
      }
      this.tier = 1;
      this.classId = recipe.result.id;
      this.cls = classes[this.classId];
      this.classColor = hex(this.cls.color);
      this.heroScale = heroScale(this.cls.radius);
      this.playerSprite.setTexture(`hero_${this.classId}`).setScale(this.heroScale);
      this.player.radius = this.cls.radius;
      info = { tier: '1차 전직', name: this.cls.name, desc: `${this.cls.weapon} · 스킬 [${this.cls.skill.name}]`, color: this.cls.color };
    } else {
      this.tier = 2;
      this.specRecipe = recipe;
      this.spec = specs.find((sp) => sp.id === recipe.result.id);
      this.specStats = { ...this.spec.stats };
      const coreMods = this.spec.mods?.coreHp || 0;
      if (coreMods) {
        const newMax = Math.round(this.baseCoreHp * (1 + this.mods.coreHp + coreMods));
        this.core.hp += newMax - this.core.maxHp;
        this.core.maxHp = newMax;
      }
      info = { tier: '2차 전직', name: `${this.cls.name} → ${this.spec.name}`, desc: this.spec.desc, color: this.spec.color };
    }
    this.stats = this.computeStats();
    this.player.hp = this.maxHp() * hpRatio;
    this.hero.skillCd = 0;
    info.reward = this.grantReward(this.tier);
    if (refund > 0) info.refund = refund;
    const first = recordDiscovery(this.storage, recipe.id);
    this.pause();
    this.cameras.main.flash(300, 255, 255, 255);
    const route = via ? [via] : recipe.items.map((id) => this.db.items.find((i) => i.id === id).name);
    this.overlay = showTransform(this, { ...info, first, items: route, routeLabel: via ? '경로' : '조합' }, () => {
      this.resume();
      this.checkFlow();
    });
    this.overlay.kind = 'transform';
  }

  // 출전하면 기초 수련 5종 중 무작위 3개에서 하나를 골라 시작 (Lv3이 되면 그 직업으로 전직)
  openStarterPicker() {
    this.starterPending = false;
    const pool = Phaser.Utils.Array.Shuffle(this.cardList.filter((c) => c.training)).slice(0, 3);
    this.pause();
    this.overlay = showCardPicker(this, pool, this.ranks, '기초 수련 선택', (card) => {
      this.applyCard(card);
      this.resume();
      this.checkFlow();
    });
  }

  applyCard(card) {
    if (card.isItem) return this.gainItem(card.itemId);
    if (card.instant) {
      const { type, amount } = card.instant;
      if (type === 'heal') this.player.hp = Math.min(this.maxHp(), this.player.hp + this.maxHp() * amount);
      if (type === 'repair') this.core.hp = Math.min(this.core.maxHp, this.core.hp + this.core.maxHp * amount);
      return;
    }
    const oldMax = this.maxHp();
    this.ranks[card.id] = (this.ranks[card.id] || 0) + 1;
    this.stats = this.computeStats();
    this.player.hp += this.maxHp() - oldMax;
  }

  // 각성: 가진 강화석을 모두 각성치로 전환 (5차 전직 전용, 이번 판 한정)
  investAwaken() {
    if (this.tier < 5 || this.stones <= 0) return this.reopenHub('awaken');
    const n = this.stones;
    this.stones = 0;
    this.awakenPoints += n;
    this.refreshStats();
    this.floatText(this.player.x, this.player.y - 40, `각성치 +${n}`, '#ffd966');
    this.reopenHub('awaken');
  }

  // ---------- 판 안 거점 (준비 단계) ----------

  openHub(tab = 'maintain', notice = null) {
    if (this.paused || this.run.state !== 'prep') return;
    if (this.overlay && !this.overlay.destroyed) this.overlay.destroy();
    this.pause();
    this.hubTab = tab;
    this.overlay = showHub(this, tab, this.hubContext(notice), {
      onTab: (t) => this.reopenHub(t),
      onMaintain: (item) => this.buyMaintain(item),
      onGacha: () => this.gacha(),
      onEnhance: (id) => this.enhance(id),
      onTune: (id, delta) => this.tune(id, delta),
      onTuneDownRequest: (k) => this.confirmTuneDown(k),
      onInvestAwaken: () => this.investAwaken(),
      onPage: (page) => {
        this.enhancePage = page;
        this.reopenHub('enhance');
      },
      onClose: () => this.resume(),
    });
  }

  reopenHub(tab = this.hubTab, notice = null) {
    this.resume();
    if (this.pendingTransform) return this.checkFlow();
    this.openHub(tab, notice);
  }

  hubContext(notice) {
    const { balance, workshop, items, recipes, cards } = this.db;
    const wave = this.run.wave;
    const available = this.progress.available;
    const pool = itemPool(items, recipes, this.classId, this.spec?.id, this.owned);
    const gachaUsed = this.workshopUsed.prep.gacha || 0;
    const nameOf = (id) => items.find((i) => i.id === id);
    return {
      notice,
      available,
      payout: settleRun('retire', available, balance, this.mods.harvest),
      stones: this.stones,
      goal: this.nextGoal(),
      maintain: workshop.map((item) => ({
        item, name: item.name, desc: item.desc, price: priceFor(item, wave), ok: canUse(item, wave, available, this.workshopUsed),
        sub: `${item.scope === 'prep' ? '이번 준비' : '이번 판'} ${this.workshopUsed[item.scope][item.id] || 0}/${item.limit}`,
      })),
      gacha: {
        relic: Boolean(this.spec), poolSize: pool.length, price: gachaPrice(wave, balance), used: gachaUsed, limit: balance.items.gacha.limit,
        ok: pool.length > 0 && gachaUsed < balance.items.gacha.limit && gachaPrice(wave, balance) <= available,
        owned: Object.entries(this.owned).map(([id, lv]) => `${nameOf(id).name}${lv ? ` +${lv}` : ''}`),
      },
      enhancePage: this.enhancePage || 0,
      // 전직 재료 → 유물 → 나머지 순
      enhance: Object.entries(this.owned).sort(([a], [b]) => this.enhanceOrder(a) - this.enhanceOrder(b)).map(([id, lv]) => {
        const price = enhancePrice(lv, wave, balance);
        const stones = enhanceStones(lv, balance);
        const core = this.specRecipe?.items.includes(id) ? '전직 재료 — 둘 다 +2면 3차, +3 4차, +4 5차' : null;
        return {
          id, name: nameOf(id).name, level: lv, desc: nameOf(id).desc, price, stones, sub: core,
          ok: price !== null && price <= available && stones <= this.stones,
        };
      }),
      // 기초 수련은 초보자 때만 의미가 있다 — 전직 뒤엔 목록에서 뺀다
      skills: Object.entries(this.ranks).map(([id, rank]) => [cards.find((c) => c.id === id), rank])
        .filter(([card, rank]) => rank > 0 && !(card.training && this.classId !== 'novice')).map(([card, rank]) => {
        const id = card.id;
        const max = maxRank(card, balance, this.tier);
        const upPrice = rank < max ? tunePrice(rank, wave, balance) : null;
        return { id, name: card.name, desc: card.desc, rank, max, upPrice, upOk: upPrice !== null && upPrice <= available, refund: tuneRefund(rank, wave, balance) };
      }).sort((a, b) => b.rank - a.rank),
      // 5차 전직 전용: 강화석을 각성치로 투자, 100당 공격력 +2% (무한 상승)
      awakenUnlocked: this.tier >= 5,
      awaken: {
        level: this.awakenLevel(),
        points: this.awakenPoints % balance.awaken.perLevel,
        per: balance.awaken.perLevel,
        atkMul: balance.awaken.atkMul,
      },
    };
  }

  buyMaintain(item) {
    if (!this.progress.spend(priceFor(item, this.run.wave))) return this.reopenHub();
    this.workshopUsed = recordUse(this.workshopUsed, item);
    const { type, amount } = item.effect;
    if (type === 'coreRepair') this.core.hp = Math.min(this.core.maxHp, this.core.hp + this.core.maxHp * amount);
    if (type === 'skillCd') {
      this.runBonus.skillCdMul += amount;
      this.refreshStats();
    }
    if (type === 'coreBarrier') this.barrierWave = this.run.wave;
    this.resume();
    if (type === 'card') return this.openCardPicker(false, '전투 보급', () => this.reopenHub('maintain'));
    this.openHub('maintain');
  }

  gacha() {
    const { items, recipes, balance } = this.db;
    if (!this.progress.spend(gachaPrice(this.run.wave, balance))) return this.reopenHub('gacha');
    this.workshopUsed = { ...this.workshopUsed, prep: { ...this.workshopUsed.prep, gacha: (this.workshopUsed.prep.gacha || 0) + 1 } };
    const item = pickItem(itemPool(items, recipes, this.classId, this.spec?.id, this.owned), this.owned, recipes, this.itemBal);
    this.gainItem(item.id);
    this.cameras.main.flash(200, 255, 230, 150);
    this.reopenHub('gacha', `획득: ${item.name} — ${item.desc}`);
  }

  enhance(id) {
    const { balance, items } = this.db;
    const from = this.owned[id];
    const price = enhancePrice(from, this.run.wave, balance);
    const stones = enhanceStones(from, balance);
    if (price === null || stones > this.stones || !this.progress.spend(price)) return this.reopenHub('enhance');
    this.stones -= stones;
    const roll = rollEnhance(from, this.itemBal);
    if (roll.result === 'drop' && this.dropGuards > 0) {
      this.dropGuards--;
      roll.result = 'guarded';
      roll.level = from;
    }
    this.owned = { ...this.owned, [id]: roll.level };
    this.refreshStats();
    const item = items.find((i) => i.id === id);
    this.overlay = showEnhance(this, {
      name: item.name, color: item.color, from, to: roll.level, result: roll.result,
      rate: this.itemBal.items.enhanceRates[from], max: balance.items.enhancePrices.length,
    }, () => {
      this.checkAscend();
      this.reopenHub('enhance');
    });
  }

  // 2차 전직 재료 강화 단계가 기준을 넘으면 3~5차로 (단계가 떨어져도 차수는 유지)
  checkAscend() {
    if (!this.specRecipe) return;
    const tier = ascendTier(this.owned, this.specRecipe, this.db.balance);
    if (tier > this.tier) this.pendingTransform = { ascend: tier };
  }

  ascend(tier) {
    const asc = this.spec.ascend.find((x) => x.tier === tier);
    this.tier = tier;
    this.refreshStats();
    this.hero.skillCd = 0;
    const reward = this.grantReward(tier);
    const first = recordDiscovery(this.storage, `${this.spec.id}@${tier}`);
    this.pause();
    this.cameras.main.flash(400, 255, 240, 200);
    this.cameras.main.shake(300, 0.014);
    const items = this.specRecipe.items.map((i) => `${this.db.items.find((x) => x.id === i).name} +${this.owned[i]}`);
    this.overlay = showTransform(this, {
      tier: `${tier}차 전직`, name: `${this.spec.name} → ${asc.name}`, desc: asc.desc, color: this.spec.color, first, items, reward,
    }, () => {
      this.resume();
      this.checkFlow();
    });
    this.overlay.kind = 'transform';
  }

  // 스킬 레벨 -1 확정 전 한 번 더 물어본다 (실수로 레벨만 깎이는 사고 방지)
  confirmTuneDown(k) {
    this.overlay = showTuneDownConfirm(this, k, () => this.tune(k.id, -1), () => this.reopenHub('skills'));
  }

  tune(id, delta) {
    const rank = this.ranks[id] || 0;
    const { balance } = this.db;
    if (delta > 0) {
      if (!this.progress.spend(tunePrice(rank, this.run.wave, balance))) return this.reopenHub('skills');
      this.setRanks({ ...this.ranks, [id]: rank + 1 });
    } else {
      const refund = tuneRefund(rank, this.run.wave, balance);
      this.progress.refund(refund);
      const next = { ...this.ranks, [id]: rank - 1 };
      if (next[id] <= 0) delete next[id];
      this.setRanks(next);
      this.floatText(this.player.x, this.player.y - 40, `마나시드 +${refund}`, '#9dffb0');
    }
    this.reopenHub('skills');
  }

  openWaveClear() {
    const { balance } = this.db;
    if (this.stonesWave !== this.run.wave) {
      this.stonesWave = this.run.wave;
      this.gainStones(balance.stones.perWave);
    }
    this.pause();
    this.overlay = showWaveClear(this, {
      wave: this.run.wave,
      totalExp: this.progress.available,
      seeds: settleRun('retire', this.progress.available, balance, this.mods.harvest),
      coreHp: this.core.hp,
      coreMaxHp: this.core.maxHp,
      coreRecover: balance.recovery.coreOnClear + this.mods.coreRegen,
    }, {
      onContinue: () => this.continueRun(),
      onRetire: () => this.endRun('retire'),
    });
  }

  continueRun() {
    const { recovery } = this.db.balance;
    this.core.hp = Math.min(this.core.maxHp, this.core.hp + this.core.maxHp * (recovery.coreOnClear + this.mods.coreRegen));
    this.run.nextWave();
    this.turrets.repairAll();
    this.minions.healAll();
    this.workshopUsed = { ...this.workshopUsed, prep: {} };
    this.player.hp = Math.min(this.maxHp(), this.player.hp + this.maxHp() * recovery.playerOnPrep);
    this.announceWave();
    this.resume();
  }

  endRun(outcome) {
    if (this.ended) return;
    this.ended = true;
    this.pause();
    const seeds = settleRun(outcome, this.progress.available, this.db.balance, this.mods.harvest);
    const save = saveRunResult(this.storage, { seeds, wave: this.run.wave, outcome, classId: this.spec?.id || this.classId });
    this.overlay = showResult(this, {
      outcome, wave: this.run.wave, totalExp: this.progress.available, seeds, save,
    }, {
      onRestart: () => this.scene.restart(),
      onLobby: () => this.scene.start('lobby'),
    });
  }

  // ---------- 연출 ----------

  swingFx(x, y, range, dir, half, color = 0xffffff) {
    // 도트 베기: 휘두른 호를 따라 초승달이 번쩍 (한 바퀴 베기는 사방으로 여섯 개)
    const n = half >= Math.PI * 0.9 ? 6 : 1;
    for (let i = 0; i < n; i++) {
      const a = n === 1 ? dir : dir + (Math.PI * 2 * i) / n;
      const r = range * 0.7;
      const c = this.add.image(x + Math.cos(a) * r, y + Math.sin(a) * r, 'fx_crescent').setTint(color).setRotation(a)
        .setScale(Math.max(1.2, range / 30)).setBlendMode(Phaser.BlendModes.ADD).setDepth(15);
      this.tweens.add({
        targets: c, x: c.x + Math.cos(a) * 12, y: c.y + Math.sin(a) * 12, alpha: 0, duration: 140, onComplete: () => c.destroy(),
      });
    }
    const g = this.add.graphics().setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
    g.fillStyle(color, 0.18);
    g.slice(x, y, range, dir - half, dir + half, false);
    g.fillPath();
    this.tweens.add({ targets: g, alpha: 0, duration: 120, onComplete: () => g.destroy() });
  }

  // 진화 스킬 이름을 화면 가운데에 외친다
  skillCallout(text, color) {
    const t = this.add.text(this.cameras.main.width / 2, 300, text, {
      fontSize: '30px', fontStyle: 'bold', color: `#${color.toString(16).padStart(6, '0')}`, stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(950).setScale(0.6);
    this.tweens.add({ targets: t, scale: 1.1, duration: 120 });
    this.tweens.add({ targets: t, alpha: 0, y: 280, delay: 450, duration: 350, onComplete: () => t.destroy() });
  }

  // 참격선: 빛나는 굵은 선이 번쩍
  slashLine(x1, y1, x2, y2, color) {
    const g = this.add.graphics().setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(12, color, 0.5).lineBetween(x1, y1, x2, y2);
    g.lineStyle(4, 0xffffff, 0.95).lineBetween(x1, y1, x2, y2);
    this.tweens.add({ targets: g, alpha: 0, duration: 240, onComplete: () => g.destroy() });
  }

  ring(x, y, r, color) {
    const c = this.add.circle(x, y, r).setStrokeStyle(4, color, 0.9).setDepth(15).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: c, alpha: 0, scale: 1.15, duration: 300, onComplete: () => c.destroy() });
  }

  burst(x, y, color) {
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = this.add.rectangle(x, y, 4, 4, color).setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({
        targets: c, x: x + Math.cos(a) * 26, y: y + Math.sin(a) * 26, alpha: 0, duration: 260,
        onComplete: () => c.destroy(),
      });
    }
  }

  afterimage(x, y, r, color) {
    const c = this.add.circle(x, y, r, color, 0.6).setDepth(6);
    this.tweens.add({ targets: c, alpha: 0, scaleX: 1.6, scaleY: 0.2, duration: 350, onComplete: () => c.destroy() });
  }

  floatText(x, y, text, color) {
    const t = this.add.text(x, y, text, {
      fontSize: '18px', fontStyle: 'bold', color, stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(31);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1400, onComplete: () => t.destroy() });
  }

  blastFx(x, y, r, color) {
    const c = this.add.circle(x, y, r, color, 0.35).setStrokeStyle(3, color, 0.9).setDepth(14).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: c, alpha: 0, scale: 1.1, duration: 220, onComplete: () => c.destroy() });
  }

  damageNumber(x, y, dmg, crit = false, color = '#ffffff') {
    const t = this.add.text(x, y, String(Math.round(dmg)) + (crit ? '!' : ''), {
      fontSize: crit ? '22px' : '16px', fontStyle: 'bold', color: crit ? '#ffd43b' : color, stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: y - 28, alpha: 0, duration: 500, onComplete: () => t.destroy() });
  }
}
