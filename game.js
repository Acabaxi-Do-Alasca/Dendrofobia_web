'use strict';

// ═══════════════════════════════════════════
//  CONFIGURAÇÕES
// ═══════════════════════════════════════════
const CFG = {
  fps:            60,
  gravityNormal:  0.38,          // um pouco mais pesado → mais difícil
  gravityFast:    1.1,
  jumpVel:       -13,
  jumpCooldown:   18,            // frames até poder pular de novo

  treeSpeedInit:  5.5,           // velocidade inicial (mais rápida)
  treeSpeedMax:   22,
  speedIncrement: 0.6,           // aceleração por threshold
  scoreThreshold: 250,           // threshold menor → acelera mais rápido

  spawnIntervalMin: 55,          // frames mínimos entre árvores
  spawnIntervalMax: 120,         // frames máximos entre árvores

  boostFactor:    2.0,
  boostTicks:     20,
  boostCooldown:  300,

  bgWidth:        9800,          // largura do background em pixels nativos

  musicDir:       'Músicas/',
  musicFiles: [
    'back-in-black.mp3',         'Crazy-Train.mp3',
    'Enter-Sandman.mp3',         'Eye-Of-The-Tiger.mp3',
    'Highway-to-Hell.mp3',       'Immigrant-Song.mp3',
    'jump.mp3',                  'Paranoid.mp3',
    'Rock-You-Like-a-Hurricane.mp3',
    'Runnin-with-the-Devil.mp3', 'The-Trooper.mp3',
    'Thunderstruck.mp3',         'We-Will-Rock-You.mp3',
    'Welcome-To-The-Jungle.mp3', 'You-Give-Love-A-Bad-Name.mp3',
  ],

  imgDir: 'Imagens/',
};

// ═══════════════════════════════════════════
//  UTILITÁRIOS
// ═══════════════════════════════════════════
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const LS_KEY = 'dinorun_hs';

function loadHighScore() {
  return parseInt(localStorage.getItem(LS_KEY) || '0', 10);
}
function saveHighScore(v) {
  localStorage.setItem(LS_KEY, String(v));
}

// ═══════════════════════════════════════════
//  CARREGADOR DE IMAGENS
// ═══════════════════════════════════════════
class ImageLoader {
  constructor() {
    this._cache = {};
  }
  load(name) {
    if (!this._cache[name]) {
      const img = new Image();
      img.src = CFG.imgDir + name;
      this._cache[name] = img;
    }
    return this._cache[name];
  }
  // carrega um lote e resolve quando todos estiverem prontos
  preload(names) {
    return Promise.all(
      names.map(n => new Promise(res => {
        const img = this.load(n);
        if (img.complete) res();
        else { img.onload = res; img.onerror = res; }
      }))
    );
  }
}

// ═══════════════════════════════════════════
//  GERENCIADOR DE MÚSICA
// ═══════════════════════════════════════════
class MusicManager {
  constructor() {
    this._audio   = null;
    this._enabled = true;
    this._current = '';
  }
  get isOn() { return this._enabled; }

  toggle() {
    this._enabled = !this._enabled;
    if (this._audio) {
      if (this._enabled) this._audio.play().catch(() => {});
      else               this._audio.pause();
    }
  }

  playRandom() {
    if (!this._enabled) return;
    if (this._audio && !this._audio.paused && !this._audio.ended) return;

    const track = CFG.musicFiles[randInt(0, CFG.musicFiles.length - 1)];
    if (this._audio) { this._audio.pause(); this._audio.src = ''; }

    this._audio         = new Audio(CFG.musicDir + track);
    this._audio.volume  = 0.5;
    this._current       = track;
    this._audio.play().catch(() => {});
    this._audio.addEventListener('ended', () => this.playRandom(), { once: true });
  }

  stop() {
    if (this._audio) { this._audio.pause(); this._audio.src = ''; this._audio = null; }
  }
}

// ═══════════════════════════════════════════
//  PARALLAX BACKGROUND  (scroll infinito)
// ═══════════════════════════════════════════
class Background {
  constructor(loader, canvasW, canvasH) {
    this._img    = loader.load('Fundo2.png');
    this._cw     = canvasW;
    this._ch     = canvasH;
    // escala o background para cobrir a altura do canvas
    const aspect = CFG.bgWidth / 789; // proporção original
    this._bw     = Math.round(canvasH * aspect);
    this._x      = 0;
  }

