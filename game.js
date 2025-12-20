// --- Constants & Data Definitions ---

const TALENTS = {
    'health_boost': { id: 'health_boost', name: '体魄', desc: '最大生命 +20', cost: 100, maxLevel: 5, category: 'strength', apply: (p) => p.maxHp += 20 },
    'regen': { id: 'regen', name: '再生', desc: '每秒回血 +1', cost: 200, maxLevel: 3, category: 'strength', apply: (p) => p.regen += 1 },
    'iron_skin': { id: 'iron_skin', name: '铁皮', desc: '伤害减免 +2', cost: 300, maxLevel: 3, category: 'strength', apply: (p) => p.damageReduction += 2 },

    'swiftness': { id: 'swiftness', name: '迅捷', desc: '移速 +15', cost: 100, maxLevel: 5, category: 'agility', apply: (p) => p.baseSpeed += 15 },
    'haste': { id: 'haste', name: '急速', desc: '攻速 +5%', cost: 200, maxLevel: 5, category: 'agility', apply: (p) => p.attackCooldown *= 0.95 },
    'multishot': { id: 'multishot', name: '多重射击', desc: '分裂箭几率 +10%', cost: 500, maxLevel: 1, category: 'agility', apply: (p) => p.splitShotChance = 0.1 },

    'wisdom': { id: 'wisdom', name: '智慧', desc: '经验获取 +10%', cost: 150, maxLevel: 5, category: 'magic', apply: (p) => p.expMultiplier += 0.1 },
    'meditation': { id: 'meditation', name: '冥想', desc: '技能冷却 -10%', cost: 250, maxLevel: 3, category: 'magic', apply: (p) => p.cdr += 0.1 },
    'reach': { id: 'reach', name: '掌控', desc: '拾取范围 +20%', cost: 100, maxLevel: 3, category: 'magic', apply: (p) => p.magnetMultiplier += 0.2 }
};

const SKILLS = {
    'sharpness': { id: 'sharpness', name: '锋利', type: 'passive', maxLevel: 10, desc: (lvl) => `攻击力 +${10}`, apply: (p, lvl) => p.damage += 10 },
    'quick_draw': { id: 'quick_draw', name: '快速拔枪', type: 'passive', maxLevel: 10, desc: (lvl) => `攻速 +10%`, apply: (p, lvl) => p.attackCooldown *= 0.9 },
    'vitality': { id: 'vitality', name: '强壮', type: 'passive', maxLevel: 10, desc: (lvl) => `最大生命 +20`, apply: (p, lvl) => { p.maxHp += 20; p.hp += 20; } },
    'split_shot': { id: 'split_shot', name: '分裂箭', type: 'passive', maxLevel: 5, desc: (lvl) => `普攻额外发射 ${lvl} 支箭矢 (50%伤害)`, apply: (p, lvl) => p.splitShotCount = lvl },
    'poison_nova': { id: 'poison_nova', name: '剧毒新星', type: 'active', maxLevel: 5, cooldown: 5, desc: (lvl) => `释放毒圈，每0.5秒造成 ${10 + lvl * 5} 伤害`, onActivate: (game, lvl) => game.createAoE(game.player.x, game.player.y, 150 + lvl * 20, 3, 10 + lvl * 5, '#9C27B0') },
    'blinding_dart': { id: 'blinding_dart', name: '致盲吹箭', type: 'active', maxLevel: 5, cooldown: 3, desc: (lvl) => `向最近敌人发射致盲毒镖，造成 ${30 + lvl * 10} 伤害`, onActivate: (game, lvl) => {
        const target = game.findNearestEnemy(game.player.x, game.player.y, 400);
        if (target) game.projectiles.push(new Projectile(game, game.player.x, game.player.y, target, { damage: 30 + lvl * 10, color: '#00FF00', speed: 600, type: 'dart' }));
    }},
    'mushroom_trap': { id: 'mushroom_trap', name: '种蘑菇', type: 'active', maxLevel: 5, cooldown: 4, desc: (lvl) => `原地种植隐形蘑菇，爆炸造成 ${50 + lvl * 20} 伤害并减速`, onActivate: (game, lvl) => {
        game.createMushroom(game.player.x, game.player.y, 50 + lvl * 20);
    }}
};

const ITEMS = [
    { id: 'iron_sword', name: '斩铁剑', desc: '攻击力 +20, 攻速 +5%', isHeirloom: false, stats: { damage: 20, cdr: 0.05 } },
    { id: 'dragon_scale', name: '龙鳞甲', desc: '最大生命 +100, 减伤 +5 (传承)', isHeirloom: true, stats: { maxHp: 100, damageReduction: 5 } },
    { id: 'wind_boots', name: '风行者之靴', desc: '移速 +40, 闪避 +5% (传承)', isHeirloom: true, stats: { speed: 40, dodge: 0.05 } },
    { id: 'demon_orb', name: '恶魔宝珠', desc: '技能伤害 +30%, 击杀回血 +2', isHeirloom: false, stats: { skillDmg: 0.3, killHeal: 2 } },
    { id: 'titan_ring', name: '泰坦指环', desc: '最大生命 +50, 攻击力 +10', isHeirloom: false, stats: { maxHp: 50, damage: 10 } },
    { id: 'void_blade', name: '虚空之刃', desc: '攻击力 +40, 攻速 +10% (传承)', isHeirloom: true, stats: { damage: 40, cdr: 0.1 } },
    { id: 'berserk_axe', name: '狂战斧', desc: '攻击力 +30, 但受到伤害 +10%', isHeirloom: false, stats: { damage: 30, incomingDmgMul: 0.1 } }, 
];

// --- Save System ---

