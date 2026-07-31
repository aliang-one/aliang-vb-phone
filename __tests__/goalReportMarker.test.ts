import { describe, expect, it } from '@jest/globals';
import { extractGoalReport } from '../src/utils/goalReportMarker';

describe('extractGoalReport', () => {
  it('returns content unchanged when there is no marker', () => {
    const r = extractGoalReport('Did some work.\nNo report here.');
    expect(r.report).toBeNull();
    expect(r.reportKind).toBeNull();
    expect(r.narrative).toBe('Did some work.\nNo report here.');
  });

  it('strips a complete REPORT marker and parses the payload', () => {
    const content =
      '已为 K8s 审计补齐表单组件。\nALIANG_GOAL_REPORT:{"schema_version":1,"outcome":"task_completed","summary":"补齐 login/audit 表单","evidence_refs":["a","b"],"completion_proposed":true}';
    const r = extractGoalReport(content);
    expect(r.reportKind).toBe('report');
    expect(r.narrative).toBe('已为 K8s 审计补齐表单组件。');
    expect(r.report).toEqual({
      outcome: 'task_completed',
      summary: '补齐 login/audit 表单',
      blockerCode: undefined,
      completionProposed: true,
    });
  });

  it('captures blocker_code for a blocked report', () => {
    const content =
      '需要更多信息。\nALIANG_GOAL_REPORT:{"schema_version":1,"outcome":"blocked","summary":"需要 schema","blocker_code":"goal_replan_required","completion_proposed":false}';
    const r = extractGoalReport(content);
    expect(r.report?.outcome).toBe('blocked');
    expect(r.report?.blockerCode).toBe('goal_replan_required');
    expect(r.report?.completionProposed).toBe(false);
    expect(r.narrative).toBe('需要更多信息。');
  });

  it('suppresses a partial marker prefix that starts a line (streaming), no card yet', () => {
    // The marker is mid-arrival on its own line; the partial tail must be
    // hidden so the user never sees `ALIANG_GOAL_RE…` flashing.
    const r = extractGoalReport('Working on it.\nALIANG_GOAL_REP');
    expect(r.report).toBeNull();
    expect(r.reportKind).toBeNull();
    expect(r.narrative).toBe('Working on it.');
  });

  it('does NOT suppress a marker-looking prefix sitting mid-prose (false-positive guard)', () => {
    // "...looked at ALIANG" ends with a marker prefix but is NOT at a line
    // boundary → must be left intact (regression guard for the prose case).
    const r = extractGoalReport('I looked at ALIANG modules today');
    expect(r.report).toBeNull();
    expect(r.narrative).toBe('I looked at ALIANG modules today');
  });

  it('suppresses when the full marker landed but JSON is incomplete (streaming)', () => {
    const content = 'Done.\nALIANG_GOAL_REPORT:{"schema_version":1,"outcome":"task_comple';
    const r = extractGoalReport(content);
    expect(r.report).toBeNull();
    expect(r.narrative).toBe('Done.');
  });

  it('parses JSON wrapped in a ```json fence', () => {
    const content =
      'Body text.\n```json\nALIANG_GOAL_REPORT:{"outcome":"failed","summary":"boom"}\n```';
    const r = extractGoalReport(content);
    expect(r.reportKind).toBe('report');
    expect(r.report?.outcome).toBe('failed');
    expect(r.report?.summary).toBe('boom');
    expect(r.narrative).toBe('Body text.');
  });

  it('tolerates trailing prose after the JSON object', () => {
    const content =
      'Body.\nALIANG_GOAL_REPORT:{"outcome":"no_progress","summary":"stuck"}\nThat is all for now.';
    const r = extractGoalReport(content);
    expect(r.report?.outcome).toBe('no_progress');
    expect(r.report?.summary).toBe('stuck');
    expect(r.narrative).toBe('Body.');
  });

  it('recognizes the PLAN marker', () => {
    const content =
      'Planning.\nALIANG_GOAL_PLAN:{"outcome":"task_completed","summary":"plan ready"}';
    const r = extractGoalReport(content);
    expect(r.reportKind).toBe('plan');
    expect(r.report?.outcome).toBe('task_completed');
    expect(r.narrative).toBe('Planning.');
  });

  it('reports null payload when outcome is missing/invalid even if JSON parses', () => {
    const content = 'Body.\nALIANG_GOAL_REPORT:{"summary":"no outcome field"}';
    const r = extractGoalReport(content);
    expect(r.report).toBeNull();
    // Marker still present → narrative stripped (no raw JSON shown).
    expect(r.narrative).toBe('Body.');
  });

  it('returns empty narrative when content is nothing but the marker', () => {
    const content =
      'ALIANG_GOAL_REPORT:{"outcome":"task_completed","summary":"only report"}';
    const r = extractGoalReport(content);
    expect(r.narrative).toBe('');
    expect(r.report?.outcome).toBe('task_completed');
  });

  it('treats undefined/null content as empty (no marker)', () => {
    expect(extractGoalReport(undefined).narrative).toBe('');
    expect(extractGoalReport(null).report).toBeNull();
  });
});
