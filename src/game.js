const CITY_DEFS = [
  { name: "Madrid", lat: 40.4168, lon: -3.7038, zoom: 18, size: 0.085 },
  { name: "Paris", lat: 48.8566, lon: 2.3522, zoom: 14, size: 0.085 },
  { name: "Roma", lat: 41.9028, lon: 12.4964, zoom: 14, size: 0.085 },
  { name: "Tokio", lat: 35.6762, lon: 139.6503, zoom: 14, size: 0.095 },
  { name: "Los Ángeles", lat: 34.0522, lon: -118.2437, zoom: 13, size: 0.12 },
  { name: "Cáceres", lat: 39.4765, lon: -6.3722, zoom: 15, size: 0.065 },
];

const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile";
const AUTO_FIRE_INTERVAL = 0.18;
const MISSILE_BLAST = 170;
const FLIGHT_MAX_SPEED = 128;
const FLIGHT_CRUISE_THROTTLE = 0.84;
const FLIGHT_TURN_ACCEL = 2.1;
const FLIGHT_MAX_YAW = 2.2;
const FLIGHT_TRAIL_MAX = 44;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const menuPanel = document.getElementById("menuPanel");
const citySelect = document.getElementById("citySelect");
const startButton = document.getElementById("startButton");
const messagePanel = document.getElementById("messagePanel");
const messageTitle = document.getElementById("messageTitle");
const messageText = document.getElementById("messageText");
const messageButton = document.getElementById("messageButton");

const hudCity = document.getElementById("hudCity");
const hudObjective = document.getElementById("hudObjective");
const hudLife = document.getElementById("hudLife");
const hudLevel = document.getElementById("hudLevel");
const hudMissiles = document.getElementById("hudMissiles");

const missileButton = document.getElementById("missileButton");
const joystickBase = document.getElementById("joystickBase");
const joystickKnob = document.getElementById("joystickKnob");

for (const city of CITY_DEFS) {
  const option = document.createElement("option");
  option.value = city.name;
  option.textContent = city.name;
  citySelect.append(option);
}

const spritePaths = {
  playerCenter: "./assets/sprites/player/down-1.png",
  playerLeft: "./assets/sprites/player/left-1.png",
  playerRight: "./assets/sprites/player/right-1.png",
  alienFly: "./assets/sprites/alien-fly/sheet-transparent.png",
  alienGround: "./assets/sprites/alien-ground/sheet-transparent.png",
  pickups: "./assets/sprites/pickups/sheet-transparent.png",
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function latLonToTileXY(lat, lon, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function tileXYToLatLon(x, y, zoom) {
  const n = 2 ** zoom;
  const lon = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lon };
}

class TileLayer {
  constructor() {
    this.cache = new Map();
    this.pending = new Set();
    this.failed = new Set();
  }

  getTile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.pending.has(key) && !this.failed.has(key)) {
      this.pending.add(key);
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => {
        this.cache.set(key, image);
        this.pending.delete(key);
      };
      image.onerror = () => {
        this.pending.delete(key);
        this.failed.add(key);
      };
      image.src = `${TILE_URL}/${z}/${y}/${x}`;
    }
    return null;
  }

  draw(ctx, centerTileX, centerTileY, zoom, width, height) {
    const tileSize = 256;
    const centerTile = { x: centerTileX, y: centerTileY };
    
    // Calculamos el rango de baldosas alrededor del centro
    // Usamos un margen generoso para cubrir las esquinas al rotar
    const rangeX = Math.ceil(width / tileSize);
    const rangeY = Math.ceil(height / tileSize);
    
    const startX = Math.floor(centerTile.x) - rangeX;
    const endX = Math.floor(centerTile.x) + rangeX;
    const startY = Math.floor(centerTile.y) - rangeY;
    const endY = Math.floor(centerTile.y) + rangeY;
    
    const maxTile = 2 ** zoom;

    for (let tileX = startX; tileX <= endX; tileX += 1) {
      for (let tileY = startY; tileY <= endY; tileY += 1) {
        if (tileY < 0 || tileY >= maxTile) continue;
        
        const wrappedX = ((tileX % maxTile) + maxTile) % maxTile;
        const image = this.getTile(zoom, wrappedX, tileY);
        
        // Dibujamos relativo al centro fraccionario de la baldosa del jugador
        const screenX = (tileX - centerTile.x) * tileSize;
        const screenY = (tileY - centerTile.y) * tileSize;
        
        if (image) {
          ctx.drawImage(image, screenX, screenY, tileSize, tileSize);
        } else {
          ctx.fillStyle = "#0c1a2d";
          ctx.fillRect(screenX, screenY, tileSize, tileSize);
        }
      }
    }
  }
}

