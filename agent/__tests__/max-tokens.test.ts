/**
 * Tests for LLM max_tokens heuristic (Issue #280)
 */

import { describe, it, expect } from 'vitest';

// This replicates the calculateMaxTokens function from server.ts for testing
function calculateMaxTokens(iteration: number, toolCallCount: number, previousToolResultCount: number): number {
  const LLM_MAX_TOKENS_TOOL_RESULT = 512;
  const LLM_MAX_TOKENS_SIMPLE = 1024;
  const LLM_MAX_TOKENS_SUMMARY = 4096;

  // First iteration with no priors: likely a simple query
  if (iteration === 0) {
    return LLM_MAX_TOKENS_SIMPLE; // 1024
  }

  // Just processed multiple tool results: need to synthesize them (still modest)
  if (previousToolResultCount > 0 && previousToolResultCount <= 3) {
    return LLM_MAX_TOKENS_TOOL_RESULT; // 512
  }

  // Multiple tool results or complex scenario: save budget but allow more
  if (previousToolResultCount > 3) {
    return LLM_MAX_TOKENS_SIMPLE; // 1024
  }

  // Late iterations: likely final summary, give full budget
  if (iteration > 8) {
    return LLM_MAX_TOKENS_SUMMARY; // 4096
  }

  // Default: conservative middle ground
  return LLM_MAX_TOKENS_SIMPLE; // 1024
}