  update(speed) {
    this._x -= speed;
    if (this._x <= -this._bw) this._x = 0;
  }

  draw(ctx) {
    if (!this._img.complete) {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, this._cw, this._ch);
      return;
    }
    ctx.drawImage(this._img, this._x,              0, this._bw, this._ch);
    ctx.drawImage(this._img, this._x + this._bw,   0, this._bw, this._ch);
  }
}

// ═══════════════════════════════════════════
//  DINOSSAURO
// ═══════════════════════════════════════════
class Dinosaur {
  constructor(loader, canvasH) {
    this._loader  = loader;
    this._ch      = canvasH;

    // frames de corrida
    this._frames  = ['dinosaur1.png','dinosaur2.png','dinosaur3.png','dinosaur2.png'];
    this._dashImg = 'Dash.png';
    this._fIdx    = 0;
    this._fTick   = 0;
    this._animInterval = 10;

    // imagem de referência (para obter dimensões)
    this._ref = loader.load(this._frames[0]);

    // posição — X fixo, Y começa no chão
    this.x = 100;
    this._w = 0; this._h = 0;   // dimensões reais (calculadas no primeiro draw)
    this.y  = canvasH;           // rect.bottom = canvasH

    this.vy          = 0;
    this.jumpCooldown = 0;
    this.score       = 0;

    this.boostTimer    = 0;
    this.boostCooldown = 0;
    this._boosting     = false;
    this._preBoostSpeed = CFG.treeSpeedInit;
  }

  // dimensões escaladas (proporcional à altura do canvas)
  get _scale() { return this._ch / 789; }

  get w() {
    if (!this._ref.complete) return 60;
    return Math.round(this._ref.naturalWidth  * this._scale);
  }
  get h() {
    if (!this._ref.complete) return 80;
    return Math.round(this._ref.naturalHeight * this._scale);
  }

  // hitbox ligeiramente menor que o sprite para ser justo
  get hitbox() {
    const pad = Math.round(6 * this._scale);
    return { x: this.x + pad, y: this.y - this.h + pad,
             w: this.w - pad*2, h: this.h - pad };
  }

  jump() {
    const onGround = this.y >= this._ch;
    if (this.jumpCooldown === 0 && onGround) {
      this.vy           = CFG.jumpVel * this._scale;
      this.jumpCooldown = CFG.jumpCooldown;
    }
  }

  tryBoost(gs) {
    if (this.boostTimer === 0 && this.boostCooldown === 0) {
      this._preBoostSpeed = gs.treeSpeed;
      gs.treeSpeed        = clamp(gs.treeSpeed * CFG.boostFactor, 0, CFG.treeSpeedMax);
      this.boostTimer     = CFG.boostTicks;
      this.boostCooldown  = CFG.boostCooldown;
      this._boosting      = true;
    }
  }

  update(gs) {
    // física
    this.vy += gs.gravity * this._scale;
    this.y  += this.vy;

    if (this.y >= this._ch) {
      this.y            = this._ch;
      this.vy           = 0;
      this.jumpCooldown = 0;
    }
    if (this.jumpCooldown > 0) this.jumpCooldown--;

    // pontuação e aceleração progressiva
    this.score++;
    gs.speedCounter++;
    if (gs.speedCounter >= CFG.scoreThreshold) {
      gs.treeSpeed    = clamp(gs.treeSpeed + CFG.speedIncrement, 0, CFG.treeSpeedMax);
      gs.speedCounter = 0;
    }

    // boost
    if (this.boostCooldown > 0) this.boostCooldown--;
    if (this.boostTimer    > 0) {
      this.boostTimer--;
      if (this.boostTimer === 0) {
        gs.treeSpeed   = this._preBoostSpeed;
        this._boosting = false;
      }
    }

    // animação
    this._fTick++;
    if (this._fTick >= this._animInterval) {
      this._fTick = 0;
      this._fIdx  = (this._fIdx + 1) % this._frames.length;
    }
  }

  draw(ctx) {
    const imgName = this._boosting ? this._dashImg : this._frames[this._fIdx];
    const img     = this._loader.load(imgName);
    if (!img.complete) return;
    ctx.drawImage(img, this.x, this.y - this.h, this.w, this.h);
  }

  // debug hitbox
  drawHitbox(ctx) {
    const hb = this.hitbox;
    ctx.strokeStyle = 'rgba(255,0,0,0.6)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
  }
}

