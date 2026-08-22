import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  REPLY_SWIPE_THRESHOLD_PX,
  REPLY_SWIPE_VERTICAL_ABORT_PX,
  useMessageReplyGesture,
} from "./use-message-reply-gesture";

function Harness({ onReply }: { onReply: () => void }) {
  const gesture = useMessageReplyGesture(true, onReply);
  return (
    <article data-offset={gesture.offset} data-testid="gesture" {...gesture.handlers}>
      <span>Mensagem</span>
      <div data-reply-swipe-ignore="true"><h3>Conteúdo rico</h3></div>
      <button type="button">Controle</button>
      <audio aria-label="Áudio" controls />
    </article>
  );
}

function pointer(
  target: Element,
  type: "down" | "move" | "up" | "cancel",
  { x, y, pointerType = "touch" }: { x: number; y: number; pointerType?: string },
) {
  const event = new Event(`pointer${type}`, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: 7 },
    pointerType: { value: pointerType },
    isPrimary: { value: true },
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: y },
  });
  fireEvent(target, event);
}

describe("useMessageReplyGesture", () => {
  it("replies at exactly 56px and resets the offset", () => {
    const reply = vi.fn();
    render(<Harness onReply={reply} />);
    const target = screen.getByTestId("gesture");
    Object.defineProperties(target, {
      setPointerCapture: { configurable: true, value: vi.fn() },
      hasPointerCapture: { configurable: true, value: () => true },
      releasePointerCapture: { configurable: true, value: vi.fn() },
    });

    pointer(target, "down", { x: 0, y: 0 });
    pointer(target, "move", { x: REPLY_SWIPE_THRESHOLD_PX, y: 0 });
    expect(target).toHaveAttribute("data-offset", String(REPLY_SWIPE_THRESHOLD_PX));
    pointer(target, "up", { x: REPLY_SWIPE_THRESHOLD_PX, y: 0 });

    expect(reply).toHaveBeenCalledOnce();
    expect(target).toHaveAttribute("data-offset", "0");
  });

  it("does not reply at 55px", () => {
    const reply = vi.fn();
    render(<Harness onReply={reply} />);
    const target = screen.getByTestId("gesture");

    pointer(target, "down", { x: 0, y: 0 });
    pointer(target, "move", { x: REPLY_SWIPE_THRESHOLD_PX - 1, y: 0 });
    pointer(target, "up", { x: REPLY_SWIPE_THRESHOLD_PX - 1, y: 0 });

    expect(reply).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-offset", "0");
  });

  it("does not reply when the browser cancels a completed drag", () => {
    const reply = vi.fn();
    render(<Harness onReply={reply} />);
    const target = screen.getByTestId("gesture");

    pointer(target, "down", { x: 0, y: 0 });
    pointer(target, "move", { x: REPLY_SWIPE_THRESHOLD_PX, y: 0 });
    pointer(target, "cancel", { x: REPLY_SWIPE_THRESHOLD_PX, y: 0 });

    expect(reply).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-offset", "0");
  });

  it("cancels at 12px of dominant vertical movement", () => {
    const reply = vi.fn();
    render(<Harness onReply={reply} />);
    const target = screen.getByTestId("gesture");

    pointer(target, "down", { x: 0, y: 0 });
    pointer(target, "move", { x: 5, y: REPLY_SWIPE_VERTICAL_ABORT_PX });
    pointer(target, "move", { x: 70, y: REPLY_SWIPE_VERTICAL_ABORT_PX });
    pointer(target, "up", { x: 70, y: REPLY_SWIPE_VERTICAL_ABORT_PX });

    expect(reply).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-offset", "0");
  });

  it("ignores mouse pointers and native controls", () => {
    const reply = vi.fn();
    render(<Harness onReply={reply} />);
    const target = screen.getByTestId("gesture");

    pointer(target, "down", { x: 0, y: 0, pointerType: "mouse" });
    pointer(target, "move", { x: 70, y: 0, pointerType: "mouse" });
    pointer(target, "up", { x: 70, y: 0, pointerType: "mouse" });
    for (const control of [
      screen.getByRole("button", { name: "Controle" }),
      screen.getByLabelText("Áudio"),
    ]) {
      pointer(control, "down", { x: 0, y: 0 });
      pointer(control, "move", { x: 70, y: 0 });
      pointer(control, "up", { x: 70, y: 0 });
    }

    expect(reply).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-offset", "0");
  });

  it("leaves pen gestures on message text available for selection", () => {
    const reply = vi.fn();
    render(<Harness onReply={reply} />);
    const target = screen.getByTestId("gesture");
    const messageText = screen.getByText("Mensagem");

    pointer(messageText, "down", { x: 0, y: 0, pointerType: "pen" });
    pointer(messageText, "move", { x: 70, y: 0, pointerType: "pen" });
    pointer(messageText, "up", { x: 70, y: 0, pointerType: "pen" });

    expect(reply).not.toHaveBeenCalled();
    expect(target).toHaveAttribute("data-offset", "0");
  });

  it.each(["touch", "pen"])(
    "leaves %s gestures on marked rich text available for selection",
    (pointerType) => {
      const reply = vi.fn();
      render(<Harness onReply={reply} />);
      const target = screen.getByTestId("gesture");
      const richText = screen.getByRole("heading", { name: "Conteúdo rico" });

      pointer(richText, "down", { x: 0, y: 0, pointerType });
      pointer(richText, "move", { x: 70, y: 0, pointerType });
      pointer(richText, "up", { x: 70, y: 0, pointerType });

      expect(reply).not.toHaveBeenCalled();
      expect(target).toHaveAttribute("data-offset", "0");
    },
  );
});