class SpriteSheet {
  constructor(image, rows, cols) {
    this.image = image;
    this.rows = rows;
    this.cols = cols;
    this.frameWidth = image.width / cols;
    this.frameHeight = image.height / rows;
  }

  drawFrame(ctx, frameIndex, x, y, width, height, rotation = 0) {
    const col = frameIndex % this.cols;
    const row = Math.floor(frameIndex / this.cols);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.drawImage(
      this.image,
      col * this.frameWidth,
      row * this.frameHeight,
      this.frameWidth,
      this.frameHeight,
      -width / 2,
      -height / 2,
      width,
      height
    );
    ctx.restore();
  }
}

class Game {
  constructor(assets, ctx) {
    this.assets = assets;
    this.ctx = ctx;
    this.tileLayer = new TileLayer();
    this.lastTime = 0;
    this.keys = { left: false, right: false };
    this.joystick = { x: 0, y: 0, activePointerId: null };
    this.active = false;
    this.completed = false;
    this.city = CITY_DEFS[0];
    this.resize();
    this.reset();
  }

  reset() {
    this.player = {
      x: 0,
      y: 0,
      angle: -Math.PI / 2,
      life: 100,
      level: 1,
      missiles: 3,
      throttle: FLIGHT_CRUISE_THROTTLE,
      targetSteering: 0,
      steering: 0,
      velocity: FLIGHT_MAX_SPEED * FLIGHT_CRUISE_THROTTLE,
      yawVelocity: 0,
      fireCooldown: 0,
      invulnerable: 0,
    };
    this.bullets = [];
    this.enemyBullets = [];
    this.missiles = [];
    this.pickups = [];
    this.effects = [];
    this.enemies = [];
    this.trail = [];
    this.stats = { total: 0, destroyed: 0 };
    this.time = 0;
    this.cityTileOrigin = null;
  }