class SaveManager {
    constructor() {
        this.data = { points: 0, talents: {}, heirlooms: [] };
        this.load();
    }
    load() {
        const s = localStorage.getItem('teemo_survivor_v3');
        if (s) { try { this.data = { ...this.data, ...JSON.parse(s) }; } catch (e) { } }
    }
    save() { localStorage.setItem('teemo_survivor_v3', JSON.stringify(this.data)); }
    addPoints(a) { this.data.points += a; this.save(); this.updateUI(); }

    purchaseTalent(id) {
        const t = TALENTS[id];
        const lvl = this.data.talents[id] || 0;
        if (lvl < t.maxLevel && this.data.points >= t.cost) {
            this.data.points -= t.cost;
            this.data.talents[id] = lvl + 1;
            this.save();
            this.updateUI();
        }
    }

    addHeirloom(itemId) {
        if (!this.data.heirlooms.includes(itemId)) {
            this.data.heirlooms.push(itemId);
            this.save();
            this.updateUI();
        }
    }

    updateUI() {
        const pointsEl = document.getElementById('meta-points');
        if (pointsEl) pointsEl.innerText = this.data.points;
        const shopPointsEl = document.getElementById('shop-points');
        if (shopPointsEl) shopPointsEl.innerText = this.data.points;
        
        ['strength', 'agility', 'magic'].forEach(cat => {
            const container = document.querySelector(`#tree-${cat} .talent-list`);
            if(!container) return;
            container.innerHTML = '';
            Object.values(TALENTS).filter(t => t.category === cat).forEach(t => {
                const lvl = this.data.talents[t.id] || 0;
                const div = document.createElement('div');
                div.className = `talent-node ${lvl > 0 ? 'purchased' : ''} ${lvl >= t.maxLevel ? 'maxed' : ''}`;
                div.innerHTML = `<div>${t.name} (${lvl}/${t.maxLevel})</div><div style="font-size:10px">${t.desc}</div><div style="font-size:10px;color:#ffd700">${lvl>=t.maxLevel?'MAX':t.cost}</div>`;
                div.onclick = () => this.purchaseTalent(t.id);
                container.appendChild(div);
            });
        });

        const hList = document.getElementById('heirloom-list');
        const hContainer = document.getElementById('heirloom-display');
        if (this.data.heirlooms.length > 0) {
            hContainer.classList.remove('hidden');
            hList.innerHTML = '';
            this.data.heirlooms.forEach(hid => {
                const item = ITEMS.find(i => i.id === hid);
                const d = document.createElement('div');
                d.className = 'equip-slot heirloom';
                d.title = item.name + "\n" + item.desc;
                d.innerText = item.name[0];
                hList.appendChild(d);
            });
        } else {
            hContainer.classList.add('hidden');
        }
    }
}

// --- Logic ---

function checkCollision(c1, c2) {
    return Math.sqrt((c1.x - c2.x) ** 2 + (c1.y - c2.y) ** 2) < c1.radius + c2.radius;
}

class Projectile {
    constructor(game, x, y, target, options = {}) {
        this.game = game;
        this.x = x; this.y = y;
        this.radius = options.radius || 5;
        this.color = options.color || '#FFFF00';
        this.speed = options.speed || 400;
        this.damage = options.damage || 10;
        this.type = options.type || 'normal';
        this.isEnemy = options.isEnemy || false;
        this.markedForDeletion = false;

        let angle = options.angle;
        if (angle === undefined && target) angle = Math.atan2(target.y - y, target.x - x);
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        if (this.isEnemy) {
            if (checkCollision(this, this.game.player)) {
                this.game.player.takeDamage(this.damage);
                this.markedForDeletion = true;
            }
        } else {
            for (const e of this.game.enemies) {
                if (checkCollision(this, e)) {
                    e.takeDamage(this.damage);
                    this.markedForDeletion = true;
                    if (this.type === 'dart') { e.stunned = 1.0; }
                    break;
                }
            }
        }

        if (this.x < 0 || this.x > this.game.width || this.y < 0 || this.y > this.game.height) this.markedForDeletion = true;
    }
    draw(ctx) {
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color; ctx.fill();
    }
}

class Mushroom {
    constructor(game, x, y, damage) {
        this.game = game;
        this.x = x; this.y = y;
        this.damage = damage;
        this.radius = 15;
        this.triggerRadius = 30;
        this.markedForDeletion = false;
        this.armTimer = 0;
        this.armed = false;
    }

    update(dt) {
        if (!this.armed) {
            this.armTimer += dt;
            if (this.armTimer > 1.0) this.armed = true;
            return;
        }

        // Check enemy collision
        for (const e of this.game.enemies) {
            const dist = Math.sqrt((e.x - this.x)**2 + (e.y - this.y)**2);
            if (dist < this.triggerRadius + e.radius) {
                this.explode();
                break;
            }
        }
    }

    explode() {
        this.markedForDeletion = true;
        this.game.createAoE(this.x, this.y, 120, 0.5, this.damage, 'rgba(0, 255, 0, 0.7)');
        // Slow enemies
        this.game.enemies.forEach(e => {
            const dist = Math.sqrt((e.x - this.x)**2 + (e.y - this.y)**2);
            if (dist < 120) e.stunned = 1.5; // Stun/Slow
        });
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.armed ? 1.0 : 0.5;
        ctx.translate(this.x, this.y);
        
        // Cap
        ctx.beginPath();
        ctx.arc(0, -5, 12, 0, Math.PI*2);
        ctx.fillStyle = '#4CAF50'; // Green cap for Teemo
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#2E7D32';
        ctx.stroke();

        // Spots
        ctx.beginPath(); ctx.arc(-5, -8, 3, 0, Math.PI*2); ctx.fillStyle = '#81C784'; ctx.fill();
        ctx.beginPath(); ctx.arc(5, -5, 2, 0, Math.PI*2); ctx.fillStyle = '#81C784'; ctx.fill();

        // Stem
        ctx.beginPath();
        ctx.rect(-4, 0, 8, 10);
        ctx.fillStyle = '#FFF8E1';
        ctx.fill();
        
        ctx.restore();
    }
}

