export type KeyState = Record<string, boolean>;

export class Input {
  keys: KeyState = {};
  mouseDX = 0;
  mouseDY = 0;
  mouseDown = false;
  pointerLocked = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    window.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (["Space", "KeyR", "KeyG", "KeyF", "Digit1", "Digit2"].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });
    window.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.mouseDown = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
    });
  }

  requestLock() {
    if (document.pointerLockElement !== this.canvas) {
      this.canvas.requestPointerLock();
    }
  }

  consumeMouseDelta() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  pressed(code: string) {
    return !!this.keys[code];
  }
}
