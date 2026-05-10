const KEY_MAP = {
  left: { code: "KeyA", key: "a" },
  right: { code: "KeyD", key: "d" },
  turbo: { code: "ShiftLeft", key: "Shift" },
  missile: { code: "Space", key: " " },
};

const pressedVirtualKeys = new Set();
const ignoredSteeringSelectors = [
  "button",
  "select",
  ".menu-panel",
  ".message-panel",
  ".touch-controls",
  ".joystick-base",
  ".joystick-knob",
  ".missile-button",
  ".bank-zone",
  ".hud-action",
];

let pointerSteeringId = null;
let pointerSteeringActive = false;
let pointerFireCooldown = 0;

function isIgnoredTarget(target) {
  return target instanceof Element && ignoredSteeringSelectors.some((selector) => target.closest(selector));
}

function dispatchVirtualKey(action, type) {
  const keyInfo = KEY_MAP[action];
  if (!keyInfo) return;

  const pressedKey = `${action}:${keyInfo.code}`;
  if (type === "keydown" && pressedVirtualKeys.has(pressedKey)) return;
  if (type === "keyup" && !pressedVirtualKeys.has(pressedKey)) return;

  if (type === "keydown") pressedVirtualKeys.add(pressedKey);
  if (type === "keyup") pressedVirtualKeys.delete(pressedKey);

  window.dispatchEvent(new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    code: keyInfo.code,
    key: keyInfo.key,
    shiftKey: action === "turbo",
  }));
}

function releaseSteeringKeys() {
  dispatchVirtualKey("left", "keyup");
  dispatchVirtualKey("right", "keyup");
  dispatchVirtualKey("turbo", "keyup");
}

function applyAnalogSteering(clientX, clientY) {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const normalizedX = ((clientX / width) - 0.5) * 2;
  const normalizedY = ((clientY / height) - 0.5) * 2;
  const deadZone = 0.14;
  const turboZone = -0.42;

  if (normalizedX < -deadZone) {
    dispatchVirtualKey("left", "keydown");
    dispatchVirtualKey("right", "keyup");
  } else if (normalizedX > deadZone) {
    dispatchVirtualKey("right", "keydown");
    dispatchVirtualKey("left", "keyup");
  } else {
    dispatchVirtualKey("left", "keyup");
    dispatchVirtualKey("right", "keyup");
  }

  if (normalizedY < turboZone) {
    dispatchVirtualKey("turbo", "keydown");
  } else {
    dispatchVirtualKey("turbo", "keyup");
  }

  window.dispatchEvent(new CustomEvent("plane-game:aim-preview", {
    detail: { x: normalizedX, y: normalizedY },
  }));
}

function pulseMissile() {
  const now = performance.now();
  if (now - pointerFireCooldown < 220) return;
  pointerFireCooldown = now;

  dispatchVirtualKey("missile", "keydown");
  window.setTimeout(() => dispatchVirtualKey("missile", "keyup"), 32);
}

function installPointerSteering() {
  const canvas = document.getElementById("gameCanvas");
  if (!canvas) return;

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  canvas.addEventListener("pointerdown", (event) => {
    if (isIgnoredTarget(event.target)) return;
    if (pointerSteeringId !== null) return;

    pointerSteeringId = event.pointerId;
    pointerSteeringActive = true;
    canvas.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-pointer-steering");
    applyAnalogSteering(event.clientX, event.clientY);

    if (event.button === 0 && event.pointerType === "mouse") {
      pulseMissile();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointerSteeringActive || event.pointerId !== pointerSteeringId) return;
    applyAnalogSteering(event.clientX, event.clientY);
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
    canvas.addEventListener(eventName, (event) => {
      if (event.pointerId !== pointerSteeringId) return;
      pointerSteeringId = null;
      pointerSteeringActive = false;
      releaseSteeringKeys();
      document.body.classList.remove("is-pointer-steering");
      window.dispatchEvent(new CustomEvent("plane-game:aim-preview", { detail: { x: 0, y: 0 } }));
    });
  });
}

function installKeyboardAliases() {
  let aliasDispatching = false;

  const aliasMap = new Map([
    ["ArrowLeft", KEY_MAP.left],
    ["ArrowRight", KEY_MAP.right],
    ["ArrowUp", KEY_MAP.turbo],
    ["KeyW", KEY_MAP.turbo],
  ]);

  window.addEventListener("keydown", (event) => {
    if (aliasDispatching || event.repeat) return;
    const alias = aliasMap.get(event.code);
    if (!alias) return;

    event.preventDefault();
    aliasDispatching = true;
    window.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: alias.code,
      key: alias.key,
      shiftKey: alias.code === "ShiftLeft",
    }));
    aliasDispatching = false;
  });

  window.addEventListener("keyup", (event) => {
    if (aliasDispatching) return;
    const alias = aliasMap.get(event.code);
    if (!alias) return;

    event.preventDefault();
    aliasDispatching = true;
    window.dispatchEvent(new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      code: alias.code,
      key: alias.key,
      shiftKey: alias.code === "ShiftLeft",
    }));
    aliasDispatching = false;
  });
}

function installVisibilityCleanup() {
  window.addEventListener("blur", releaseSteeringKeys);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseSteeringKeys();
  });
}

installPointerSteering();
installKeyboardAliases();
installVisibilityCleanup();