  resize() {
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  start(cityName) {
    this.city = CITY_DEFS.find((city) => city.name === cityName) || CITY_DEFS[0];
    this.completed = false;
    this.active = true;
    this.reset();
    this.spawnLevel();
    this.updateHud();
  }

  spawnLevel() {
    const rng = createRng(
      [...this.city.name].reduce((acc, char) => acc + char.charCodeAt(0), 0) + this.city.zoom
    );
    const mapSize = this.city.size * 12000;
    const flyingCount = 4 + Math.round(this.city.size * 34);
    const groundCount = 6 + Math.round(this.city.size * 40);
    const spread = mapSize;

    const randomPoint = () => ({
      x: (rng() - 0.5) * spread,
      y: (rng() - 0.5) * spread,
    });

    for (let i = 0; i < flyingCount; i += 1) {
      const point = randomPoint();
      this.enemies.push({
        type: "fly",
        x: point.x,
        y: point.y,
        angle: rng() * Math.PI * 2,
        radius: 24,
        speed: 60 + rng() * 22,
        fireCooldown: 1.5 + rng() * 2.5,
        hp: 30,
        frame: i % 4,
      });
    }

    for (let i = 0; i < groundCount; i += 1) {
      const point = randomPoint();
      this.enemies.push({
        type: "ground",
        x: point.x,
        y: point.y,
        angle: 0,
        radius: 32,
        fireCooldown: 2 + rng() * 3,
        hp: 42,
        frame: i % 4,
      });
    }

    this.stats.total = this.enemies.length;
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    if (this.player.invulnerable > 0) this.player.invulnerable -= dt;

    // --- LÓGICA DE TIMÓN (RUDDER) ---
    const keyTurn = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    const stickMagnitude = Math.hypot(this.joystick.x, this.joystick.y);
    const usingStick = stickMagnitude > 0.15;
    
    // El joystick X controla la posición del "timón" (steering)
    let targetRudder = usingStick ? clamp(this.joystick.x, -1, 1) : keyTurn;
    this.player.steering += (targetRudder - this.player.steering) * 0.08;

    // --- FÍSICA DE GIRO E INERCIA (YAW) ---
    // El giro es más efectivo cuanta más velocidad tengas
    const speedRatio = clamp(Math.abs(this.player.velocity) / FLIGHT_MAX_SPEED, 0, 1);
    const yawTarget = this.player.steering * FLIGHT_MAX_YAW * (0.18 + speedRatio * 0.82);
    
    // Aceleración de la rotación (guiñada)
    const yawDelta = clamp(yawTarget - this.player.yawVelocity, -FLIGHT_TURN_ACCEL * dt, FLIGHT_TURN_ACCEL * dt);
    this.player.yawVelocity += yawDelta;
    
    // Rozamiento para que el giro no sea infinito[cite: 2]
    this.player.yawVelocity *= 1 - clamp(dt * 1.15, 0, 0.18);
    
    // Actualizamos el ángulo (heading)[cite: 2]
    this.player.angle = normalizeAngle(this.player.angle + this.player.yawVelocity * dt);

    // --- VELOCIDAD Y AVANCE ---
    // El avión siempre avanza hacia donde apunta su nariz[cite: 2]
    const targetSpeed = FLIGHT_MAX_SPEED * 0.85; // Velocidad de crucero constante
    this.player.velocity += (targetSpeed - this.player.velocity) * 1.2 * dt;

    this.player.x += Math.cos(this.player.angle) * this.player.velocity * dt;
    this.player.y += Math.sin(this.player.angle) * this.player.velocity * dt;

    // --- DISPARO ---
    this.player.fireCooldown -= dt;
    if (this.player.fireCooldown <= 0) {
      this.autoFire(); // Esta función usará el nuevo this.player.angle
      this.player.fireCooldown = AUTO_FIRE_INTERVAL;
    }

    this.updateBullets(dt);
    this.updateEnemies(dt);
    this.updatePickups(dt);
    this.updateEffects(dt);
    this.updateTrail();
    this.handleCollisions();
    this.updateHud();
  }

  autoFire() {
    // 1. Calculamos cuántas balas disparar según el nivel del jugador[cite: 1]
    const spreadCount = Math.min(3, 1 + Math.floor((this.player.level - 1) / 2));

    for (let i = 0; i < spreadCount; i += 1) {
      // 2. Calculamos el desvío (abanico) si hay más de una bala[cite: 1]
      const angleOffset = spreadCount === 1 ? 0 : (i - (spreadCount - 1) / 2) * 0.12;
      
      // 3. El ángulo final de la bala es el rumbo del avión + el desvío del nivel[cite: 1, 2]
      const bulletAngle = this.player.angle + angleOffset;

      this.bullets.push({
        // 4. Posición de salida: desplazada hacia adelante desde el centro del avión[cite: 1, 2]
        // Usamos Math.cos y Math.sin para que salgan siempre por el "morro"
        x: this.player.x + Math.cos(this.player.angle) * 30,
        y: this.player.y + Math.sin(this.player.angle) * 30,
        
        angle: bulletAngle,
        speed: 420, // Velocidad de la bala[cite: 1]
        damage: 12 + this.player.level * 2, // Daño progresivo[cite: 1]
        ttl: 1.5, // Tiempo de vida del proyectil en segundos[cite: 1]
      });
    }
  }

  launchMissile() {
    if (!this.active || this.player.missiles <= 0) return;
    this.player.missiles -= 1;
    this.missiles.push({
      x: this.player.x,
      y: this.player.y,
      angle: this.player.angle,
      speed: 170,
      ttl: 1.4,
    });
    this.updateHud();
  }

  updateBullets(dt) {
    for (const bullet of this.bullets) {
      bullet.x += Math.cos(bullet.angle) * bullet.speed * dt;
      bullet.y += Math.sin(bullet.angle) * bullet.speed * dt;
      bullet.ttl -= dt;
    }
    for (const bullet of this.enemyBullets) {
      bullet.x += Math.cos(bullet.angle) * bullet.speed * dt;
      bullet.y += Math.sin(bullet.angle) * bullet.speed * dt;
      bullet.ttl -= dt;
    }
    for (const missile of this.missiles) {
      missile.x += Math.cos(missile.angle) * missile.speed * dt;
      missile.y += Math.sin(missile.angle) * missile.speed * dt;
      missile.ttl -= dt;
      if (missile.ttl <= 0) {
        missile.exploded = true;
        this.effects.push({ x: missile.x, y: missile.y, radius: 0, ttl: 0.4, blast: true });
        for (const enemy of this.enemies) {
          const d = distance(missile, enemy);
          if (d < MISSILE_BLAST) enemy.hp -= 80 * (1 - d / MISSILE_BLAST);
        }
      }
    }
    this.bullets = this.bullets.filter((bullet) => bullet.ttl > 0);
    this.enemyBullets = this.enemyBullets.filter((bullet) => bullet.ttl > 0);
    this.missiles = this.missiles.filter((missile) => missile.ttl > 0 && !missile.exploded);
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) {
      enemy.fireCooldown -= dt;
      if (enemy.type === "fly") {
        enemy.frame = Math.floor(this.time * 7) % 4;
        const targetAngle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
        const delta = normalizeAngle(targetAngle - enemy.angle);
        enemy.angle += clamp(delta, -1.6 * dt, 1.6 * dt);
        enemy.x += Math.cos(enemy.angle) * enemy.speed * dt;
        enemy.y += Math.sin(enemy.angle) * enemy.speed * dt;
      } else {
        enemy.frame = 0; // Estático para tierra
      }

      const range = distance(enemy, this.player);
      if (enemy.fireCooldown <= 0 && range < (enemy.type === "ground" ? 360 : 300)) {
        const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
        this.enemyBullets.push({
          x: enemy.x,
          y: enemy.y,
          angle,
          speed: enemy.type === "ground" ? 165 : 210,
          damage: enemy.type === "ground" ? 15 : 10,
          ttl: 3,
        });
        enemy.fireCooldown = enemy.type === "ground" ? 1.9 : 1.2;
      }
    }

    const defeated = [];
    this.enemies = this.enemies.filter((enemy) => {
      if (enemy.hp > 0) return true;
      defeated.push(enemy);
      return false;
    });

    for (const enemy of defeated) {
      this.stats.destroyed += 1;
      this.effects.push({ x: enemy.x, y: enemy.y, radius: 0, ttl: 0.45, blast: true });
      this.dropPickup(enemy);
    }
  }