class HealthPotion {
    constructor(game, x, y) {
        this.game = game;
        this.x = x; this.y = y;
        this.radius = 10;
        this.markedForDeletion = false;
        this.healAmount = 30;
    }
    update(dt) {
        if (checkCollision(this, this.game.player)) {
            this.game.player.heal(this.healAmount);
            this.markedForDeletion = true;
        }
    }
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        // Bottle
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI*2);
        ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
        ctx.fill();
        ctx.strokeStyle = '#FFCDD2';
        ctx.lineWidth = 1;
        ctx.stroke();
        // Cross
        ctx.fillStyle = 'white';
        ctx.fillRect(-2, -5, 4, 10);
        ctx.fillRect(-5, -2, 10, 4);
        ctx.restore();
    }
}

class Enemy {
    constructor(game, config) {
        this.game = game;
        this.type = config.type;
        this.markedForDeletion = false;
        
        // Spawn logic
        let sx, sy; const p = 50; const side = Math.floor(Math.random() * 4);
        if (side === 0) { sx = Math.random() * game.width; sy = -p; }
        else if (side === 1) { sx = game.width + p; sy = Math.random() * game.height; }
        else if (side === 2) { sx = Math.random() * game.width; sy = game.height + p; }
        else { sx = -p; sy = Math.random() * game.height; }
        this.x = sx; this.y = sy;

        // Base Config
        this.baseHp = config.hp || 20;
        this.speed = config.speed || 100;
        this.damage = config.damage || 10;
        this.exp = config.exp || 10;
        this.color = config.color || 'red';
        this.isRanged = config.isRanged || false;
        this.attackRange = config.attackRange || 0;
        
        // Scaling
        // Reduced scaling for smoother start: 
        // Old: f = 1 + (game.stage - 1) * 0.5 + (game.wave * 0.08);
        // New: Slower ramp up in early waves
        const f = 1 + (game.stage - 1) * 0.4 + (game.wave * 0.05); 
        this.maxHp = this.baseHp * f;
        
        // Frenzy nerfs
        if (game.frenzyActive) {
            this.maxHp *= 0.5; // Half HP during frenzy
        }

        this.hp = this.maxHp;
        this.damage = this.damage * f;
        
        // Size scales with HP (visual + hit)
        const sizeFactor = Math.min(2.0, Math.max(0.8, (this.maxHp / 100))); 
        this.radius = (config.radius || 15) * Math.pow(sizeFactor, 0.4); 

        this.attackTimer = 0;
        this.stunned = 0;
    }

    update(dt) {
        if (this.stunned > 0) {
            this.stunned -= dt;
            return;
        }

        const dx = this.game.player.x - this.x;
        const dy = this.game.player.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (this.type === 'boss') {
            this.updateBossBehavior(dt, dist, dx, dy);
            return;
        }

        if (this.isRanged) {
            if (dist > this.attackRange * 0.8) {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            } else if (dist < this.attackRange * 0.5) {
                // Back away
                this.x -= (dx / dist) * this.speed * 0.5 * dt;
                this.y -= (dy / dist) * this.speed * 0.5 * dt;
            }
            
            this.attackTimer += dt;
            if (this.attackTimer > 2.0 && dist < this.attackRange) {
                this.game.projectiles.push(new Projectile(this.game, this.x, this.y, this.game.player, {
                    isEnemy: true, color: 'orange', damage: this.damage, speed: 300
                }));
                this.attackTimer = 0;
            }
        } else {
            // Melee
            if (dist > 0) {
                this.x += (dx / dist) * this.speed * dt;
                this.y += (dy / dist) * this.speed * dt;
            }
            if (checkCollision(this, this.game.player)) {
                this.game.player.takeDamage(this.damage * dt);
            }
        }
    }

    updateBossBehavior(dt, dist, dx, dy) {
        this.attackTimer += dt;
        if (this.attackTimer > 5.0) {
            if (Math.random() < 0.5) {
                this.game.createAoE(this.x, this.y, 200, 1.0, this.damage * 2, 'rgba(255, 0, 0, 0.5)');
            } else {
                this.speed = 400;
                setTimeout(() => this.speed = 70, 1000);
            }
            this.attackTimer = 0;
        }

        this.x += (dx / dist) * this.speed * dt;
        this.y += (dy / dist) * this.speed * dt;

        if (checkCollision(this, this.game.player)) {
            this.game.player.takeDamage(this.damage * dt);
        }
    }

    draw(ctx) {
        ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color; ctx.fill();
        ctx.strokeStyle = 'black'; ctx.stroke();
        
        if (this.type !== 'boss' && this.hp < this.maxHp) {
            ctx.fillStyle = 'red'; ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, this.radius*2, 5);
            ctx.fillStyle = '#00FF00'; ctx.fillRect(this.x - this.radius, this.y - this.radius - 10, this.radius*2 * (this.hp / this.maxHp), 5);
        }
    }

    takeDamage(amt) {
        this.hp -= amt;
        if (this.hp <= 0) {
            this.markedForDeletion = true;
            this.game.createExpOrb(this.x, this.y, this.exp);
            this.game.onEnemyKilled(this);
            
            // Chance to drop health potion (5%)
            if (Math.random() < 0.05) {
                this.game.createHealthPotion(this.x, this.y);
            }
            
            if (this.game.player.killHeal) this.game.player.heal(this.game.player.killHeal);
            if (this.type === 'boss') this.game.bossDefeated(this);
        }
    }
}

