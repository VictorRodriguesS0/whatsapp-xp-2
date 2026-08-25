import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationListSkeleton } from "./conversation-list-skeleton";

describe("ConversationListSkeleton", () => {
  it("renders six inert conversation geometry rows with one polite loading status", () => {
    render(<ConversationListSkeleton />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("Carregando conversas");
    expect(screen.getAllByTestId("conversation-list-skeleton-row")).toHaveLength(6);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
