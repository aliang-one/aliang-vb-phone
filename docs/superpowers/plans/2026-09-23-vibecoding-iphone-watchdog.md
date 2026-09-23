# VibeCoding iPhone Watchdog Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the VibeCoding conversation screen from blocking the iPhone 12 main thread long enough to trigger the iOS `0x8BADF00D` scene-update watchdog.

**Architecture:** Keep the existing store and transcript projection, but enforce activity-size limits at the server-to-client boundary, gate tail scrolling by real content changes, and render conversation rows through React Native's built-in `FlatList`. Move row signature work out of the memo comparator and reduce layout measurements while a session is streaming.

**Tech Stack:** React Native 0.85 Fabric, Hermes, Zustand, React Navigation, Jest, TypeScript, `FlatList`.

**Spec:** Device evidence from iPhone 12 crash reports dated 2026-09-18 and 2026-09-22: foreground `scene-update` watchdog, main thread in `RCTScrollViewComponentView` clipping/mounting, sustained 59%–71% CPU, no Jetsam/OOM.

## Global Constraints

- Preserve the existing transcript ordering, scrubber jumps, pull-to-load-earlier behavior, and tail-follow UX.
- Do not add a third-party list dependency; use React Native's built-in virtualization first.
- Keep the existing 200 ms live publication throttle unless profiling proves that a larger interval is required.
- Do not enable `removeClippedSubviews` on iOS in the first rollout because the crash stack is already in Fabric clipping code.
- Every stage must pass targeted Jest tests and TypeScript checks before a device build.

### Task 1: Cap activity snapshots at the transport boundary

**Files:**
- Modify: `src/store/internals.ts:120-123, 615-629`
- Modify: `src/store/controlCenterStore.ts:885-912`
- Test: `src/store/__tests__/structuredEvents.test.ts`

**Interfaces:**
- Consume the existing `STRUCTURED_EVENTS_CAP` and `tail` helpers.
- Produce a `VibeCodingRun` whose `structuredEvents` never exceeds `STRUCTURED_EVENTS_CAP`, including the first server snapshot before a previous local run exists.

- [ ] Add a failing test for a first server snapshot containing more than 200 structured events; assert that the mapped run retains only the newest 200 events.
- [ ] Add a failing test for the `previousRun === undefined` store path; assert that the inserted run is capped before any screen selector can observe it.
- [ ] Run the focused structured-event tests and confirm they fail before the implementation.
- [ ] Apply `tail(mappedEvents, STRUCTURED_EVENTS_CAP)` in `serverAiSessionToVibeRun` and cap the no-previous-run branch in the snapshot merge path.
- [ ] Run `npm test -- --runInBand src/store/__tests__/structuredEvents.test.ts` and `npm run typecheck`.
- [ ] Commit as `fix: cap structured activity snapshots before rendering`.

### Task 2: Stop redundant tail-scroll feedback

**Files:**
- Modify: `src/screens/vibecoding/VibeCodingSessionScreen.tsx:2194-2199`
- Modify: `src/screens/vibecoding/useConversationScrollController.ts:97-109`
- Test: `src/screens/vibecoding/__tests__/useConversationScrollController.test.ts`

**Interfaces:**
- Keep `scheduleScrollToEnd(animated?: boolean)` as the screen-facing API.
- Add an internal `lastContentHeight` and pending-scroll guard so repeated `onContentSizeChange` callbacks from one Fabric mount transaction coalesce into one non-animated scroll while live.

- [ ] Add tests proving identical content heights do not schedule another scroll.
- [ ] Add tests proving a live update uses one non-animated tail scroll after a content-height change.
- [ ] Run the focused controller tests and confirm they fail before the implementation.
- [ ] Pass the actual `height` from `onContentSizeChange` into a guarded controller method instead of discarding it.
- [ ] Keep user initiated `scrollToBottom(true)` animated; only streaming tail-follow scrolls become non-animated.
- [ ] Run the focused tests and typecheck.
- [ ] Commit as `fix: coalesce streaming tail scrolls`.

### Task 3: Introduce a virtualized conversation list

**Files:**
- Create: `src/screens/vibecoding/ConversationTimelineList.tsx`
- Modify: `src/screens/vibecoding/VibeCodingSessionScreen.tsx:2173-3135`
- Modify: `src/screens/vibecoding/useConversationScrollController.ts`
- Test: `src/screens/vibecoding/__tests__/ConversationTimelineList.test.tsx`

**Interfaces:**
- `ConversationTimelineList` accepts the existing visible timeline items, render callbacks, `followTail`, `onLoadEarlier`, `onRefresh`, and scrubber/layout callbacks.
- It exposes a `FlatList` ref with `scrollToEnd`, `scrollToIndex`, and `getScrollResponder` behavior needed by the controller.