// ═══════════════════════════════════════════
//  ÁRVORE / OBSTÁCULO
// ═══════════════════════════════════════════
class Tree {
  constructor(loader, canvasW, canvasH) {
    this._loader = loader;
    this._cw     = canvasW;
    this._ch     = canvasH;
    this._scale  = canvasH / 789;

    this._frames       = ['tree1.png','tree2.png','tree3.png','tree2.png'];
    this._fIdx         = 0;
    this._fTick        = 0;
    this._animInterval = 15;

    this._ref = loader.load(this._frames[0]);
    this.x    = canvasW;
    this.dead = false;
  }

  get w() {
    if (!this._ref.complete) return 50;
    return Math.round(this._ref.naturalWidth  * this._scale);
  }
  get h() {
    if (!this._ref.complete) return 80;
    return Math.round(this._ref.naturalHeight * this._scale);
  }

  get hitbox() {
    const pad = Math.round(6 * this._scale);
    return { x: this.x + pad, y: this._ch - this.h + pad,
             w: this.w - pad*2, h: this.h - pad };
  }

  update(gs) {
    this.x -= gs.treeSpeed;
    if (this.x + this.w < 0) { this.dead = true; return; }

    this._fTick++;
    if (this._fTick >= this._animInterval) {
      this._fTick = 0;
      this._fIdx  = (this._fIdx + 1) % this._frames.length;
    }
  }

  draw(ctx) {
    const img = this._loader.load(this._frames[this._fIdx]);
    if (!img.complete) return;
    ctx.drawImage(img, this.x, this._ch - this.h, this.w, this.h);
  }

  drawHitbox(ctx) {
    const hb = this.hitbox;
    ctx.strokeStyle = 'rgba(0,200,255,0.6)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);
  }
}

// ═══════════════════════════════════════════
//  COLISÃO  AABB
// ═══════════════════════════════════════════
function aabbCollide(a, b) {
  return a.x < b.x + b.w &&
         a.x + a.w > b.x &&
         a.y < b.y + b.h &&
         a.y + a.h > b.y;
}

// ═══════════════════════════════════════════
//  ESTADO DO JOGO
// ═══════════════════════════════════════════
class GameState {
  constructor() {
    this.treeSpeed   = CFG.treeSpeedInit;
    this.gravity     = CFG.gravityNormal;
    this.speedCounter = 0;
  }
}

// ═══════════════════════════════════════════
//  HUD  (elementos DOM)
// ═══════════════════════════════════════════
class HUD {
  constructor(loader) {
    this._score     = document.getElementById('score');
    this._hs        = document.getElementById('high-score');
    this._bFill     = document.getElementById('boost-fill');
    this._bStatus   = document.getElementById('boost-status');
    this._btnMusic  = document.getElementById('btn-music');
    this._musicIcon = document.getElementById('music-icon');

    // carrega as imagens reais de música
    this._imgOn  = loader.load('Música-ON.png');
    this._imgOff = loader.load('Música-OFF.png');

    // substitui o conteúdo do botão por uma <img>
    this._musicImg        = document.createElement('img');
    this._musicImg.style.cssText = 'width:24px;height:24px;object-fit:contain;display:block;';
    this._btnMusic.innerHTML = '';
    this._btnMusic.appendChild(this._musicImg);
    this._applyMusicImg(true);
  }

  _applyMusicImg(on) {
    // usa o src já carregado pelo ImageLoader
    const src = CFG.imgDir + (on ? 'Música-ON.png' : 'Música-OFF.png');
    this._musicImg.src = src;
  }

  updateScore(score, highScore) {
    this._score.textContent = score;
    this._hs.textContent    = highScore;
  }

  updateBoost(cooldown) {
    const pct = cooldown <= 0 ? 100 : Math.round((1 - cooldown / CFG.boostCooldown) * 100);
    this._bFill.style.width = pct + '%';
    if (cooldown <= 0) {
      this._bStatus.textContent = 'PRONTO';
      this._bStatus.classList.remove('cooling');
    } else {
      this._bStatus.textContent = `${Math.ceil(cooldown / CFG.fps)}s`;
      this._bStatus.classList.add('cooling');
    }
  }

  setMusic(on) {
    this._applyMusicImg(on);
    this._btnMusic.classList.toggle('muted', !on);
  }