  dropPickup(enemy) {
    const roll = Math.random();
    let kind = null;
    if (roll < 0.18) kind = "life";
    else if (roll < 0.33) kind = "missile";
    else if (roll < 0.46) kind = "level";
    else if (roll < 0.54) kind = "shield";
    if (!kind) return;
    this.pickups.push({
      x: enemy.x,
      y: enemy.y,
      kind,
      ttl: 14,
      bob: Math.random() * Math.PI * 2,
      radius: 22,
    });
  }

  updatePickups(dt) {
    for (const pickup of this.pickups) {
      pickup.ttl -= dt;
      pickup.bob += dt * 2.4;
    }
    this.pickups = this.pickups.filter((pickup) => pickup.ttl > 0);
  }

  updateEffects(dt) {
    for (const effect of this.effects) {
      effect.ttl -= dt;
      effect.radius += dt * 260;
    }
    this.effects = this.effects.filter((effect) => effect.ttl > 0);
  }

  handleCollisions() {
    for (const bullet of this.bullets) {
      for (const enemy of this.enemies) {
        if (distance(bullet, enemy) < enemy.radius) {
          enemy.hp -= bullet.damage;
          bullet.ttl = 0;
          break;
        }
      }
    }

    if (this.player.invulnerable <= 0) {
      for (const bullet of this.enemyBullets) {
        if (distance(this.player, bullet) < 24) {
          bullet.ttl = 0;
          this.damagePlayer(bullet.damage);
        }
      }

      for (const enemy of this.enemies) {
        if (distance(this.player, enemy) < enemy.radius + 18) {
          this.damagePlayer(enemy.type === "ground" ? 22 : 16);
          enemy.hp -= 20;
        }
      }
    }

    for (const pickup of this.pickups) {
      if (distance(this.player, pickup) < pickup.radius + 20) {
        pickup.ttl = 0;
        if (pickup.kind === "life") this.player.life = clamp(this.player.life + 25, 0, 100);
        if (pickup.kind === "missile") this.player.missiles += 2;
        if (pickup.kind === "level") this.player.level = Math.min(8, this.player.level + 1);
        if (pickup.kind === "shield") this.player.invulnerable = Math.max(this.player.invulnerable, 3);
      }
    }
  }

