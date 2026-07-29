import { afterEach, describe, expect, it, vi } from "vitest";
import { DebouncedAction } from "./debouncedAction";

afterEach(() => {
  vi.useRealTimers();
});

describe("DebouncedAction", () => {
  it("coalesces consecutive schedules into one action", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const debounced = new DebouncedAction(750, action);

    debounced.schedule();
    vi.advanceTimersByTime(500);
    debounced.schedule();
    vi.advanceTimersByTime(749);
    expect(action).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending action when an immediate operation supersedes it", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const debounced = new DebouncedAction(750, action);

    debounced.schedule();
    debounced.cancel();
    vi.runAllTimers();

    expect(action).not.toHaveBeenCalled();
  });

  it("flushes the latest pending action immediately", () => {
    vi.useFakeTimers();
    const action = vi.fn();
    const debounced = new DebouncedAction(750, action);

    debounced.schedule();
    debounced.flush();
    vi.runAllTimers();

    expect(action).toHaveBeenCalledTimes(1);
  });
});
