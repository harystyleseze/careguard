/**
 * Unit tests for scripts/dev.ts — multi-process dev runner (Issue #41).
 *
 * Strategy:
 *  - Mock `child_process.spawn` to return controllable fake child processes.
 *  - Mock `process.exit` to prevent the test runner from actually exiting.
 *  - Import dev.ts via `vi.isolateModules` to trigger its top-level execution freshly.
 *  - Verify spawn call count, stdio routing, crash-kill behaviour, and signal handling.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// --------------------------------------------------------------------------
// Shared mocks (hoisted before vi.mock factories)
// --------------------------------------------------------------------------

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({ spawn: mockSpawn }));

// --------------------------------------------------------------------------
// Mock child-process factory
// --------------------------------------------------------------------------

type MockChild = {
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  /** Fire the registered "exit" handler(s) with the given exit code. */
  triggerExit: (code: number | null) => void;
  /** Fire the registered stdout "data" handler(s) with the given string. */
  triggerStdout: (data: string) => void;
  /** Fire the registered stderr "data" handler(s) with the given string. */
  triggerStderr: (data: string) => void;
};

function createMockChild(): MockChild {
  const exitCbs: ((code: number | null) => void)[] = [];
  const stdoutCbs: ((data: Buffer) => void)[] = [];
  const stderrCbs: ((data: Buffer) => void)[] = [];

  const child: MockChild = {
    stdout: {
      on: vi.fn((event: string, cb: any) => {
        if (event === "data") stdoutCbs.push(cb);
      }),
    },
    stderr: {
      on: vi.fn((event: string, cb: any) => {
        if (event === "data") stderrCbs.push(cb);
      }),
    },
    on: vi.fn((event: string, cb: any) => {
      if (event === "exit") exitCbs.push(cb);
    }),
    kill: vi.fn(),
    triggerExit: (code) => exitCbs.forEach((cb) => cb(code)),
    triggerStdout: (data) => stdoutCbs.forEach((cb) => cb(Buffer.from(data))),
    triggerStderr: (data) => stderrCbs.forEach((cb) => cb(Buffer.from(data))),
  };
  return child;
}

// --------------------------------------------------------------------------
// process.exit spy — must not let the test runner actually exit
// --------------------------------------------------------------------------

let processExitSpy: ReturnType<typeof vi.spyOn<NodeJS.Process, "exit">>;

beforeAll(() => {
  processExitSpy = vi.spyOn(process, "exit").mockImplementation(
    (() => undefined) as unknown as typeof process.exit,
  );
});

afterAll(() => {
  processExitSpy.mockRestore();
});

// --------------------------------------------------------------------------
// Helper: load dev.ts in isolation and return the spawned mock children
// --------------------------------------------------------------------------

async function loadDev(): Promise<MockChild[]> {
  const children: MockChild[] = [];

  mockSpawn.mockClear();
  mockSpawn.mockImplementation(() => {
    const child = createMockChild();
    children.push(child);
    return child;
  });

  await vi.isolateModules(async () => {
    // Dynamic import triggers all top-level code in dev.ts
    await import("../../scripts/dev.ts");
  });

  return children;
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe("dev.ts — multi-process dev runner (Issue #41)", () => {
  it("spawns exactly 5 child processes — one per service definition", async () => {
    await loadDev();
    expect(mockSpawn).toHaveBeenCalledTimes(5);
  });

  it("spawns each process with node --import tsx and the correct script path", async () => {
    await loadDev();

    const calls = mockSpawn.mock.calls;
    expect(calls).toHaveLength(5);

    for (const [cmd, args] of calls) {
      expect(cmd).toBe("node");
      expect(args[0]).toBe("--import");
      expect(args[1]).toBe("tsx");
      expect(typeof args[2]).toBe("string");
    }

    // Spot-check service scripts (in SERVICES order)
    expect(calls[0][2]).toContain("pharmacy-api");
    expect(calls[1][2]).toContain("bill-audit-api");
    expect(calls[2][2]).toContain("drug-interaction-api");
    expect(calls[3][2]).toContain("pharmacy-payment");
    expect(calls[4][2]).toContain("agent");
  });

  it("routes stdout data with a per-service colour prefix", async () => {
    const children = await loadDev();
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    children[0].triggerStdout("hello from pharmacy");

    const written = writeSpy.mock.calls.map(([s]) => s as string).join("");
    expect(written).toContain("[pharmacy]");
    expect(written).toContain("hello from pharmacy");

    writeSpy.mockRestore();
  });

  it("routes stderr data with a red colour prefix", async () => {
    const children = await loadDev();
    const writeSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    children[1].triggerStderr("billing error output");

    const written = writeSpy.mock.calls.map(([s]) => s as string).join("");
    expect(written).toContain("billing error output");
    // stderr path always uses the red ANSI escape code \x1b[31m
    expect(written).toContain("\x1b[31m");

    writeSpy.mockRestore();
  });

  it("kills all other children and exits 1 when any child crashes (exit code ≠ 0)", async () => {
    processExitSpy.mockClear();
    const children = await loadDev();

    // Crash the first service
    children[0].triggerExit(1);

    // Every child must receive kill()
    for (const child of children) {
      expect(child.kill).toHaveBeenCalled();
    }
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it("does NOT kill children or exit when a child exits cleanly (code 0)", async () => {
    processExitSpy.mockClear();
    const children = await loadDev();

    children[0].triggerExit(0);

    // No child should be killed; parent should not exit
    for (const child of children) {
      expect(child.kill).not.toHaveBeenCalled();
    }
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("does NOT kill or exit for null exit code (process still running)", async () => {
    processExitSpy.mockClear();
    const children = await loadDev();

    children[0].triggerExit(null);

    for (const child of children) {
      expect(child.kill).not.toHaveBeenCalled();
    }
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it("kills all children and exits 0 on SIGINT", async () => {
    processExitSpy.mockClear();
    const children = await loadDev();

    process.emit("SIGINT");

    for (const child of children) {
      expect(child.kill).toHaveBeenCalled();
    }
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("kills all children and exits 0 on SIGTERM", async () => {
    processExitSpy.mockClear();
    const children = await loadDev();

    process.emit("SIGTERM");

    for (const child of children) {
      expect(child.kill).toHaveBeenCalled();
    }
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
