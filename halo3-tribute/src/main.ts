import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = new Game(canvas);
(window as unknown as { __RINGFALL__: Game }).__RINGFALL__ = game;

document.getElementById("start-btn")!.addEventListener("click", () => {
  game.start();
});

const redeploy = () => {
  const end = document.getElementById("end-screen")!;
  if (!end.classList.contains("hidden")) {
    game.start();
  }
};

document.getElementById("restart-btn")!.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  e.stopPropagation();
  redeploy();
});
document.getElementById("restart-btn")!.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  redeploy();
});

function tryResume() {
  if (game.running && game.paused) {
    game.resume();
  } else if (game.running && !game.input.pointerLocked) {
    game.input.requestLock();
  }
}

canvas.addEventListener("click", tryResume);
document.getElementById("pause-screen")!.addEventListener("click", tryResume);

window.addEventListener("keydown", (e) => {
  if (e.code === "Enter") {
    redeploy();
    if (game.running && game.paused) tryResume();
  }
});