  damagePlayer(amount) {
    this.player.life -= amount;
    this.player.invulnerable = 1.2;
    this.effects.push({ x: this.player.x, y: this.player.y, radius: 0, ttl: 0.3, blast: true });
    if (this.player.life <= 0) {
      this.active = false;
      this.showMessage("Derrota", `Tu avión ha caído sobre ${this.city.name}. Reintenta la misión.`);
    }
  }

  updateHud() {
    hudCity.textContent = this.city.name;
    hudObjective.textContent = `Objetivo: ${this.stats.destroyed} / ${this.stats.total}`;
    hudLife.textContent = `Vida: ${Math.max(0, Math.round(this.player.life))} · Vel ${Math.round(this.player.velocity)}`;
    hudLevel.textContent = `Nivel: ${this.player.level}`;
    hudMissiles.textContent = `Misiles: ${this.player.missiles}`;
  }

  updateTrail() {
    const last = this.trail[this.trail.length - 1];
    if (!last || distance(last, this.player) > 36) {
      this.trail.push({ x: this.player.x, y: this.player.y });
      if (this.trail.length > FLIGHT_TRAIL_MAX) this.trail.shift();
    }
  }

  showMessage(title, text) {
    messageTitle.textContent = title;
    messageText.textContent = text;
    messagePanel.classList.remove("hidden");
  }

  screenFromWorld(worldX, worldY) {
    return {
      x: worldX - this.player.x + window.innerWidth / 2,
      y: worldY - this.player.y + window.innerHeight / 2,
    };
  }

  // Este método ya no es necesario ya que calculamos las baldosas directamente en renderWorldObjects
  // para asegurar una sincronización perfecta con los objetos del mundo.

  render() {
    const ctx = this.ctx;
    if (!ctx) return;

    // Limpiar pantalla
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Llamar a los objetos del mundo pasando el contexto
    this.renderWorldObjects(ctx); 

    // UI (esto no se mueve con la cámara)
    this.renderMinimapHint(ctx);
  }