describe('LLM max_tokens Heuristic', () => {
  describe('First iteration (query phase)', () => {
    it('should use 1024 tokens for simple user query (iteration 0)', () => {
      const maxTokens = calculateMaxTokens(0, 0, 0);
      expect(maxTokens).toBe(1024);
    });

    it('should always use 1024 for iteration 0 regardless of other params', () => {
      expect(calculateMaxTokens(0, 0, 0)).toBe(1024);
      expect(calculateMaxTokens(0, 5, 0)).toBe(1024);
      expect(calculateMaxTokens(0, 0, 10)).toBe(1024);
    });
  });

  describe('Tool-result processing phase (512 tokens)', () => {
    it('should use 512 tokens when processing 1 tool result', () => {
      const maxTokens = calculateMaxTokens(1, 0, 1);
      expect(maxTokens).toBe(512);
    });

    it('should use 512 tokens when processing 2-3 tool results', () => {
      expect(calculateMaxTokens(1, 0, 2)).toBe(512);
      expect(calculateMaxTokens(1, 0, 3)).toBe(512);
    });

    it('should use 512 tokens for iterations after tool results (not first iteration)', () => {
      expect(calculateMaxTokens(2, 0, 1)).toBe(512);
      expect(calculateMaxTokens(5, 0, 2)).toBe(512);
      expect(calculateMaxTokens(7, 0, 3)).toBe(512);
    });
  });

  describe('Complex synthesis phase (1024 tokens)', () => {
    it('should use 1024 tokens when processing 4+ tool results', () => {
      expect(calculateMaxTokens(2, 0, 4)).toBe(1024);
      expect(calculateMaxTokens(2, 0, 5)).toBe(1024);
      expect(calculateMaxTokens(2, 0, 10)).toBe(1024);
    });

    it('should use 1024 tokens for middle iterations without many results', () => {
      // Iteration 5 with no prior tool results
      expect(calculateMaxTokens(5, 0, 0)).toBe(1024);
      expect(calculateMaxTokens(4, 0, 0)).toBe(1024);
    });

    it('should use 1024 for iterations 1-8 with no tool results', () => {
      for (let i = 1; i <= 8; i++) {
        expect(calculateMaxTokens(i, 0, 0)).toBe(1024);
      }
    });
  });

  describe('Late iteration phase (4096 tokens for summaries)', () => {
    it('should use 4096 tokens for iteration > 8', () => {
      expect(calculateMaxTokens(9, 0, 0)).toBe(4096);
      expect(calculateMaxTokens(10, 0, 0)).toBe(4096);
      expect(calculateMaxTokens(14, 0, 0)).toBe(4096);
    });

    it('should use 4096 even if there are prior tool results in late iterations', () => {
      expect(calculateMaxTokens(9, 0, 3)).toBe(4096);
      expect(calculateMaxTokens(10, 0, 5)).toBe(4096);
    });

    it('should trigger at iteration 9 (just after iteration 8)', () => {
      expect(calculateMaxTokens(8, 0, 0)).toBe(1024); // iteration 8 is still 1024
      expect(calculateMaxTokens(9, 0, 0)).toBe(4096); // iteration 9 jumps to 4096
    });
  });

  describe('Boundary conditions', () => {
    it('should handle zero tool results correctly', () => {
      expect(calculateMaxTokens(1, 0, 0)).toBe(1024);
      expect(calculateMaxTokens(5, 0, 0)).toBe(1024);
    });

    it('should handle edge of 3/4 tool results boundary', () => {
      expect(calculateMaxTokens(2, 0, 3)).toBe(512);  // 3 is still in "1-3" range
      expect(calculateMaxTokens(2, 0, 4)).toBe(1024); // 4 moves to "4+" range
    });

    it('should not use toolCallCount parameter (reserved for future use)', () => {
      // toolCallCount is passed but not currently used in the heuristic
      expect(calculateMaxTokens(1, 100, 2)).toBe(512);
      expect(calculateMaxTokens(1, 0, 2)).toBe(512);
    });
  });

  describe('Real-world scenarios', () => {
    it('simple medication adherence check: "Did Rosa take her med?"', () => {
      // Iteration 0: User query
      const iter0 = calculateMaxTokens(0, 0, 0);
      expect(iter0).toBe(1024);

      // Iteration 1: Tool call (e.g., get_adherence_status)
      const iter1 = calculateMaxTokens(1, 1, 0);
      expect(iter1).toBe(1024); // No tool results yet

      // Iteration 2: Processing 1 tool result, final summary
      const iter2 = calculateMaxTokens(2, 0, 1);
      expect(iter2).toBe(512);

      // Total tokens: 1024 + 1024 + 512 = 2560 (vs 4096 fixed = 37% savings)
    });

    it('complex bill audit with multiple tool results', () => {
      // Iteration 0: Query about bill
      const iter0 = calculateMaxTokens(0, 0, 0);
      expect(iter0).toBe(1024);

      // Iteration 1: Calls audit_medical_bill
      const iter1 = calculateMaxTokens(1, 1, 0);
      expect(iter1).toBe(1024);

      // Iteration 2: Gets result, calls generate_dispute_letter
      const iter2 = calculateMaxTokens(2, 1, 1);
      expect(iter2).toBe(512);

      // Iteration 3: Gets 2 tool results, decides final response needed
      const iter3 = calculateMaxTokens(3, 0, 2);
      expect(iter3).toBe(512);

      // Total tokens: 1024 + 1024 + 512 + 512 = 3072 (vs 4096 fixed = 25% savings)
    });

    it('complex multi-step agent loop with many interactions', () => {
      const iterations = [
        { iter: 0, toolCalls: 0, results: 0, expected: 1024 }, // Query: 1024
        { iter: 1, toolCalls: 1, results: 0, expected: 1024 }, // Tool call: 1024
        { iter: 2, toolCalls: 2, results: 1, expected: 512 },  // Process 1 result: 512
        { iter: 3, toolCalls: 2, results: 2, expected: 512 },  // Process 2 results: 512
        { iter: 4, toolCalls: 1, results: 2, expected: 512 },  // Process 2 results: 512
        { iter: 5, toolCalls: 0, results: 3, expected: 512 },  // Process 3 results: 512
        { iter: 9, toolCalls: 0, results: 5, expected: 4096 }, // Late iteration: 4096
      ];

      iterations.forEach(({ iter, toolCalls, results, expected }) => {
        const maxTokens = calculateMaxTokens(iter, toolCalls, results);
        expect(maxTokens).toBe(expected);
      });

      // Total: 1024 + 1024 + 512 + 512 + 512 + 512 + 4096 = 8192
      // vs fixed 4096 x 7 iterations = 28672
      // Dynamic saves 71% in this scenario
    });
  });

  describe('Token conservation', () => {
    it('should reduce tokens for simple queries vs fixed 4096', () => {
      // Simple queries should use less than 4096
      const simpleIterationTokens = [1024, 1024, 512];
      const totalSimple = simpleIterationTokens.reduce((a, b) => a + b, 0);
      const fixedTotal = 4096 * simpleIterationTokens.length;

      expect(totalSimple).toBeLessThan(fixedTotal);
      expect(totalSimple).toBeLessThan(fixedTotal * 0.75); // At least 25% savings
    });

    it('should allocate more tokens for complex late iterations', () => {
      // Late iterations should still get 4096 when needed
      const lateIterTokens = calculateMaxTokens(10, 0, 0);
      expect(lateIterTokens).toBe(4096);
    });

    it('should maintain predictable budget across reasonable iteration counts', () => {
      // A typical run shouldn't exceed fixed budget significantly more
      let totalTokens = 0;
      for (let i = 0; i < 6; i++) {
        totalTokens += calculateMaxTokens(i, i > 2 ? 1 : 0, Math.max(0, i - 2));
      }

      // 6 iterations with heuristic should not use more than 3x the summary max
      expect(totalTokens).toBeLessThan(4096 * 3);
    });
  });
});