  flashHighScore() {
    this._hs.classList.remove('new-record-flash');
    void this._hs.offsetWidth;
    this._hs.classList.add('new-record-flash');
  }
}

// ═══════════════════════════════════════════
//  TELA DE GAME OVER
//  — imagens game_over.png e exit.png desenhadas no canvas
//  — scores mostrados no overlay DOM (abaixo das imagens)
// ═══════════════════════════════════════════
class GameOverScreen {
  constructor(loader, onRestart, onQuit) {
    this._loader  = loader;
    this._el      = document.getElementById('overlay');
    this._goScore = document.getElementById('go-score');
    this._goHs    = document.getElementById('go-hs');
    this._visible = false;

    // pré-carrega
    this._imgGO   = loader.load('game_over.png');
    this._imgExit = loader.load('exit.png');

    document.getElementById('btn-restart').addEventListener('click', onRestart);
    document.getElementById('btn-quit').addEventListener('click', onQuit);
  }

  show(score, highScore) {
    this._goScore.textContent = score;
    this._goHs.textContent    = highScore;
    this._el.classList.remove('hidden');
    this._visible = true;
  }

  hide() {
    this._el.classList.add('hidden');
    this._visible = false;
  }

  // chamado em _draw() do Game para sobrepor as imagens no canvas
  drawOnCanvas(ctx, cw, ch) {
    if (!this._visible) return;

    const goImg   = this._imgGO;
    const exImg   = this._imgExit;
    const scale   = Math.min(cw / 1535, ch / 789);

    if (goImg.complete && goImg.naturalWidth) {
      const w = Math.round(goImg.naturalWidth  * scale);
      const h = Math.round(goImg.naturalHeight * scale);
      ctx.drawImage(goImg, (cw - w) / 2, ch / 2 - h / 2 - Math.round(100 * scale), w, h);
    }

    if (exImg.complete && exImg.naturalWidth) {
      const goH = goImg.complete ? Math.round(goImg.naturalHeight * scale) : 0;
      const w   = Math.round(exImg.naturalWidth  * scale);
      const h   = Math.round(exImg.naturalHeight * scale);
      ctx.drawImage(exImg, (cw - w) / 2, ch / 2 + goH / 2 + Math.round(50 * scale), w, h);
    }
  }
}

// ═══════════════════════════════════════════
//  JOGO PRINCIPAL
// ═══════════════════════════════════════════
class Game {
  constructor() {
    this._canvas  = document.getElementById('gameCanvas');
    this._ctx     = this._canvas.getContext('2d');
    this._loader  = new ImageLoader();
    this._music   = new MusicManager();
    this._hud     = new HUD(this._loader);
    this._goScreen = new GameOverScreen(
      this._loader,
      () => this._restart(),
      () => this._quit()
    );

    this._highScore = loadHighScore();
    this._hud.updateScore(0, this._highScore);

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._bindKeys();
    this._bindButtons();

    this._startScreen = document.getElementById('start-screen');
    this._started     = false;
    this._gameOver    = false;
    this._raf         = null;

    // pré-carrega imagens antes de mostrar o start
    const allImgs = [
      'Fundo2.png','Dash.png','HitBoxDino.png','HitBoxArvore.png',
      'game_over.png','exit.png',
      'Música-ON.png','Música-OFF.png',
      'dinosaur1.png','dinosaur2.png','dinosaur3.png',
      'tree1.png','tree2.png','tree3.png',
    ];
    this._loader.preload(allImgs).then(() => {
      // start screen já está visível no HTML
    });

    // pré-aquece o canvas com o fundo enquanto espera
    this._drawIdleFrame();
  }

  // ── resize responsivo ─────────────────────
  _resize() {
    const hudH   = parseInt(getComputedStyle(document.documentElement)
                    .getPropertyValue('--hud-h')) || 64;
    const w      = window.innerWidth;
    const h      = window.innerHeight - hudH;
    this._cw     = w;
    this._ch     = h;
    this._canvas.width  = w;
    this._canvas.height = h;
    this._canvas.style.width  = w + 'px';
    this._canvas.style.height = h + 'px';

    // reinicia objetos que dependem das dimensões
    if (this._started && !this._gameOver) this._buildScene();
  }

  // ── construção da cena ────────────────────
  _buildScene() {
    this._bg   = new Background(this._loader, this._cw, this._ch);
    this._dino = new Dinosaur(this._loader, this._ch);
    this._trees = [];
    this._gs   = new GameState();
    this._nextSpawn = randInt(CFG.spawnIntervalMin, CFG.spawnIntervalMax);
    this._spawnCounter = 0;
    this._gameOver = false;
  }