class Player {
    constructor(game) {
        this.game = game;
        this.x = game.width / 2; this.y = game.height / 2;
        this.radius = 20; this.color = '#8BC34A';
        
        // Base Stats
        this.baseDamage = 25; this.baseSpeed = 200;
        this.maxHp = 100; this.regen = 0;
        this.expMultiplier = 1; this.magnetMultiplier = 1;
        this.damageReduction = 0; this.cdr = 0;

        // Talents
        const t = game.saveManager.data.talents;
        Object.keys(t).forEach(tid => {
            const def = TALENTS[tid];
            if (def) for (let i = 0; i < t[tid]; i++) def.apply(this);
        });

        // Current State
        this.hp = this.maxHp;
        this.level = 1; this.exp = 0; this.expToNextLevel = 100;
        
        this.skills = {};
        this.inventory = []; 
        this.inventoryLimit = 10;
        
        // Load Heirlooms
        game.saveManager.data.heirlooms.forEach(hid => {
            const item = ITEMS.find(i => i.id === hid);
            if(item) this.inventory.push({ item: item, level: 1 });
        });

        this.attackTimer = 0;
        this.skillTimers = {};
        this.projectileSpeed = 400;
        this.splitShotCount = 0;

        this.recalculateStats();
    }

    recalculateStats() {
        this.damage = this.baseDamage;
        this.speed = this.baseSpeed;
        this.attackCooldown = 0.5;
        this.splitShotCount = 0;
        this.killHeal = 0;
        
        Object.keys(this.skills).forEach(id => {
            if (SKILLS[id].type === 'passive') SKILLS[id].apply(this, this.skills[id]);
        });
        
        this.inventory.forEach(slot => {
            const s = slot.item.stats;
            const mul = slot.level; 
            if (s.damage) this.damage += s.damage * mul;
            if (s.speed) this.speed += s.speed * mul;
            if (s.maxHp) this.maxHp += s.maxHp * mul; 
            if (s.damageReduction) this.damageReduction += s.damageReduction * mul;
            if (s.cdr) this.attackCooldown *= (1 - s.cdr * 0.5 * mul);
            if (s.killHeal) this.killHeal = (this.killHeal || 0) + s.killHeal * mul;
        });
        
        this.attackCooldown *= (1 - this.cdr);
    }

    update(dt) {
        if (this.regen > 0) this.heal(this.regen * dt);

        let dx = 0, dy = 0;
        if (this.game.input.isKeyDown('w') || this.game.input.isKeyDown('ArrowUp')) dy -= 1;
        if (this.game.input.isKeyDown('s') || this.game.input.isKeyDown('ArrowDown')) dy += 1;
        if (this.game.input.isKeyDown('a') || this.game.input.isKeyDown('ArrowLeft')) dx -= 1;
        if (this.game.input.isKeyDown('d') || this.game.input.isKeyDown('ArrowRight')) dx += 1;
        if (dx || dy) {
            const l = Math.sqrt(dx * dx + dy * dy);
            this.x += (dx / l) * this.speed * dt;
            this.y += (dy / l) * this.speed * dt;
            this.x = Math.max(this.radius, Math.min(this.game.width - this.radius, this.x));
            this.y = Math.max(this.radius, Math.min(this.game.height - this.radius, this.y));
        }

        this.attackTimer += dt;
        if (this.attackTimer >= this.attackCooldown) this.autoAttack();

        Object.keys(this.skills).forEach(id => {
            if (SKILLS[id].type === 'active') {
                if (!this.skillTimers[id]) this.skillTimers[id] = 0;
                this.skillTimers[id] += dt;
                if (this.skillTimers[id] >= SKILLS[id].cooldown) {
                    SKILLS[id].onActivate(this.game, this.skills[id]);
                    this.skillTimers[id] = 0;
                }
            }
        });
    }

    autoAttack() {
        const target = this.game.findNearestEnemy(this.x, this.y, 400);
        if (target) {
            const angle = Math.atan2(target.y - this.y, target.x - this.x);
            this.game.projectiles.push(new Projectile(this.game, this.x, this.y, target, { angle }));
            if (this.splitShotCount > 0) {
                const spread = 0.3;
                for (let i = 1; i <= this.splitShotCount; i++) {
                    this.game.projectiles.push(new Projectile(this.game, this.x, this.y, null, { angle: angle + spread * i, damage: this.damage * 0.5, radius: 3 }));
                    this.game.projectiles.push(new Projectile(this.game, this.x, this.y, null, { angle: angle - spread * i, damage: this.damage * 0.5, radius: 3 }));
                }
            }
            this.attackTimer = 0;
        }
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        
        // Body (Teemo coat)
        ctx.beginPath(); ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#8D6E63'; // Brownish coat
        ctx.fill();
        ctx.strokeStyle = '#5D4037'; ctx.lineWidth = 2; ctx.stroke();

        // Hat
        ctx.beginPath();
        ctx.arc(0, -5, this.radius * 0.9, 0, Math.PI, true);
        ctx.fillStyle = '#388E3C'; // Green hat
        ctx.fill();
        
        // Goggles
        ctx.beginPath(); ctx.arc(-8, -2, 6, 0, Math.PI*2); ctx.fillStyle = '#42A5F5'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.stroke();
        ctx.beginPath(); ctx.arc(8, -2, 6, 0, Math.PI*2); ctx.fillStyle = '#42A5F5'; ctx.fill(); ctx.strokeStyle='#fff'; ctx.stroke();
        
        // Ears
        ctx.beginPath();
        ctx.moveTo(-15, -10); ctx.lineTo(-20, -25); ctx.lineTo(-5, -15);
        ctx.moveTo(15, -10); ctx.lineTo(20, -25); ctx.lineTo(5, -15);
        ctx.fillStyle = '#F5F5F5'; // White fur
        ctx.fill();
        
        ctx.restore();
    }

