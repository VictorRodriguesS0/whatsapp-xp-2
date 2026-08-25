import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { MessageTimeline } from "./message-timeline";

describe("MessageTimeline", () => {
  it("keeps the existing log contract and receives presentation children", () => {
    const historyRef = createRef<HTMLDivElement>();
    render(<MessageTimeline empty historyRef={historyRef} label="Histórico com Ana"><p>Mensagem</p></MessageTimeline>);

    expect(screen.getByRole("log", { name: "Histórico com Ana" })).toBe(historyRef.current);
    expect(screen.getByText("Ainda não há mensagens nesta conversa.")).toBeVisible();
    expect(screen.getByText("Mensagem")).toBeVisible();
  });
});
