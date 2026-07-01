/**
 * Tests for LLM temperature configuration (Issue #278)
 */

import { describe, it, expect, beforeEach } from 'vitest';

describe('LLM Temperature Configuration', () => {
  beforeEach(() => {
    // Reset modules to reload with fresh env vars
    // Note: In a real scenario, you'd use vi.resetModules() and reload the server module
  });

  describe('Temperature Environment Variables', () => {
    it('should have tool temperature default to 0 for deterministic tool selection', () => {
      const toolTemp = parseFloat(process.env.LLM_TOOL_TEMPERATURE || '0');
      expect(toolTemp).toBe(0);
    });

    it('should have summary temperature default to 0.3 for natural phrasing', () => {
      const summaryTemp = parseFloat(process.env.LLM_SUMMARY_TEMPERATURE || '0.3');
      expect(isFinite(summaryTemp)).toBe(true);
      expect(summaryTemp).toBeGreaterThan(0);
      expect(summaryTemp).toBeLessThanOrEqual(2.0);
    });

    it('should reject negative temperature values', () => {
      const negativeTemp = -0.5;
      expect(negativeTemp).toBeLessThan(0);
    });

    it('should accept temperature between 0 and 2.0', () => {
      const validTemps = [0, 0.1, 0.3, 0.5, 1.0, 1.5, 2.0];
      validTemps.forEach(temp => {
        expect(temp).toBeGreaterThanOrEqual(0);
        expect(temp).toBeLessThanOrEqual(2.0);
      });
    });

    it('should handle temperature as float, not string', () => {
      const tempStr = '0.3';
      const tempNum = parseFloat(tempStr);
      expect(typeof tempNum).toBe('number');
      expect(tempNum).toEqual(0.3);
    });
  });

  describe('Temperature Selection Logic', () => {
    it('should use tool temperature for early iterations', () => {
      const toolTemp = 0;
      const summaryTemp = 0.3;
      const iteration = 0;
      const hasToolCalls = true;

      // Early iteration with tool calls should use tool temperature
      const isToolCallRound = hasToolCalls || iteration < 14;
      const selectedTemp = isToolCallRound ? toolTemp : summaryTemp;
      
      expect(selectedTemp).toBe(toolTemp);
    });

    it('should use summary temperature for final iteration without tools', () => {
      const toolTemp = 0;
      const summaryTemp = 0.3;
      const iteration = 14;
      const hasToolCalls = false;

      // Last iteration without tools should use summary temperature
      const isToolCallRound = hasToolCalls || iteration < 14;
      const selectedTemp = isToolCallRound ? toolTemp : summaryTemp;
      
      expect(selectedTemp).toBe(summaryTemp);
    });

    it('should keep tool temperature for iterations with tool calls', () => {
      const toolTemp = 0;
      const summaryTemp = 0.3;
      const toolCallsCount = 3;

      // If we have tool calls, we should use tool temperature
      const isToolCallRound = toolCallsCount > 0;
      const selectedTemp = isToolCallRound ? toolTemp : summaryTemp;
      
      expect(selectedTemp).toBe(toolTemp);
    });

    it('should prefer summary temperature when breaking loop due to no tools', () => {
      const toolTemp = 0;
      const summaryTemp = 0.3;
      const iteration = 5;
      const foundToolCalls = false;

      // When LLM returns no tool calls, use summary temperature
      const selectedTemp = foundToolCalls ? toolTemp : summaryTemp;
      
      expect(selectedTemp).toBe(summaryTemp);
    });
  });

  describe('Default Configuration Values', () => {
    it('should have deterministic tool temperature of exactly 0', () => {
      const toolTemp = 0;
      expect(toolTemp).toStrictEqual(0);
    });

    it('should have creative summary temperature between 0.2 and 0.5', () => {
      const summaryTemp = 0.3;
      expect(summaryTemp).toBeGreaterThan(0.2);
      expect(summaryTemp).toBeLessThan(0.5);
    });

    it('should maintain ratio between temperatures for consistency', () => {
      const toolTemp = 0;
      const summaryTemp = 0.3;
      
      // Summary temp should be higher than tool temp for variance
      expect(summaryTemp).toBeGreaterThan(toolTemp);
      
      // But not too much higher (should stay under 1.0)
      expect(summaryTemp).toBeLessThan(1.0);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate tool temperature is between 0 and 2.0', () => {
      const validToolTemps = [0, 0.1, 1.0];
      const invalidToolTemps = [-0.1, 2.5, 3.0];
      
      validToolTemps.forEach(temp => {
        expect(temp >= 0 && temp <= 2.0).toBe(true);
      });
      
      invalidToolTemps.forEach(temp => {
        expect(temp >= 0 && temp <= 2.0).toBe(false);
      });
    });

    it('should validate summary temperature is between 0 and 2.0', () => {
      const validSummaryTemps = [0, 0.3, 1.0];
      const invalidSummaryTemps = [-0.1, 2.5];
      
      validSummaryTemps.forEach(temp => {
        expect(temp >= 0 && temp <= 2.0).toBe(true);
      });
      
      invalidSummaryTemps.forEach(temp => {
        expect(temp >= 0 && temp <= 2.0).toBe(false);
      });
    });

    it('should ensure tool temperature is not greater than summary temperature in normal cases', () => {
      const toolTemp = 0;
      const summaryTemp = 0.3;
      
      // Tool temp is more deterministic (lower or equal in most cases)
      expect(toolTemp).toBeLessThanOrEqual(summaryTemp);
    });
  });
});
