import { describe, it, expect, vi } from "vitest";
import { generateMetadata } from "../app/layout";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

const mockProfile = {
  recipient: {
    name: "Rosa Garcia",
    avatar: "http://example.com/rosa.jpg",
  },
};

vi.mock("../lib/useProfile", () => ({
  useProfile: () => mockProfile,
}));

vi.mock("../lib/fetchProfile", () => ({
  fetchProfile: async () => mockProfile,
}));

describe("Layout Dynamic Metadata", () => {
  it("should generate title and openGraph based on the loaded profile", async () => {
    const metadata = await generateMetadata({ params: {} });
    expect(metadata.title).toBe("Rosa Garcia's CareGuard");
    expect(metadata.openGraph?.title).toBe("Rosa Garcia's CareGuard");
    expect(metadata.openGraph?.images?.[0]).toEqual({
      url: "http://example.com/rosa.jpg",
      width: 512,
      height: 512,
      alt: "Rosa Garcia's Avatar",
    });
  });

  it("should fallback to generic icon for openGraph images if avatar is missing", async () => {
    mockProfile.recipient.avatar = "";
    const metadata = await generateMetadata({ params: {} });
    expect(metadata.openGraph?.images?.[0].url).toBe("/icon-512.png");
  });

  it("should adapt to different recipient name dynamically", async () => {
    mockProfile.recipient.name = "Alice Smith";
    const metadata = await generateMetadata({ params: {} });
    expect(metadata.title).toBe("Alice Smith's CareGuard");
  });
});
