import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = new Game(canvas);

document.getElementById("start-btn")!.addEventListener("click", () => {
  game.start();
});

document.getElementById("restart-btn")!.addEventListener("click", () => {
  game.start();
});

canvas.addEventListener("click", () => {
  if (game.running && game.paused) {
    game.resume();
  } else if (game.running && !game.input.pointerLocked) {
    game.input.requestLock();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && game.running && game.paused) {
    // browser releases pointer lock on Esc; show pause already
  }
});

// Clean unused scaffold files if present — ignore
