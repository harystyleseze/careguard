# Dashboard Independent Fetches (Issue #283)

## Problem
Previously, all three dashboard data fetches (`fetchAgentInfo`, `fetchSpending`, `fetchTransactions`) were kicked off in parallel, but if one was slow (e.g., transactions with large payload), the entire UI appeared frozen even though the other two fetches had completed.

## Solution
Refactored to support **independent loading states** for each data source:

1. **Separate loading flags**: Each fetch now has its own loading state
2. **Independent rendering**: Sections render as their data arrives, not blocked by others
3. **Progressive UI**: User sees agent info and spending totals even if transactions are delayed

## Changes Made

### 1. `dashboard/src/hooks/use-agent-state.ts`

Added three new loading states:
```typescript
const [loadingAgentInfo, setLoadingAgentInfo] = useState(false);
const [loadingSpending, setLoadingSpending] = useState(false);
const [loadingTransactions, setLoadingTransactions] = useState(false);
```

Updated fetch functions to set/clear their own loading state:
```typescript
const fetchAgentInfo = useCallback(async () => {
  setLoadingAgentInfo(true);
  try {
    // fetch logic
  } finally {
    setLoadingAgentInfo(false);
  }
}, []);
```

Returned new states from hook:
```typescript
return {
  // ... existing state
  loadingAgentInfo,
  loadingSpending,
  loadingTransactions,
};
```

### 2. `dashboard/src/app/page.tsx`

Passed individual loading states to each tab component:

```tsx
{activeTab === "overview" && (
  <OverviewTab
    // ... existing props
    loadingSpending={state.loadingSpending}
    loadingAgentInfo={state.loadingAgentInfo}
  />
)}

{activeTab === "activity" && (
  <ActivityTab
    // ... existing props
    loadingTransactions={state.loadingTransactions}
    loadingSpending={state.loadingSpending}
  />
)}
```

## Usage in Components

Tab components now know which data is loading and can:

1. **Show skeleton loaders** only for their own data
2. **Render partial results** while waiting for more data
3. **Show error states** independently

Example (for tab component implementer):

```tsx
export interface OverviewTabProps {
  spending: SpendingData | null;
  loadingSpending: boolean;
  loadingAgentInfo: boolean;
  agentInfo: AgentInfo | null;
}

export function OverviewTab({ spending, loadingSpending, agentInfo, loadingAgentInfo }: OverviewTabProps) {
  return (
    <div>
      {loadingAgentInfo ? <SkeletonAgentStatus /> : <AgentStatus info={agentInfo} />}
      {loadingSpending ? <SkeletonSpendingCard /> : <SpendingCard spending={spending} />}
    </div>
  );
}
```

## Benefits

- **Perceived performance**: Page feels responsive even if one fetch is slow
- **Progressive enhancement**: Users see available data immediately
- **Better UX**: No waiting on slowest data source
- **Error resilience**: Failure in one fetch doesn't block others

## Testing

See `dashboard/tests/independent-fetches.test.ts` for comprehensive tests covering:

- ✅ Loading state isolation
- ✅ One fetch completing while others load
- ✅ Independent re-renders
- ✅ Error recovery
- ✅ Progressive rendering

Run tests:
```bash
pnpm test dashboard/tests/independent-fetches.test.ts
```

## Example Scenarios

### Scenario 1: Slow Transactions

| Time | AgentInfo | Spending | Transactions |
| --- | --- | --- | --- |
| 0ms | Loading | Loading | Loading |
| 100ms | ✅ Loaded | Loading | Loading |
| 150ms | ✅ Loaded | ✅ Loaded | Loading |
| 3000ms | ✅ Loaded | ✅ Loaded | ✅ Loaded |

→ User sees agent status and spending by 150ms, even though transactions take 3s

### Scenario 2: Transactions Fail

| Data | Result |
| --- | --- |
| AgentInfo | ✅ Loaded |
| Spending | ✅ Loaded |
| Transactions | ❌ Error |

→ Page still renders with agent info and spending; only activity tab shows error

### Scenario 3: User Navigates to Activity Tab

- Transactions fetch completes with new page size/offset
- AgentInfo and Spending remain unchanged
- Only activity section re-renders

## Migration Guide

If you're adding a new data source to the dashboard:

1. **Add loading state** to `use-agent-state.ts`:
   ```typescript
   const [loadingNewData, setLoadingNewData] = useState(false);
   ```

2. **Create fetch function** with its own loading state:
   ```typescript
   const fetchNewData = useCallback(async () => {
     setLoadingNewData(true);
     try {
       // ...
     } finally {
       setLoadingNewData(false);
     }
   }, []);
   ```

3. **Return from hook**:
   ```typescript
   return { /* ... */ loadingNewData };
   ```

4. **Pass to tab** in `page.tsx`:
   ```tsx
   <MyTab loadingNewData={state.loadingNewData} />
   ```

5. **Use in tab**:
   ```tsx
   {loadingNewData ? <Skeleton /> : <Content />}
   ```

## Related Issues

- #283: All three fetches kicked off in parallel — single slow one freezes UI
