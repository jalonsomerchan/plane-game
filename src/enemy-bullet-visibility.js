const ENEMY_BULLET_SOURCE_COLOR = "#ff4444";
const ENEMY_BULLET_VISIBLE_COLOR = "#39d5ff";
const ENEMY_BULLET_GLOW_COLOR = "rgba(57, 213, 255, 0.95)";

const fillStyleDescriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "fillStyle");
const shadowColorDescriptor = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "shadowColor");
const nativeArc = CanvasRenderingContext2D.prototype.arc;
const nativeFill = CanvasRenderingContext2D.prototype.fill;

function isEnemyBulletColor(value) {
  return typeof value === "string" && value.toLowerCase() === ENEMY_BULLET_SOURCE_COLOR;
}

if (fillStyleDescriptor?.set && fillStyleDescriptor?.get) {
  Object.defineProperty(CanvasRenderingContext2D.prototype, "fillStyle", {
    configurable: true,
    enumerable: fillStyleDescriptor.enumerable,
    get: fillStyleDescriptor.get,
    set(value) {
      this.__planeEnemyBulletActive = isEnemyBulletColor(value);
      fillStyleDescriptor.set.call(this, this.__planeEnemyBulletActive ? ENEMY_BULLET_VISIBLE_COLOR : value);
    },
  });
}

if (shadowColorDescriptor?.set && shadowColorDescriptor?.get) {
  Object.defineProperty(CanvasRenderingContext2D.prototype, "shadowColor", {
    configurable: true,
    enumerable: shadowColorDescriptor.enumerable,
    get: shadowColorDescriptor.get,
    set(value) {
      shadowColorDescriptor.set.call(this, isEnemyBulletColor(value) ? ENEMY_BULLET_GLOW_COLOR : value);
    },
  });
}

CanvasRenderingContext2D.prototype.arc = function patchedEnemyBulletArc(x, y, radius, startAngle, endAngle, counterclockwise) {
  if (this.__planeEnemyBulletActive && radius <= 5.5) {
    return nativeArc.call(this, x, y, Math.max(radius, 7), startAngle, endAngle, counterclockwise);
  }

  return nativeArc.call(this, x, y, radius, startAngle, endAngle, counterclockwise);
};

CanvasRenderingContext2D.prototype.fill = function patchedEnemyBulletFill(...args) {
  if (!this.__planeEnemyBulletActive) {
    return nativeFill.apply(this, args);
  }

  const previousShadowBlur = this.shadowBlur;
  const previousGlobalAlpha = this.globalAlpha;

  this.shadowBlur = Math.max(previousShadowBlur, 18);
  this.globalAlpha = Math.max(previousGlobalAlpha, 0.96);

  const result = nativeFill.apply(this, args);

  this.shadowBlur = previousShadowBlur;
  this.globalAlpha = previousGlobalAlpha;

  return result;
};
