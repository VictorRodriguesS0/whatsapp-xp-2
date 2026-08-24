import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConnectionBanner, ConnectionStatus } from "./connection-banner";

describe("ConnectionStatus", () => {
  it("announces reconnecting politely without a modal and keeps the previous export compatible", () => {
    const { rerender } = render(<ConnectionStatus connected={false} />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).not.toHaveAttribute("aria-modal");
    expect(status).toHaveTextContent("Conexão interrompida. Reconectando…");
    expect(ConnectionBanner).toBe(ConnectionStatus);

    rerender(<ConnectionStatus connected />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
