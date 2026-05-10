const GAME_TOUCH_SELECTORS = [
  "#gameCanvas",
  ".touch-controls",
  ".joystick-base",
  ".joystick-knob",
  ".missile-button",
];

const interactiveSelectors = [
  "button",
  "select",
  "input",
  "textarea",
  "a",
  "[role='button']",
];

let lastTouchEndAt = 0;
let activeTouchCount = 0;

function isGameTouchTarget(target) {
  if (!(target instanceof Element)) return false;
  return GAME_TOUCH_SELECTORS.some((selector) => target.closest(selector));
}

function isNativeInteractiveTarget(target) {
  if (!(target instanceof Element)) return false;
  return interactiveSelectors.some((selector) => target.closest(selector));
}

function preventDefault(event) {
  if (event.cancelable) event.preventDefault();
}

function lockViewportScale() {
  const viewport = document.querySelector("meta[name='viewport']");
  if (!viewport) return;

  viewport.setAttribute(
    "content",
    [
      "width=device-width",
      "initial-scale=1",
      "minimum-scale=1",
      "maximum-scale=1",
      "user-scalable=no",
      "viewport-fit=cover",
    ].join(", ")
  );
}

function installGestureLocks() {
  ["gesturestart", "gesturechange", "gestureend"].forEach((eventName) => {
    document.addEventListener(eventName, preventDefault, { passive: false });
  });

  document.addEventListener(
    "touchstart",
    (event) => {
      activeTouchCount = event.touches.length;

      if (event.touches.length > 1) {
        preventDefault(event);
        return;
      }

      if (isGameTouchTarget(event.target)) {
        preventDefault(event);
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "touchmove",
    (event) => {
      if (activeTouchCount > 1 || isGameTouchTarget(event.target)) {
        preventDefault(event);
      }
    },
    { passive: false }
  );

  document.addEventListener(
    "touchend",
    (event) => {
      const now = window.performance.now();
      const tappedQuickly = now - lastTouchEndAt < 360;

      if (tappedQuickly || isGameTouchTarget(event.target)) {
        preventDefault(event);
      }

      lastTouchEndAt = now;
      activeTouchCount = event.touches.length;
    },
    { passive: false }
  );

  document.addEventListener(
    "dblclick",
    (event) => {
      if (!isNativeInteractiveTarget(event.target) || isGameTouchTarget(event.target)) {
        preventDefault(event);
      }
    },
    { passive: false }
  );
}

function installFocusGuards() {
  window.addEventListener("orientationchange", () => {
    lockViewportScale();
    window.scrollTo(0, 0);
  });

  window.addEventListener("resize", () => {
    window.scrollTo(0, 0);
  });
}

lockViewportScale();
installGestureLocks();
installFocusGuards();