  renderWorldObjects(ctx) {
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    // Calculamos el centro de la ciudad en coordenadas de baldosa una sola vez
    if (!this.cityTileOrigin) {
      this.cityTileOrigin = latLonToTileXY(this.city.lat, this.city.lon, this.city.zoom);
    }

    ctx.save();
    
    // 1. CENTRAR CÁMARA
    ctx.translate(centerX, centerY);

    // 2. ROTAR EL MUNDO (Efecto brújula)
    ctx.rotate(-this.player.angle - Math.PI / 2);

    // --- DIBUJAR TODO LO QUE ESTÁ EN EL MAPA ---
    // Sincronizamos las baldosas con la posición del jugador en píxeles (1 unidad = 1 píxel)
    const currentTileX = this.cityTileOrigin.x + this.player.x / 256;
    const currentTileY = this.cityTileOrigin.y + this.player.y / 256;
    
    // El mapa se dibuja relativo al centro de la cámara (el jugador)
    this.tileLayer.draw(ctx, currentTileX, currentTileY, this.city.zoom, window.innerWidth * 2, window.innerHeight * 2);

    // El resto de objetos se dibujan relativos a la posición del jugador
    ctx.save();
    ctx.translate(-this.player.x, -this.player.y);

    this.drawTrail(ctx);
    this.bullets.forEach(b => this.drawBullet(ctx, b));
    this.enemyBullets.forEach(b => this.drawBullet(ctx, b, "#ff4444"));
    this.missiles.forEach(m => this.drawMissile(ctx, m));
    this.enemies.forEach(e => this.drawEnemy(ctx, e));
    this.pickups.forEach(p => this.drawPickup(ctx, p));
    this.effects.forEach(e => this.drawEffect(ctx, e));

    ctx.restore();
    ctx.restore();

    // --- DIBUJAR EL AVIÓN SIEMPRE EN EL CENTRO ---
    this.renderPlayer(ctx, centerX, centerY);
  }

