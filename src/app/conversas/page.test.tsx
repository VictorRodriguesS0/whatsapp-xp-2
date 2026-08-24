import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn());
const getMetaHealthSummary = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser }));
vi.mock("@/modules/meta-health/service", () => ({ getMetaHealthSummary }));
vi.mock("@/components/inbox/inbox-shell", () => ({
  InboxShell: ({ initialMetaHealthSummary }: { initialMetaHealthSummary: unknown }) => (
    <div>{initialMetaHealthSummary ? "Inbox com Meta" : "Inbox sem Meta"}</div>
  ),
}));

import ConversationsPage from "./page";

describe("conversations page Meta health bootstrap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads Meta health only for administrators", async () => {
    const admin = { id: "a", name: "Admin", email: "a@x.test", role: "ADMIN" };
    getCurrentUser.mockResolvedValue(admin);
    getMetaHealthSummary.mockResolvedValue({ label: "NORMAL" });
    render(await ConversationsPage());
    expect(screen.getByText("Inbox com Meta")).toBeVisible();
    expect(getMetaHealthSummary).toHaveBeenCalledWith(admin);
  });

  it("does not request Meta health for attendants", async () => {
    getCurrentUser.mockResolvedValue({ id: "u", name: "Ana", email: "u@x.test", role: "ATTENDANT" });
    render(await ConversationsPage());
    expect(screen.getByText("Inbox sem Meta")).toBeVisible();
    expect(getMetaHealthSummary).not.toHaveBeenCalled();
  });
});
