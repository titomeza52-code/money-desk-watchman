import "./style.css";
import { Game } from "./game/Game";

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
const game = new Game(canvas);

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

canvas.addEventListener("click", () => {
  if (game.running && game.paused) {
    game.resume();
  } else if (game.running && !game.input.pointerLocked) {
    game.input.requestLock();
  }
});

window.addEventListener("keydown", (e) => {
  if (e.code === "Enter" || e.code === "Space") {
    redeploy();
  }
});