  drawBullet(ctx, b, color = "#fff") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawMissile(ctx, m) {
    ctx.fillStyle = "#ffaa00";
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.angle);
    ctx.fillRect(-8, -3, 16, 6);
    ctx.restore();
  }

  drawEnemy(ctx, e) {
    const sheet = e.type === "fly" ? this.assets.alienFly : this.assets.alienGround;
    // Dibujamos al enemigo en sus coordenadas X, Y reales (la cámara ya se encargó de la traslación)
    sheet.drawFrame(ctx, e.frame, e.x, e.y, e.radius * 2, e.radius * 2, e.angle + Math.PI/2);
  }

  drawPickup(ctx, p) {
    const frame = ["life", "missile", "level", "shield"].indexOf(p.kind);
    this.assets.pickups.drawFrame(ctx, frame, p.x, p.y + Math.sin(p.bob) * 5, 40, 40);
  }

  drawEffect(ctx, e) {
    ctx.strokeStyle = `rgba(255, 100, 0, ${e.ttl / 0.45})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawTrail(ctx) {
    if (this.trail.length < 2) return;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(this.trail[0].x, this.trail[0].y);
    for (let i = 1; i < this.trail.length; i++) {
      ctx.lineTo(this.trail[i].x, this.trail[i].y);
    }
    ctx.stroke();
  }

  renderPlayer(ctx, x, y) {
    const steering = this.player.steering;
    let img = this.assets.player.center;
    if (steering < -0.15) img = this.assets.player.left;
    else if (steering > 0.15) img = this.assets.player.right;

    ctx.save();
    
    // Efecto de parpadeo por daño
    if (this.player.invulnerable > 0 && Math.floor(this.time * 14) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }

    // Dibujamos el sprite centrado en x, y
    ctx.drawImage(img, x - 46, y - 46, 92, 92);
    
    ctx.restore();
  }

  renderMinimapHint(ctx) {
    ctx.fillStyle = "rgba(5, 12, 22, 0.55)";
    ctx.fillRect(window.innerWidth - 250, window.innerHeight - 138, 200, 88);
    ctx.fillStyle = "#e4efff";
    ctx.font = "700 14px Trebuchet MS";
    ctx.fillText(this.city.name, window.innerWidth - 234, window.innerHeight - 110);
    ctx.font = "12px Trebuchet MS";
    ctx.fillStyle = "#a8bed2";
    ctx.fillText(`Rumbo ${Math.round((this.player.angle * 180) / Math.PI + 360) % 360}°`, window.innerWidth - 234, window.innerHeight - 88);
    ctx.fillText(`Velocidad ${Math.round(this.player.velocity)}`, window.innerWidth - 234, window.innerHeight - 70);
    ctx.fillText("La estela marca tu recorrido", window.innerWidth - 234, window.innerHeight - 52);
  }
}

async function boot() {
  const [playerCenter, playerLeft, playerRight, alienFlyImage, alienGroundImage, pickupsImage] = await Promise.all([
    loadImage(spritePaths.playerCenter),
    loadImage(spritePaths.playerLeft),
    loadImage(spritePaths.playerRight),
    loadImage(spritePaths.alienFly),
    loadImage(spritePaths.alienGround),
    loadImage(spritePaths.pickups),
  ]);

  const assets = {
    player: {
      center: playerCenter,
      left: playerLeft,
      right: playerRight,
    },
    alienFly: new SpriteSheet(alienFlyImage, 2, 2),
    alienGround: new SpriteSheet(alienGroundImage, 2, 2),
    pickups: new SpriteSheet(pickupsImage, 2, 2),
  };

  const game = new Game(assets, ctx);

  function setTurnState(direction, value) {
    game.keys[direction] = value;
  }

  function updateJoystickVisual() {
    const radius = joystickBase.clientWidth * 0.26;
    joystickKnob.style.transform = `translate(calc(-50% + ${game.joystick.x * radius}px), calc(-50% + ${game.joystick.y * radius}px))`;
  }

  function resetJoystick() {
    game.joystick.x = 0;
    game.joystick.y = 0;
    game.joystick.activePointerId = null;
    updateJoystickVisual();
  }

  function updateJoystickFromEvent(event) {
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;
    const maxRadius = rect.width * 0.38;
    const length = Math.hypot(dx, dy) || 1;
    const clampedLength = Math.min(maxRadius, length);
    game.joystick.x = clamp((dx / length) * (clampedLength / maxRadius), -1, 1);
    game.joystick.y = clamp((dy / length) * (clampedLength / maxRadius), -1, 1);
    updateJoystickVisual();
  }

  window.addEventListener("resize", () => game.resize());

  window.addEventListener("keydown", (event) => {
    if (event.code === "ArrowLeft" || event.code === "KeyA") setTurnState("left", true);
    if (event.code === "ArrowRight" || event.code === "KeyD") setTurnState("right", true);
    if (event.code === "Space") {
      event.preventDefault();
      game.launchMissile();
    }
  });

  window.addEventListener("keyup", (event) => {
    if (event.code === "ArrowLeft" || event.code === "KeyA") setTurnState("left", false);
    if (event.code === "ArrowRight" || event.code === "KeyD") setTurnState("right", false);
  });

  missileButton.addEventListener("click", () => game.launchMissile());

  joystickBase.addEventListener("pointerdown", (event) => {
    game.joystick.activePointerId = event.pointerId;
    joystickBase.setPointerCapture(event.pointerId);
    updateJoystickFromEvent(event);
  });

  joystickBase.addEventListener("pointermove", (event) => {
    if (game.joystick.activePointerId === event.pointerId) {
      updateJoystickFromEvent(event);
    }
  });

  const releaseJoystick = (event) => {
    if (game.joystick.activePointerId === event.pointerId) {
      resetJoystick();
    }
  };

  joystickBase.addEventListener("pointerup", releaseJoystick);
  joystickBase.addEventListener("pointercancel", releaseJoystick);
  joystickBase.addEventListener("pointerleave", releaseJoystick);

  startButton.addEventListener("click", () => {
    menuPanel.classList.add("hidden");
    messagePanel.classList.add("hidden");
    game.start(citySelect.value);
  });

  messageButton.addEventListener("click", () => {
    messagePanel.classList.add("hidden");
    menuPanel.classList.remove("hidden");
  });

  function frame(time) {
    const dt = Math.min(0.033, (time - game.lastTime) / 1000 || 0.016);
    game.lastTime = time;
    game.update(dt);
    game.render();
    requestAnimationFrame(frame);
  }

  updateJoystickVisual();
  requestAnimationFrame(frame);
}

boot().catch((error) => {
  console.error(error);
  messageTitle.textContent = "Error al cargar";
  messageText.textContent = "No se pudieron cargar los assets del juego.";
  messagePanel.classList.remove("hidden");
});
