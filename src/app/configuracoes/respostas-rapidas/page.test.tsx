import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, getCurrentUser, listQuickReplies } = vi.hoisted(() => ({
  redirect: vi.fn(),
  getCurrentUser: vi.fn(),
  listQuickReplies: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/modules/auth/session", () => ({ getCurrentUser }));
vi.mock("@/modules/quick-replies/service", () => ({ listQuickReplies }));

import Page from "./page";

describe("quick replies page", () => {
  beforeEach(() => { redirect.mockReset(); getCurrentUser.mockReset(); listQuickReplies.mockReset(); });
  it("allows an authenticated attendant to manage shared replies", async () => {
    getCurrentUser.mockResolvedValue({ id: "1", role: "ATTENDANT" });
    listQuickReplies.mockResolvedValue([]);
    render(await Page());
    expect(screen.getByRole("heading", { name: "Respostas rápidas" })).toBeVisible();
    expect(listQuickReplies).toHaveBeenCalledWith({ activeOnly: false });
  });
});
