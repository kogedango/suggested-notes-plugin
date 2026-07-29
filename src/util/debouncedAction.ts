export class DebouncedAction {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private delayMs: number,
    private action: () => void,
  ) {}

  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.action();
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  flush(): void {
    if (this.timer === undefined) return;
    this.cancel();
    this.action();
  }
}
