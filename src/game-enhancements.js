const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const gameState = {
  progress: 0,
  life: 100,
  paused: false,
  hintsVisible: true,
  pressedBank: null,
};

window.requestAnimationFrame = (callback) => {
  return nativeRequestAnimationFrame(function guardedFrame(timestamp) {
    if (!gameState.paused) {
      callback(timestamp);
      return;
    }

    nativeRequestAnimationFrame(guardedFrame);
  });
};

function qs(selector) {
  return document.querySelector(selector);
}

function makeElement(tag, className, text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function vibrate(pattern = 18) {
  if ("vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
}

function dispatchKey(code, type) {
  const key = code === "KeyA" ? "a" : "d";
  window.dispatchEvent(new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code,
    key,
  }));
}

function installUiOverlay() {
  const shell = qs(".app-shell");
  const hud = qs("#hud");
  if (!shell || !hud) return;

  const progress = makeElement("div", "hud-progress");
  const progressBar = makeElement("div", "hud-progress__bar");
  progressBar.id = "missionProgressBar";
  progressBar.setAttribute("role", "progressbar");
  progressBar.setAttribute("aria-label", "Progreso de la misión");
  progressBar.setAttribute("aria-valuemin", "0");
  progressBar.setAttribute("aria-valuemax", "100");
  progress.append(progressBar);
  shell.append(progress);

  const actions = makeElement("div", "hud-actions");
  const pauseButton = makeElement("button", "hud-action", "Ⅱ");
  pauseButton.id = "pauseButton";
  pauseButton.type = "button";
  pauseButton.setAttribute("aria-label", "Pausar o reanudar");

  const hintButton = makeElement("button", "hud-action", "?");
  hintButton.id = "hintButton";
  hintButton.type = "button";
  hintButton.setAttribute("aria-label", "Mostrar ayuda de controles");

  actions.append(pauseButton, hintButton);
  shell.append(actions);

  const reticle = makeElement("div", "flight-reticle");
  reticle.setAttribute("aria-hidden", "true");
  reticle.append(makeElement("span", "flight-reticle__dot"));
  shell.append(reticle);

  const chip = makeElement("div", "control-chip is-visible", "Mueve la palanca para girar · desliza hacia arriba para turbo · toca laterales para virar rápido");
  chip.id = "controlHintChip";
  shell.append(chip);

  const pausedOverlay = makeElement("div", "pause-overlay", "Pausa");
  pausedOverlay.id = "pauseOverlay";
  pausedOverlay.setAttribute("aria-hidden", "true");
  shell.append(pausedOverlay);

  const bankControls = makeElement("div", "bank-controls");
  const left = makeElement("button", "bank-zone bank-zone--left", "‹");
  left.id = "bankLeft";
  left.type = "button";
  left.setAttribute("aria-label", "Virar a la izquierda");

  const right = makeElement("button", "bank-zone bank-zone--right", "›");
  right.id = "bankRight";
  right.type = "button";
  right.setAttribute("aria-label", "Virar a la derecha");

  bankControls.append(left, right);
  shell.append(bankControls);

  pauseButton.addEventListener("click", () => {
    gameState.paused = !gameState.paused;
    pauseButton.textContent = gameState.paused ? "▶" : "Ⅱ";
    pauseButton.setAttribute("aria-pressed", String(gameState.paused));
    window.dispatchEvent(new CustomEvent("plane-game:pause-toggle", { detail: { paused: gameState.paused } }));
    vibrate(12);
  });

  hintButton.addEventListener("click", () => {
    gameState.hintsVisible = !gameState.hintsVisible;
    chip.classList.toggle("is-visible", gameState.hintsVisible);
    hintButton.setAttribute("aria-pressed", String(gameState.hintsVisible));
    vibrate(10);
  });

  setTimeout(() => {
    if (gameState.hintsVisible) chip.classList.remove("is-visible");
  }, 5200);
}

function installHudObserver() {
  const objective = qs("#hudObjective");
  const life = qs("#hudLife");
  const missiles = qs("#hudMissiles");
  const progressBar = qs("#missionProgressBar");
  if (!objective || !life || !progressBar) return;

  const update = () => {
    const objectiveMatch = objective.textContent.match(/(\d+)\s*\/\s*(\d+)/);
    if (objectiveMatch) {
      const destroyed = Number(objectiveMatch[1]);
      const total = Number(objectiveMatch[2]);
      const progress = total > 0 ? Math.round((destroyed / total) * 100) : 0;
      gameState.progress = progress;
      progressBar.style.width = `${Math.min(100, progress)}%`;
      progressBar.setAttribute("aria-valuenow", String(progress));
    }

    const lifeMatch = life.textContent.match(/(\d+)/);
    if (lifeMatch) {
      const nextLife = Number(lifeMatch[1]);
      if (nextLife < gameState.life) vibrate([12, 24, 12]);
      gameState.life = nextLife;
      document.body.classList.toggle("low-life", nextLife > 0 && nextLife <= 30);
    }

    if (missiles) {
      missiles.dataset.value = missiles.textContent.replace(/[^0-9]/g, "");
    }
  };

  const observer = new MutationObserver(update);
  observer.observe(objective, { childList: true, characterData: true, subtree: true });
  observer.observe(life, { childList: true, characterData: true, subtree: true });
  if (missiles) observer.observe(missiles, { childList: true, characterData: true, subtree: true });
  update();
}

function installButtonFeedback() {
  const missileButton = qs("#missileButton");
  const joystickBase = qs("#joystickBase");

  if (missileButton) {
    ["pointerdown", "touchstart"].forEach((eventName) => {
      missileButton.addEventListener(eventName, () => {
        missileButton.classList.remove("is-firing");
        void missileButton.offsetWidth;
        missileButton.classList.add("is-firing");
        vibrate(24);
      }, { passive: true });
    });
  }

  if (joystickBase) {
    joystickBase.addEventListener("pointerdown", () => joystickBase.classList.add("is-active"));
    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      joystickBase.addEventListener(eventName, () => joystickBase.classList.remove("is-active"));
    });
  }
}

function installBankControls() {
  const left = qs("#bankLeft");
  const right = qs("#bankRight");
  if (!left || !right) return;

  const setPressed = (side, pressed) => {
    const target = side === "left" ? left : right;
    const code = side === "left" ? "KeyA" : "KeyD";
    target.classList.toggle("is-pressed", pressed);
    gameState.pressedBank = pressed ? side : null;
    dispatchKey(code, pressed ? "keydown" : "keyup");
    window.dispatchEvent(new CustomEvent("plane-game:bank", { detail: { side, pressed } }));
    if (pressed) vibrate(10);
  };

  const bind = (element, side) => {
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      element.setPointerCapture?.(event.pointerId);
      setPressed(side, true);
    });

    ["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
      element.addEventListener(eventName, (event) => {
        event.preventDefault();
        setPressed(side, false);
      });
    });
  };

  bind(left, "left");
  bind(right, "right");
}

function installGameHooks() {
  window.addEventListener("plane-game:pause-toggle", (event) => {
    document.body.classList.toggle("is-paused", event.detail.paused);
  });

  window.addEventListener("keydown", (event) => {
    if (event.code === "KeyP") {
      qs("#pauseButton")?.click();
    }
  });
}

installUiOverlay();
installHudObserver();
installButtonFeedback();
installBankControls();
installGameHooks();