    takeDamage(amount) {
        const dmg = Math.max(1, amount - this.damageReduction);
        this.hp -= dmg;
        this.game.triggerDamageEffect();
        if (this.hp <= 0) this.game.gameOver();
    }
    
    heal(amount) {
        this.hp = Math.min(this.maxHp, this.hp + amount);
    }

    gainExp(val) {
        this.exp += val * this.expMultiplier;
        if (this.exp >= this.expToNextLevel) {
            this.level++;
            this.exp -= this.expToNextLevel;
            this.expToNextLevel = Math.floor(this.expToNextLevel * 1.5);
            this.game.showUpgradeModal();
        }
    }

    addItem(item) {
        const existing = this.inventory.find(s => s.item.id === item.id);
        if (existing) {
            existing.level++;
            this.recalculateStats();
            this.game.updateHUDInventory();
            return true;
        }
        if (this.inventory.length < this.inventoryLimit) {
            this.inventory.push({ item: item, level: 1 });
            this.recalculateStats();
            this.game.updateHUDInventory();
            return true;
        }
        return false;
    }
}

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.input = new InputHandler();
        this.saveManager = new SaveManager();
        this.saveManager.updateUI();

        document.getElementById('start-game-btn').onclick = () => this.startGameSetup();
        document.getElementById('shop-btn').onclick = () => this.openShop();
        document.getElementById('shop-back-btn').onclick = () => this.closeShop();
        document.getElementById('start-bonus-confirm-btn').onclick = () => this.startGame();
        
        document.getElementById('return-menu-btn').onclick = () => this.returnToMenu();
        document.getElementById('discard-btn').onclick = () => this.discardNewItem();
        document.getElementById('loot-confirm-btn').onclick = () => this.collectLoot();
        document.getElementById('next-stage-btn').onclick = () => this.nextStage();
        document.getElementById('pause-btn').onclick = () => this.togglePause();
        document.getElementById('resume-btn').onclick = () => this.togglePause();
        document.getElementById('quit-btn').onclick = () => this.returnToMenu();
        document.getElementById('stats-btn').onclick = () => this.togglePause();

        this.state = 'MENU';
        this.loop = this.loop.bind(this);
        this.lastTime = performance.now(); // Init lastTime before loop
        requestAnimationFrame(this.loop);
    }

    resize() {
        this.width = this.canvas.width = window.innerWidth;
        this.height = this.canvas.height = window.innerHeight;
    }
    
    openShop() {
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('shop-screen').classList.remove('hidden');
    }
    
    closeShop() {
        document.getElementById('shop-screen').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        this.saveManager.updateUI(); // Refresh points display
    }

    startGameSetup() {
        // Step 1: Pick a random bonus skill
        const skillIds = Object.keys(SKILLS);
        const randomId = skillIds[Math.floor(Math.random() * skillIds.length)];
        this.bonusSkillId = randomId;
        
        const skill = SKILLS[randomId];
        document.getElementById('bonus-skill-name').innerText = skill.name;
        document.getElementById('bonus-skill-desc').innerText = skill.desc(1);
        
        // Show Bonus Modal
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('start-bonus-modal').classList.remove('hidden');
    }

    startGame() {
        this.state = 'PLAYING';
        document.getElementById('start-bonus-modal').classList.add('hidden');
        document.getElementById('game-container').classList.remove('hidden');
        document.getElementById('game-over-modal').classList.add('hidden');

        this.stage = 1;
        this.wave = 1;
        this.gameTime = 0;
        this.waveTimer = 0;
        this.waveDuration = 20;

        this.comboCount = 0;
        this.comboTimer = 0;
        this.frenzyActive = false;
        this.frenzyTimer = 0;

        this.player = new Player(this);
        
        // Apply Bonus Skill
        if (this.bonusSkillId) {
            this.player.skills[this.bonusSkillId] = 1;
            this.player.recalculateStats();
        }

        this.enemies = []; this.projectiles = []; this.expOrbs = []; 
        this.aoeZones = []; this.mushrooms = []; this.potions = [];
        this.spawnTimer = 0; 
        
        this.lastTime = performance.now();
        this.updateHUDInventory();
        this.updateHUDWave();
        this.updateComboUI();
    }

    nextStage() {
        this.stage++;
        this.wave = 1;
        this.waveTimer = 0;
        document.getElementById('stage-clear-modal').classList.add('hidden');
        this.state = 'PLAYING';
        this.lastTime = performance.now();
        this.updateHUDWave();
    }

    returnToMenu() {
        this.state = 'MENU';
        document.getElementById('game-container').classList.add('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('pause-modal').classList.add('hidden');
        this.saveManager.updateUI();
    }

    togglePause() {
        if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
            document.getElementById('pause-modal').classList.remove('hidden');
            this.updateStatsPanel();
        } else if (this.state === 'PAUSED') {
            this.state = 'PLAYING';
            document.getElementById('pause-modal').classList.add('hidden');
            this.lastTime = performance.now();
        }
    }

    updateStatsPanel() {
        const p = this.player;
        const panel = document.getElementById('full-stats-panel');
        panel.innerHTML = `
            <div class="stat-row"><span>等级</span><span class="stat-val">${p.level}</span></div>
            <div class="stat-row"><span>攻击力</span><span class="stat-val">${Math.floor(p.damage)}</span></div>
            <div class="stat-row"><span>生命值</span><span class="stat-val">${Math.floor(p.hp)}/${Math.floor(p.maxHp)}</span></div>
            <div class="stat-row"><span>攻速</span><span class="stat-val">${(1/p.attackCooldown).toFixed(2)}/s</span></div>
            <div class="stat-row"><span>移速</span><span class="stat-val">${Math.floor(p.speed)}</span></div>
            <div class="stat-row"><span>减伤</span><span class="stat-val">${Math.floor(p.damageReduction)}</span></div>
            <div class="stat-row"><span>击杀回血</span><span class="stat-val">${p.killHeal||0}</span></div>
        `;
    }

    update(dt) {
        this.gameTime += dt;
        this.player.update(dt);
        
        // Combo & Frenzy Logic
        if (this.comboCount > 0) {
            this.comboTimer -= dt;
            if (this.comboTimer <= 0) {
                this.comboCount = 0;
                this.updateComboUI();
            }
        }
        
        if (this.frenzyActive) {
            this.frenzyTimer -= dt;
            if (this.frenzyTimer <= 0) {
                this.frenzyActive = false;
                document.getElementById('frenzy-msg').classList.add('hidden');
            }
        }

        if (this.wave < 10) {
            this.waveTimer += dt;
            if (this.waveTimer >= this.waveDuration) {
                this.wave++;
                this.waveTimer = 0;
                this.updateHUDWave();
            }
            
            // Spawn Rate Logic
            this.spawnTimer += dt;
            let spawnRate = this.getDynamicSpawnRate();

            if (this.spawnTimer > spawnRate) {
                this.spawnEnemy();
                this.spawnTimer = 0;
            }
        } else {
            if (!this.bossActive) {
                this.spawnBoss();
                this.bossActive = true;
            }
        }

        this.enemies.forEach(e => e.update(dt));
        this.enemies = this.enemies.filter(e => !e.markedForDeletion);
        this.projectiles.forEach(p => p.update(dt));
        this.projectiles = this.projectiles.filter(p => !p.markedForDeletion);
        this.expOrbs.forEach(e => e.update(dt));
        this.expOrbs = this.expOrbs.filter(e => !e.markedForDeletion);
        this.aoeZones.forEach(z => z.update(dt));
        this.aoeZones = this.aoeZones.filter(z => !z.markedForDeletion);
        this.mushrooms.forEach(m => m.update(dt));
        this.mushrooms = this.mushrooms.filter(m => !m.markedForDeletion);
        this.potions.forEach(p => p.update(dt));
        this.potions = this.potions.filter(p => !p.markedForDeletion);
        
        if (this.bossActive && this.bossRef && !this.bossRef.markedForDeletion) {
             const bar = document.getElementById('boss-hp-bar');
             bar.style.width = (this.bossRef.hp / this.bossRef.maxHp * 100) + '%';
        }

        this.updateUI();
    }
    
    getDynamicSpawnRate() {
        if (this.frenzyActive) return 0.1; // FAST spawn during frenzy
        
        let rate = 1.0;
        // Base rate based on wave
        if (this.wave <= 2) rate = 1.5;
        else if (this.wave === 3 || this.wave === 6) rate = 0.4;
        else rate = Math.max(0.4, 1.2 - (this.wave * 0.08));
        
        // Difficulty Modulation
        const difficulty = this.getDifficultyFactor(); // -1 (Easy) to 1 (Hard)
        if (difficulty > 0.5) rate *= 0.8; // Spawn faster if game thinks it should be hard
        
        return rate;
    }

    getDifficultyFactor() {
        // Sine wave for natural difficulty oscillation (Period ~20s)
        return Math.sin(this.gameTime / 3); 
    }

    spawnEnemy() {
        // Dynamic Difficulty Adjustment System
        const diffFactor = this.getDifficultyFactor(); // -1 to 1
        const player = this.player;
        
        // Analyze Player Weakness
        const isSlow = player.speed < 220;
        const isLowDmg = (player.damage / player.attackCooldown) < 50; 
        const isSquishy = player.maxHp < 150;

        // Base Weights
        let weights = { 'basic': 10, 'runner': 2, 'tank': 2, 'ranger': 2 };

        if (this.frenzyActive) {
            // Frenzy: Spawn trash mobs for fun
            weights = { 'basic': 20, 'runner': 0, 'tank': 0, 'ranger': 0 };
        } else {
            // Apply Difficulty Logic
            if (diffFactor > 0.3) { 
                // HARD PHASE: Target weaknesses
                if (isSlow) weights['runner'] += 5;       // Fast enemies vs Slow player
                if (isLowDmg) weights['tank'] += 4;       // Tanky enemies vs Low DPS
                if (isSquishy) weights['ranger'] += 4;    // Ranged/High Dmg vs Low HP
            } else if (diffFactor < -0.3) {
                // EASY PHASE: Give player a break
                weights['basic'] += 15;
            }
        }
        
        // Wave Restrictions
        if (this.wave <= 2) { weights = { 'basic': 10, 'runner': 0, 'tank': 0, 'ranger': 0 }; }
        
        // Select Enemy Type
        const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
        let random = Math.random() * totalWeight;
        let type = 'basic';
        for (const [k, w] of Object.entries(weights)) {
            random -= w;
            if (random <= 0) { type = k; break; }
        }

        const configs = {
             'basic': { type: 'basic', hp: 20, speed: 90, damage: 8, exp: 5, color: '#FF5252' }, 
             'tank': { type: 'tank', hp: 80, speed: 50, damage: 20, exp: 15, radius: 25, color: '#795548' },
             'runner': { type: 'runner', hp: 15, speed: 180, damage: 8, exp: 5, radius: 12, color: '#FF9800' },
             'ranger': { type: 'ranger', hp: 25, speed: 90, damage: 10, exp: 8, isRanged: true, attackRange: 300, color: '#00BCD4' }
        };
         
        this.enemies.push(new Enemy(this, configs[type]));
    }

    onEnemyKilled(enemy) {
        // Combo Logic
        this.comboCount++;
        this.comboTimer = 3.0; // 3 seconds to keep combo
        this.updateComboUI();

        if (this.comboCount > 0 && this.comboCount % 30 === 0) {
            this.triggerFrenzy();
        }
    }

    triggerFrenzy() {
        if (this.frenzyActive) return;
        this.frenzyActive = true;
        this.frenzyTimer = 5.0; // 5 seconds of fun
        document.getElementById('frenzy-msg').classList.remove('hidden');
        
        // Reward: Heal a bit
        this.player.heal(10);
    }

    updateComboUI() {
        const el = document.getElementById('combo-container');
        const countEl = document.getElementById('combo-count');
        if (this.comboCount > 1) {
            el.classList.remove('hidden');
            countEl.innerText = this.comboCount;
            // Reset animation
            el.style.animation = 'none';
            el.offsetHeight; /* trigger reflow */
            el.style.animation = null; 
        } else {
            el.classList.add('hidden');
        }
    }

    spawnBoss() {
        document.getElementById('boss-hp-container').classList.remove('hidden');
        const boss = new Enemy(this, {
            type: 'boss', hp: 2000, speed: 75, damage: 45, exp: 1000, radius: 55, color: '#FFD740'
        });
        this.enemies.push(boss);
        this.bossRef = boss;
    }

    bossDefeated(boss) {
        this.bossActive = false;
        this.bossRef = null;
        document.getElementById('boss-hp-container').classList.add('hidden');
        this.saveManager.addPoints(100 * this.stage);
        this.state = 'PAUSED';
        this.pendingLootItem = this.generateLoot();
        
        const modal = document.getElementById('loot-modal');
        const display = document.getElementById('loot-display');
        display.innerHTML = '';
        const div = document.createElement('div');
        div.className = `loot-item ${this.pendingLootItem.isHeirloom ? 'heirloom' : ''}`;
        div.innerHTML = `<h3>${this.pendingLootItem.name}</h3><p>${this.pendingLootItem.desc}</p>`;
        if(this.pendingLootItem.isHeirloom) div.innerHTML += `<p style="color:#FFD740;font-weight:bold">传家宝 (可继承)</p>`;
        display.appendChild(div);
        modal.classList.remove('hidden');
    }

    generateLoot() {
        const r = Math.random();
        const possibleHeirlooms = ITEMS.filter(i => i.isHeirloom && !this.saveManager.data.heirlooms.includes(i.id));
        const standards = ITEMS.filter(i => !i.isHeirloom);
        if (possibleHeirlooms.length > 0 && r < 0.2) return possibleHeirlooms[Math.floor(Math.random() * possibleHeirlooms.length)];
        return standards[Math.floor(Math.random() * standards.length)];
    }

    collectLoot() {
        const item = this.pendingLootItem;
        document.getElementById('loot-modal').classList.add('hidden');
        if (item.isHeirloom) this.saveManager.addHeirloom(item.id);
        const added = this.player.addItem(item);
        if (!added) this.showInventoryFullModal(item);
        else this.showStageClear();
    }

    showStageClear() { document.getElementById('stage-clear-modal').classList.remove('hidden'); }
    findNearestEnemy(x, y, range) {
        let n = null; let min = range;
        this.enemies.forEach(e => {
            const d = Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2);
            if (d < min) { min = d; n = e; }
        });
        return n;
    }

    createAoE(x, y, r, d, dmg, c) {
        this.aoeZones.push({
            x, y, r, d, dmg, c, t: 0, tick: 0,
            update: function (dt) {
                this.t += dt; this.tick += dt;
                if (this.t >= this.d) this.markedForDeletion = true;
                if (this.tick >= 0.5) {
                    this.tick = 0;
                    game.enemies.forEach(e => {
                        if (Math.sqrt((e.x - this.x) ** 2 + (e.y - this.y) ** 2) < this.r + e.radius) e.takeDamage(this.dmg);
                    });
                }
            },
            draw: function (ctx) {
                ctx.globalAlpha = 0.3; ctx.fillStyle = this.c; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1; ctx.strokeStyle = this.c; ctx.stroke();
            }
        });
    }

    createMushroom(x, y, dmg) {
        this.mushrooms.push(new Mushroom(this, x, y, dmg));
    }

    createHealthPotion(x, y) {
        this.potions.push(new HealthPotion(this, x, y));
    }
    
    createExpOrb(x, y, v) {
        this.expOrbs.push({
            x, y, v, r: 5,
            update: function (dt) {
                const dx = game.player.x - this.x; const dy = game.player.y - this.y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < 150 * game.player.magnetMultiplier) { this.x += dx / d * 400 * dt; this.y += dy / d * 400 * dt; }
                if (d < game.player.radius + this.r) { game.player.gainExp(this.v); this.markedForDeletion = true; }
            },
            draw: function (ctx) { ctx.fillStyle = '#00BCD4'; ctx.beginPath(); ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2); ctx.fill(); }
        });
    }

    showInventoryFullModal(newItem) {
        this.state = 'PAUSED';
        this.pendingItem = newItem;
        const modal = document.getElementById('inventory-modal');
        document.getElementById('new-item-name').innerText = newItem.name;
        const grid = document.getElementById('inventory-grid');
        grid.innerHTML = '';
        this.player.inventory.forEach((slot, idx) => {
            const div = document.createElement('div');
            div.className = 'equip-slot'; div.style.width = '60px'; div.style.height = '60px';
            div.innerHTML = `${slot.item.name[0]}<div class="lvl-badge">${slot.level}</div>`;
            div.onclick = () => {
                this.player.inventory[idx] = { item: newItem, level: 1 };
                this.player.recalculateStats();
                this.updateHUDInventory();
                document.getElementById('inventory-modal').classList.add('hidden');
                this.showStageClear();
            };
            grid.appendChild(div);
        });
        modal.classList.remove('hidden');
    }

    discardNewItem() { document.getElementById('inventory-modal').classList.add('hidden'); this.showStageClear(); }

    showUpgradeModal() {
        this.state = 'PAUSED';
        const m = document.getElementById('upgrade-modal');
        const c = document.getElementById('upgrade-options');
        c.innerHTML = '';
        const pool = Object.keys(SKILLS).filter(k => (this.player.skills[k]||0) < SKILLS[k].maxLevel);
        const picks = [];
        for(let i=0; i<3 && pool.length>0; i++) {
            const idx = Math.floor(Math.random()*pool.length);
            picks.push(pool[idx]);
            pool.splice(idx,1);
        }
        picks.forEach(id => {
            const def = SKILLS[id];
            const lvl = (this.player.skills[id]||0) + 1;
            const d = document.createElement('div');
            d.className = 'upgrade-card';
            d.innerHTML = `<h3>${def.name} Lv.${lvl}</h3><p>${def.desc(lvl)}</p>`;
            d.onclick = () => {
                this.player.skills[id] = lvl;
                this.player.gainExp(0);
                this.player.recalculateStats();
                this.closeModal('upgrade-modal');
            };
            c.appendChild(d);
        });
        if (picks.length===0) {
            const d = document.createElement('div');
            d.className='upgrade-card';
            d.innerHTML='<h3>HP 回复</h3><p>回复 50% 生命</p>';
            d.onclick=()=>{ this.player.hp=Math.min(this.player.maxHp, this.player.hp+this.player.maxHp*0.5); this.closeModal('upgrade-modal');};
            c.appendChild(d);
        }
        m.classList.remove('hidden');
    }

    closeModal(id) { document.getElementById(id).classList.add('hidden'); this.lastTime = performance.now(); this.state = 'PLAYING'; }
    
    gameOver() {
        this.state = 'GAMEOVER';
        const pts = Math.floor(this.gameTime / 5);
        this.saveManager.addPoints(pts);
        const td = document.getElementById('time-display');
        const finalTime = td ? td.innerText : "00:00";
        document.getElementById('final-time').innerText = finalTime;
        document.getElementById('gained-points').innerText = pts;
        document.getElementById('game-over-modal').classList.remove('hidden');
    }

    triggerDamageEffect() {
        const ov = document.getElementById('damage-overlay');
        ov.classList.add('damage-flash');
        setTimeout(() => ov.classList.remove('damage-flash'), 100);
    }

    updateUI() {
        document.getElementById('hp-display').innerText = `${Math.ceil(this.player.hp)}/${Math.ceil(this.player.maxHp)}`;
        const pct = (this.player.exp / this.player.expToNextLevel) * 100;
        document.getElementById('exp-bar').style.width = `${pct}%`;
        document.getElementById('level-badge').innerText = this.player.level;
    }

    updateHUDWave() {
        document.getElementById('stage-display').innerText = this.stage;
        document.getElementById('wave-display').innerText = this.wave;
    }

    updateHUDInventory() {
        const c = document.getElementById('equipment-container');
        c.innerHTML = '';
        this.player.inventory.forEach(slot => {
            const div = document.createElement('div');
            div.className = `equip-slot ${slot.item.isHeirloom ? 'heirloom' : ''}`;
            div.innerHTML = `${slot.item.name[0]}<div class="lvl-badge">${slot.level}</div>`;
            div.title = `${slot.item.name}\n${slot.item.desc}`;
            c.appendChild(div);
        });
    }

    draw() {
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.ctx.fillStyle = '#2E7D32'; 
        this.ctx.fillRect(0, 0, this.width, this.height);

        this.mushrooms.forEach(m => m.draw(this.ctx));
        this.potions.forEach(p => p.draw(this.ctx));
        this.aoeZones.forEach(z => z.draw(this.ctx));
        this.expOrbs.forEach(e => e.draw(this.ctx));
        this.enemies.forEach(e => e.draw(this.ctx));
        this.projectiles.forEach(p => p.draw(this.ctx));
        if (this.player) this.player.draw(this.ctx);
    }

    loop(ts) {
        if (!this.lastTime) this.lastTime = ts;
        let dt = (ts - this.lastTime) / 1000;
        this.lastTime = ts;
        
        // Prevent large dt jumps (e.g. tab switch) by capping instead of skipping
        if (dt > 0.1) dt = 0.1;

        if (this.state === 'PLAYING') {
            this.update(dt);
            this.draw();
        } else if (this.state === 'MENU') {
            this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, this.width, this.height);
        }
        requestAnimationFrame(this.loop);
    }
}

class InputHandler {
    constructor() { this.k = {}; window.addEventListener('keydown', e => { if(e.key==='Escape') game.togglePause(); this.k[e.key] = true; }); window.addEventListener('keyup', e => this.k[e.key] = false); }
    isKeyDown(k) { return !!this.k[k]; }
}

const game = new Game();