- [ ] Add a rendering test that mounts more than 30 timeline items and asserts only the configured initial window is mounted.
- [ ] Add tests for prepending older turns while preserving the first visible item.
- [ ] Add a test for the load-earlier row and the existing pull-to-refresh behavior.
- [ ] Run the new tests and confirm they fail before the list component exists.
- [ ] Move the conversation timeline item switch into `renderItem` with stable `keyExtractor` values.
- [ ] Configure `initialNumToRender={8}`, `maxToRenderPerBatch={6}`, `windowSize={5}`, and `updateCellsBatchingPeriod={50}`.
- [ ] Keep header/session summary content in `ListHeaderComponent` and the timeline status/refresh content in `ListFooterComponent`.
- [ ] Keep `removeClippedSubviews` disabled on iOS for the first rollout.
- [ ] Adapt the scroll controller to the `FlatList` ref without changing scrubber semantics.
- [ ] Run focused tests, full relevant Jest tests, and typecheck.
- [ ] Commit as `perf: virtualize vibecoding conversation rows`.

### Task 4: Make row memoization constant-time during streaming

**Files:**
- Modify: `src/screens/vibecoding/useConversationTranscript.ts`
- Modify: `src/components/vibecoding/TranscriptMessageList.tsx:1194-1303`
- Modify: `src/screens/vibecoding/ConversationTimelineList.tsx`
- Test: `src/components/vibecoding/__tests__/TranscriptMessageList.memo.test.tsx`

**Interfaces:**
- `useConversationTranscript` produces stable per-message activity signatures for visible rows.
- `TranscriptMessageList` compares precomputed signature strings instead of rebuilding signatures by iterating event arrays inside the comparator.

- [ ] Add a test showing an unrelated activity event does not re-render historical rows.
- [ ] Add a test showing command status, thinking bucket, and event additions still invalidate the affected row.
- [ ] Run the memo tests and confirm they fail before the signature prop exists.
- [ ] Compute signatures once per transcript projection and pass them to each row.
- [ ] Remove the comparator's repeated `activityEventsRenderSignature` and full orphan-map traversal.
- [ ] Preserve detail-cache invalidation only for events belonging to the affected row.
- [ ] Run targeted tests and typecheck.
- [ ] Commit as `perf: precompute transcript row render signatures`.

### Task 5: Reduce layout state churn while a live turn is streaming

**Files:**
- Modify: `src/screens/vibecoding/ConversationTimelineList.tsx`
- Modify: `src/screens/vibecoding/useConversationScrollController.ts`
- Test: `src/screens/vibecoding/__tests__/useConversationScrollController.test.ts`

**Interfaces:**
- Layout tracking remains available for scrubber jumps, but only visible rows update the layout map.
- Layout commits remain rounded and tolerance-checked through the existing `useStableMeasurement` pattern.

- [ ] Add a test proving repeated identical row measurements do not publish state.
- [ ] Add a test proving off-window rows do not enter the layout map until they become viewable.
- [ ] Run the focused controller tests and confirm they fail before the visibility gate exists.
- [ ] Wire `onViewableItemsChanged` to register visible row ids.
- [ ] Ignore measurement callbacks for rows outside the visible set and batch visible changes in one macrotask.
- [ ] Keep jump-to-message timeout behavior at 3 seconds; do not create an unbounded wait loop.
- [ ] Run targeted tests, full relevant Jest tests, and typecheck.
- [ ] Commit as `perf: limit conversation layout tracking to visible rows`.

### Task 6: Build and verify on the real iPhone 12

**Files:**
- Modify: no source files unless verification finds a regression.
- Evidence: `docs/superpowers/plans/2026-09-23-vibecoding-iphone-watchdog.md` and the device crash-log capture directory.

**Interfaces:**
- Use the current commit's Debug build and bundle identifier on the connected iPhone 12.
- Collect `devicectl` console output, CPU resource reports, and crash logs for the same reproduction window.

- [ ] Build and install the current source on UDID `A012676C-24F5-5D9E-961E-F4DCF1FD1974`; record the binary UUID so the report is symbolizable.
- [ ] Reproduce with a large streaming session and keep the phone on the conversation screen for at least 3 minutes.
- [ ] Record main-thread frame rate, CPU, resident memory, and counts of content-size callbacks and tail-scroll calls.
- [ ] Verify there is no new `scene-update watchdog`, `SIGKILL`, or `SIGABRT` report.
- [ ] Verify normal cases: open a short session, stream a long session, scroll away from the tail, load earlier turns, jump with the scrubber, and return to the tail.
- [ ] Run the full Jest suite and typecheck after the device build passes.
- [ ] Commit only if the source changes from the verification loop are intentional and tested.

## Rollout and rollback

- Ship Task 1 and Task 2 first as a low-risk stopgap. They cap worst-case input and remove redundant native scroll work without changing list structure.
- Ship Task 3 only after the stopgap passes on the iPhone 12. It changes the conversation container and needs the full interaction matrix.
- Ship Task 4 and Task 5 with Task 3 if profiling shows comparator or layout work remains above the watchdog budget.
- Roll back by reverting the last task commit; each task preserves the previous public store and screen contracts.

## Success criteria

- No iOS `0x8BADF00D` watchdog report during a 3-minute large-session stream on iPhone 12.
- Main-thread CPU remains below the watchdog pattern observed in the incident, with no sustained 59%–71% plateau.
- Tail-follow scroll calls are at most one per content-height change window, and identical content-size callbacks cause zero native scroll calls.
- Existing transcript, scrubber, load-earlier, approval, and composer behaviors remain covered by tests.
