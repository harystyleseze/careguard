'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UsePollOptions {
  intervalMs: number;
  enabled?: boolean;
  onPoll: () => Promise<void> | void;
  onError?: (error: Error) => void;
}

const BACKOFF_INTERVALS = [15000, 60000, 300000]; // 15s, 60s, 5min

export function usePoll({ intervalMs, enabled = true, onPoll, onError }: UsePollOptions) {
  const [isPaused, setIsPaused] = useState(false);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [currentInterval, setCurrentInterval] = useState(intervalMs);
  
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  const resetBackoff = useCallback(() => {
    setConsecutiveErrors(0);
    setCurrentInterval(intervalMs);
  }, [intervalMs]);

  const calculateBackoff = useCallback(() => {
    const backoffIndex = Math.min(consecutiveErrors, BACKOFF_INTERVALS.length - 1);
    return BACKOFF_INTERVALS[backoffIndex];
  }, [consecutiveErrors]);

  const poll = useCallback(async () => {
    if (!enabled || isPaused || !isMountedRef.current) {
      return;
    }

    try {
      await onPoll();
      resetBackoff();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      onError?.(err);
      setConsecutiveErrors((prev) => prev + 1);
      const newInterval = calculateBackoff();
      setCurrentInterval(newInterval);
    }

    // Schedule next poll
    if (isMountedRef.current && !isPaused && enabled) {
      pollTimeoutRef.current = setTimeout(poll, currentInterval);
    }
  }, [enabled, isPaused, onPoll, onError, resetBackoff, calculateBackoff, currentInterval]);

  // Handle visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsPaused(true);
        if (pollTimeoutRef.current) {
          clearTimeout(pollTimeoutRef.current);
          pollTimeoutRef.current = null;
        }
        console.log('[usePoll] Poll paused (tab hidden)');
      } else {
        setIsPaused(false);
        console.log('[usePoll] Resumed');
        // Poll immediately when tab becomes visible
        poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [poll]);

  // Start polling on mount
  useEffect(() => {
    if (enabled && !isPaused) {
      poll();
    }

    return () => {
      isMountedRef.current = false;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [enabled, isPaused, poll]);

  return {
    isPaused,
    consecutiveErrors,
    currentInterval,
    resetBackoff,
  };
}
