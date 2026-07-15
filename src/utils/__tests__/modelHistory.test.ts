import {
  MAX_RECENT_MODELS_PER_PROVIDER,
  mergeRecentModelOptions,
  nextRecentModels,
} from '../modelHistory';

describe('modelHistory', () => {
  it('moves a confirmed model to the front and deduplicates case-insensitively', () => {
    expect(nextRecentModels(['gpt-5.5', 'GLM-5.1'], ' glm-5.1 ')).toEqual([
      'glm-5.1',
      'gpt-5.5',
    ]);
  });

  it('keeps only the bounded most-recent models', () => {
    const existing = Array.from(
      { length: MAX_RECENT_MODELS_PER_PROVIDER },
      (_, index) => `model-${index}`,
    );
    expect(nextRecentModels(existing, 'new-model')).toEqual([
      'new-model',
      ...existing.slice(0, MAX_RECENT_MODELS_PER_PROVIDER - 1),
    ]);
  });

  it('places local history before server recommendations and removes duplicates', () => {
    expect(
      mergeRecentModelOptions(
        ['custom-model', 'glm-5.1'],
        [
          { label: 'GLM 5.1', value: 'glm-5.1' },
          { label: 'GLM 5.2', value: 'glm-5.2' },
        ],
      ),
    ).toEqual([
      { label: 'custom-model', value: 'custom-model' },
      { label: 'GLM 5.1', value: 'glm-5.1' },
      { label: 'GLM 5.2', value: 'glm-5.2' },
    ]);
  });
});
