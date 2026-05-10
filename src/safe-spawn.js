const MIN_INITIAL_ENEMY_DISTANCE = 900;
const INITIAL_SPAWN_PADDING = 260;

const nativeArrayPush = Array.prototype.push;

function isEnemySpawnObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value.type === "fly" || value.type === "ground") &&
      typeof value.x === "number" &&
      typeof value.y === "number" &&
      typeof value.hp === "number" &&
      typeof value.radius === "number" &&
      typeof value.fireCooldown === "number"
  );
}

function pushEnemyAwayFromInitialSpawn(enemy) {
  const currentDistance = Math.hypot(enemy.x, enemy.y);

  if (currentDistance >= MIN_INITIAL_ENEMY_DISTANCE) return enemy;

  const angle = currentDistance > 0.001
    ? Math.atan2(enemy.y, enemy.x)
    : Math.random() * Math.PI * 2;

  const safeDistance = MIN_INITIAL_ENEMY_DISTANCE + INITIAL_SPAWN_PADDING + Math.random() * INITIAL_SPAWN_PADDING;
  enemy.x = Math.cos(angle) * safeDistance;
  enemy.y = Math.sin(angle) * safeDistance;

  if (enemy.type === "fly") {
    enemy.angle = angle + Math.PI;
    enemy.fireCooldown = Math.max(enemy.fireCooldown, 2.4);
  } else {
    enemy.fireCooldown = Math.max(enemy.fireCooldown, 3.2);
  }

  return enemy;
}

Array.prototype.push = function patchedPush(...items) {
  const patchedItems = items.map((item) => {
    if (!isEnemySpawnObject(item)) return item;
    return pushEnemyAwayFromInitialSpawn(item);
  });

  return nativeArrayPush.apply(this, patchedItems);
};