  // ── input ─────────────────────────────────
  _bindKeys() {
    document.addEventListener('keydown', e => {
      if (!this._started) {
        if (e.code === 'Space') { e.preventDefault(); this._startGame(); }
        return;
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          if (this._gameOver) this._restart();
          else                this._dino.jump();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this._gs.gravity = CFG.gravityFast;
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (!this._gameOver) this._dino.tryBoost(this._gs);
          break;
        case 'ArrowLeft':
          if (this._gameOver) this._quit();
          break;
        case 'KeyM':
          this._toggleMusic();
          break;
      }
    });

    document.addEventListener('keyup', e => {
      if (e.code === 'ArrowDown' && this._gs) {
        this._gs.gravity = CFG.gravityNormal;
      }
    });
  }

  _bindButtons() {
    document.getElementById('btn-music').addEventListener('click',
      () => this._toggleMusic());
    document.getElementById('btn-start').addEventListener('click',
      () => this._startGame());
  }

  _toggleMusic() {
    this._music.toggle();
    this._hud.setMusic(this._music.isOn);
  }

  // ── início / reinício ─────────────────────
  _startGame() {
    this._startScreen.classList.add('hidden');
    this._started = true;
    this._buildScene();
    this._music.playRandom();
    this._loop();
  }

  _restart() {
    this._goScreen.hide();
    this._music.playRandom();
    this._buildScene();
    this._loop();
  }

  _quit() {
    this._music.stop();
    this._goScreen.hide();
    this._startScreen.classList.remove('hidden');
    this._started   = false;
    this._gameOver  = false;
    cancelAnimationFrame(this._raf);
    this._drawIdleFrame();
  }

  // ── game over ─────────────────────────────
  _triggerGameOver() {
    this._gameOver = true;
    cancelAnimationFrame(this._raf);

    if (this._dino.score > this._highScore) {
      this._highScore = this._dino.score;
      saveHighScore(this._highScore);
      this._hud.updateScore(this._dino.score, this._highScore);
      this._hud.flashHighScore();
    }

    // desenha o frame final com as imagens de game over por cima
    this._draw();
    this._goScreen.show(this._dino.score, this._highScore);
  }

  // ── loop principal ────────────────────────
  _loop() {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      this._update();
      this._draw();
      if (!this._gameOver) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _update() {
    this._dino.update(this._gs);

    // spawn de obstáculos via intervalo aleatório (mais controlado que chance/frame)
    this._spawnCounter++;
    if (this._spawnCounter >= this._nextSpawn) {
      this._spawnCounter = 0;
      // intervalo diminui conforme a velocidade aumenta (mais difícil)
      const speedFactor = clamp(this._gs.treeSpeed / CFG.treeSpeedInit, 1, 3);
      const minI = Math.round(CFG.spawnIntervalMin / speedFactor);
      const maxI = Math.round(CFG.spawnIntervalMax / speedFactor);
      this._nextSpawn = randInt(Math.max(minI, 30), Math.max(maxI, 45));
      this._trees.push(new Tree(this._loader, this._cw, this._ch));
    }

    // update e limpeza das árvores
    for (const t of this._trees) t.update(this._gs);
    this._trees = this._trees.filter(t => !t.dead);

    // background
    this._bg.update(this._gs.treeSpeed);

    // colisão
    const dHb = this._dino.hitbox;
    for (const t of this._trees) {
      if (aabbCollide(dHb, t.hitbox)) {
        this._triggerGameOver();
        return;
      }
    }

    // HUD
    this._hud.updateScore(this._dino.score, this._highScore);
    this._hud.updateBoost(this._dino.boostCooldown);
  }

  _draw() {
    const ctx = this._ctx;
    ctx.clearRect(0, 0, this._cw, this._ch);

    this._bg.draw(ctx);
    for (const t of this._trees) t.draw(ctx);
    this._dino.draw(ctx);

    // imagens de game over desenhadas por cima do canvas (como no original)
    this._goScreen.drawOnCanvas(ctx, this._cw, this._ch);
  }

  // frame estático antes do jogo começar
  _drawIdleFrame() {
    const ctx = this._ctx;
    if (!ctx) return;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, this._cw, this._ch);
  }
}

// ═══════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => new Game());
